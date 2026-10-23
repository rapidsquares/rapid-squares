// What happens to an order after it's paid: send it to RoofQuery, follow its progress,
// tell the customer when it's ready (or refund them when it can't be measured).
import crypto from 'node:crypto';
import { config } from './config.js';
import { db, eq, inList } from './supabase.js';
import { roofquery as rq, stripe, email } from './services.js';

const MIN = 60000;
const money = (c) => '$' + (c / 100).toFixed(2);
const now = () => new Date().toISOString();
// Wait before trying a failed placement again: 5 min, 15 min, 1 hour, then every 3 hours.
// RoofQuery's answer when the balance won't cover an order: the alert says to add credit.
const BALANCE = new Set(['INSUFFICIENT_CREDITS', 'BILLING_SETUP_REQUIRED']);

// ---------- signed download links ----------
// /files/<order id>/<pdf|esx>?exp=…&sig=… — lets a browser download without our sign-in header,
// and lets guests download from their email. The RoofQuery order id never leaves the server.
function linkKey() { return config.downloadSecret || crypto.createHash('sha256').update('rs-download:' + config.supabase.secretKey).digest(); }
const sigFor = (id, kind, exp) => crypto.createHmac('sha256', linkKey()).update(`${id}.${kind}.${exp}`).digest('base64url');
export function downloadUrl(orderId, kind, ttlMs) {
  const exp = Math.floor((Date.now() + ttlMs) / 1000);
  return `${config.appUrl}/files/${orderId}/${kind}?exp=${exp}&sig=${sigFor(orderId, kind, exp)}`;
}
export function checkDownload(orderId, kind, exp, sig) {
  if (!/^\d+$/.test(String(exp)) || +exp < Date.now() / 1000) return false;
  const want = Buffer.from(sigFor(orderId, kind, exp)), got = Buffer.from(String(sig || ''));
  return want.length === got.length && crypto.timingSafeEqual(want, got);
}

// ---------- placing ----------
// Sends a paid order to RoofQuery. Never throws. If RoofQuery won't take it, the order isn't retried: it's
// cancelled and refunded, the customer is told we're having trouble, and ADMIN_EMAIL gets the error.
export async function place(orderId) {
  if (!rq.connected()) return null;
  const order = await db.one('report_orders', { id: eq(orderId) });
  if (!order || order.status !== 'pending' || order.roofquery_order_id) return order;
  try {
    if (order.report_type === 'storm_report') return await placeStorm(order);
    // The order keeps the company's brand for good: try twice to have the profile up to date, then order
    // without one rather than not at all.
    const company = order.company_id ? await db.one('companies', { id: eq(order.company_id) }) : null;
    let brand = company ? (await rq.ensureBrand(company)) || (await rq.ensureBrand(company)) : null, r;
    try { r = await rq.placeOrder(order, { brand }); }
    catch (e) {
      if (e.code !== 'BRAND_NOT_FOUND' || !company) throw e;
      // The profile was deleted in RoofQuery's portal: make a new one, or order without it.
      await db.update('companies', { id: eq(company.id) }, { roofquery_brand_profile_id: null, roofquery_brand_hash: null });
      brand = await rq.ensureBrand({ ...company, roofquery_brand_profile_id: null, roofquery_brand_hash: null });
      r = await rq.placeOrder(order, { brand, key: 'rs-order-' + order.id + '-b' });
    }
    const [saved] = await db.update('report_orders', { id: eq(order.id) }, { roofquery_order_id: r.orderId, rq_status: r.status, rq_error: null, rq_checked_at: now(), status_detail: null });
    return apply(saved, r);
  } catch (e) {
    const why = `${e.code || 'error'}: ${e.message}`;
    const [saved] = await db.update('report_orders', { id: eq(order.id) }, { rq_attempts: (order.rq_attempts || 0) + 1, rq_error: why, status: 'failed', status_detail: 'We couldn’t place this order' });
    await alertAdmin(`RS-${order.report_number} couldn't be placed and was refunded`,
      `RoofQuery didn't take RS-${order.report_number} (${order.address}).\n\n${why}\n\n${BALANCE.has(e.code) ? 'The RoofQuery balance won’t cover it: add credit in the RoofQuery portal.\n\n' : ''}The order was cancelled, and the customer was refunded and told.`);
    await refundAndTell(saved || order, 'We’re experiencing issues placing orders right now. Please try again a little later.');
    return saved || order;
  }
}

// A Storm Report comes back finished in the same response (about 2 seconds), so it's delivered at once.
async function placeStorm(order) {
  const r = await rq.placeStorm(order);
  const [saved] = await db.update('report_orders', { id: eq(order.id) }, {
    roofquery_order_id: r.orderId, rq_status: r.status || 'completed', rq_error: null, rq_checked_at: now(),
    status: 'delivered', status_detail: null, completed_at: r.completedAt || r.createdAt || now(), measurements: { storm: stormData(r) }
  });
  if (saved) await tellReady(saved);
  return saved || order;
}
// What we keep of a Storm Report for the report page. The weather data never changes, so it's stored once.
function stormData(order) {
  // The weather data is under `storm`; the property, billing and files are on the order itself.
  const r = { ...(order.storm || {}), property: order.property, billing: order.billing };
  const s = r.summary || {}, num = (v) => (typeof v === 'number' ? v : null);
  const pick = (o, keys) => (o ? Object.fromEntries(keys.filter((k) => o[k] !== undefined).map((k) => [k, o[k]])) : null);
  return {
    headline: r.headline || null, damage_chance: (r.damageChance && r.damageChance.level) || null, damage_reason: (r.damageChance && r.damageChance.reason) || null,
    period: pick(r.period, ['from', 'to', 'years', 'radarHailFrom']), county: (r.property && r.property.county) || null, country: (r.property && r.property.country) || null,
    storm_days: num(s.stormDays), hail_days: num(s.hailDays), wind_days: num(s.windDays), tornado_days: num(s.tornadoDays), hail_days_near: num(s.hailDaysNearProperty),
    largest_hail: pick(s.largestHail, ['sizeIn', 'sizeName', 'date', 'where', 'confidence']),
    strongest_wind: pick(s.strongestWind, ['mph', 'distanceMi', 'source', 'date', 'confidence']),
    closest_tornado: pick(s.closestTornado, ['distanceMi', 'date', 'efScale', 'confidence']),
    hail: ((r.hail && r.hail.events) || []).slice(0, 40).map((e) => pick(e, ['date', 'atPropertyIn', 'within1MiIn', 'within3MiIn', 'within5MiIn', 'largestReport', 'confidence', 'damageChance'])),
    wind: ((r.wind && r.wind.events) || []).slice(0, 40).map((e) => pick(e, ['date', 'within1MiMph', 'within3MiMph', 'within5MiMph', 'damageReports', 'station', 'tornado', 'confidence', 'damageChance'])),
    days: (r.stormDays || []).slice(0, 80).map((e) => pick(e, ['date', 'hazards', 'confidence', 'maxHailIn', 'maxGustMph', 'evidence'])),
    has_map: (order.files || []).some((f) => f && f.name === 'map.png') || !!(r.map && (r.map.imageUrl || r.map.swath)),
    nothing_found: !!(r.billing && r.billing.charged === false)
  };
}
// The five Storm Report PDFs. Date of Loss needs a date, asked when it's downloaded.
export function stormDocuments() {
  return Object.entries(rq.STORM_TEMPLATES).map(([template, title]) => ({ template, title, needs_date_of_loss: template === 'date_of_loss' }));
}

// ---------- following progress ----------
// RoofQuery status → ours. Never moves an order backwards (webhooks can arrive out of order).
const RANK = { awaiting_payment: 0, pending: 1, in_progress: 2, needs_info: 2, delivered: 3, failed: 4, cancelled: 4 };
function measurements(t, structures) {
  if (!t) return null;
  // Rapid Squares: outlines and one estimated pitch per building, with squares at every pitch.
  if (!t.edgeTotals && (structures || []).some((s) => s.squaresByPitch)) return {
    kind: 'rapid_squares', total_area_sqft: t.totalAreaSqFt, total_squares: t.totalSquares, structures: t.structureCount,
    footprint_sqft: t.footprintSqFt, perimeter_ft: t.perimeterFt,
    buildings: structures.map((s) => ({ index: s.index, total_squares: s.totalSquares, total_area_sqft: s.totalAreaSqFt, estimated_pitch: s.estimatedPitch, footprint_sqft: s.footprintSqFt, perimeter_ft: s.perimeterFt, squares_by_pitch: s.squaresByPitch || {} }))
  };
  const e = t.edgeTotals || {}, len = (k) => (e[k] ? Math.round(e[k].lengthFt * 10) / 10 : 0);
  return {
    total_area_sqft: t.totalAreaSqFt, total_squares: t.totalSquares, facets: t.facetCount, structures: t.structureCount,
    complexity: t.complexity, estimated_attic_sqft: t.estimatedAtticSqFt, hips_and_ridges_ft: t.hipsAndRidgesLengthFt, total_edge_ft: t.totalEdgeLengthFt,
    pitch_breakdown: Object.entries(t.pitchAreas || {}).map(([pitch, a]) => ({ pitch, area_sqft: a })).sort((a, b) => b.area_sqft - a.area_sqft),
    lengths_ft: { eave: len('EAVE'), rake: len('RAKE'), ridge: len('RIDGE'), hip: len('HIP'), valley: len('VALLEY'), step_flashing: len('STEP_FLASHING'), wall_flashing: len('WALL_FLASHING'), parapet: len('PARAPET'), bend: len('BEND'), other: len('OTHER') },
    buildings: (structures || []).map((s) => ({ index: s.index, total_squares: s.totalSquares, total_area_sqft: s.totalAreaSqFt, predominant_pitch: s.predominantPitch, facets: s.facetCount }))
  };
}
// The database hands JSON back with its keys reordered, so compare with the keys sorted.
const stableJson = (v) => Array.isArray(v) ? '[' + v.map(stableJson).join(',') + ']'
  : v && typeof v === 'object' ? '{' + Object.keys(v).sort().map((k) => JSON.stringify(k) + ':' + stableJson(v[k])).join(',') + '}' : JSON.stringify(v);
const sameJson = (a, b) => stableJson(a) === stableJson(b);
export async function apply(order, r) {
  const st = r.status;
  const patch = { rq_status: st, rq_checked_at: now() };
  let next = null;
  if (st === 'processing') next = 'pending';
  else if (st === 'in-progress') { next = 'in_progress'; patch.status_detail = null; }
  else if (st === 'on-hold') { next = 'in_progress'; patch.status_detail = 'Paused while the property is checked'; }
  else if (['completed', 'revisions_requested', 'revision_completed', 'updated'].includes(st)) {
    if (r.totals) {
      patch.total_squares = r.totals.totalSquares;
      // Rapid Squares has no predominant pitch: use the largest building's estimated pitch.
      patch.predominant_pitch = r.totals.predominantPitch || (r.structures && r.structures[0] && r.structures[0].estimatedPitch) || null;
      patch.measurements = measurements(r.totals, r.structures);
    }
    patch.completed_at = r.completedAt || order.completed_at || now();
    patch.status_detail = st === 'revisions_requested' ? 'Revision in progress' : null;
    next = 'delivered';
  } else if (st === 'cancelled') {
    next = 'failed';
    patch.status_detail = 'Couldn’t be measured' + (r.reason ? ': ' + r.reason : '');
  } else if (r.statusDetail && r.statusDetail.label) patch.status_detail = r.statusDetail.label;
  if (next && RANK[next] >= RANK[order.status]) patch.status = next;
  // RoofQuery can still deliver an order it cancelled. The customer was refunded then, so it's theirs at no charge.
  const lateDelivery = next === 'delivered' && order.status === 'failed' && order.roofquery_order_id;
  if (lateDelivery) patch.status = 'delivered';
  // First word that measuring has started: claimed with a guarded update so it's emailed once.
  let started = false;
  if (next === 'in_progress' && order.status === 'pending') started = (await db.update('report_orders', { id: eq(order.id), status: eq('pending') }, { status: 'in_progress' })).length === 1;
  const [saved] = await db.update('report_orders', { id: eq(order.id) }, patch);
  if (!saved) return order;
  if (started && saved.status === 'in_progress') await tellStarted(saved);
  if (lateDelivery) await alertAdmin(`RS-${saved.report_number} was delivered after all`, `RoofQuery delivered RS-${saved.report_number} (${saved.address}) after cancelling it. The customer was refunded when it was cancelled, so it's been sent to them at no charge.`);
  if (saved.status === 'delivered' && order.status !== 'delivered') await tellReady(saved);
  // A delivered report came back corrected (a finished revision, or new measurements): send the new files.
  else if (saved.status === 'delivered' && order.status === 'delivered' && order.roofquery_order_id) {
    // A finished revision: the order goes from revisions_requested back to completed (revision_completed is only an event now).
    const revised = (order.rq_status === 'revisions_requested' && st === 'completed') || (st === 'revision_completed' && order.rq_status !== 'revision_completed');
    const changed = !!patch.measurements && !sameJson(patch.measurements, order.measurements);
    if (revised || changed) await tellCorrected(saved);
  }
  if (saved.status === 'failed' && order.status !== 'failed') await refundAndTell(saved, r.reason || 'The roof couldn’t be measured from the available imagery.');
  return saved;
}

// Webhook from RoofQuery. We only use the order id from it and read the real state from the API
// with our key, so a forged webhook can't change anything.
export async function onWebhook(body) {
  const id = body && (body.orderId || (body.order && body.order.orderId) || (body.data && body.data.orderId));
  if (!id || typeof id !== 'string') return { ignored: 'no order id' };
  const order = await db.one('report_orders', { roofquery_order_id: eq(id) });
  if (!order) return { ignored: 'unknown order' };
  let r;
  try { r = await rq.getOrder(id); }
  catch (e) { if (e.status === 404) return { ignored: 'not found at RoofQuery' }; throw e; }
  await apply(order, r);
  return { received: true };
}

// ---------- telling people ----------
async function recipient(order) {
  if (order.guest_email) return { to: order.guest_email, name: order.guest_name, guest: true };
  const u = order.ordered_by ? await db.one('users', { id: eq(order.ordered_by), select: 'email,full_name' }) : null;
  if (u && u.email) return { to: u.email, name: u.full_name, guest: false };
  const c = order.company_id ? await db.one('companies', { id: eq(order.company_id), select: 'email,name' }) : null;
  return c && c.email ? { to: c.email, name: c.name, guest: false } : null;
}
// "We're measuring it now": sent when RoofQuery starts on a roof report.
async function tellStarted(order) {
  try {
    const who = await recipient(order);
    if (!who) return;
    const p = (await db.one('products', { id: eq(order.report_type) })) || { label: order.report_type };
    const first = String(who.name || '').split(' ')[0];
    const m = p.delivery_minutes;
    const when = m ? ` It\u2019s usually ready within ${m >= 60 ? (Math.round(m / 60) === 1 ? 'an hour' : Math.round(m / 60) + ' hours') : m + ' minutes'}.` : '';
    await email.send({ to: who.to, subject: `We\u2019re measuring RS-${order.report_number} now`,
      text: `Hi${first ? ' ' + first : ''},\n\nOur team has started measuring the roof at ${order.address} for your ${p.label}.${when}\n\nWe\u2019ll email you the report as soon as it\u2019s done. You can also follow it here: ${config.appUrl}/report.html?id=${order.id}` });
  } catch (e) { console.error('[email] measuring started for RS-' + order.report_number, e.message); }
}
// Order confirmation, sent once the order is paid (or covered by a free report).
export async function tellPlaced(order, { customer = true } = {}) {
  try {
    const p = (await db.one('products', { id: eq(order.report_type) })) || { label: order.report_type };
    const label = p.label + (order.esx_purchased ? ' + ESX file' : '');
    const total = order.used_free_report ? 'Free (one of your free reports)' : money(order.price_cents);
    const eta = p.delivery_minutes ? `\nUsually ready within ${p.delivery_minutes >= 60 ? Math.round(p.delivery_minutes / 60) + ' hour' + (p.delivery_minutes >= 120 ? 's' : '') : p.delivery_minutes + ' minutes'}.` : '';
    const who = customer ? await recipient(order) : null;
    if (who) {
      const first = String(who.name || '').split(' ')[0];
      const track = who.guest ? '\n\nWe\u2019ll email you here with download links when it\u2019s ready.' : `\n\nTrack it on your Rapid Squares home page: ${config.appUrl}/orders.html\nWe\u2019ll email you when it\u2019s ready.`;
      await email.send({ to: who.to, subject: `Order RS-${order.report_number} received`,
        text: `Hi${first ? ' ' + first : ''},\n\nThanks for your order.\n\nOrder: RS-${order.report_number}\nReport: ${label}\nProperty: ${order.address}\nTotal: ${total}${order.receipt_url ? '\nReceipt: ' + order.receipt_url : ''}${eta}${track}` });
    }
    if (config.orderAlerts && config.adminEmail) {
      const by = await orderedBy(order);
      await email.send({ to: config.adminEmail, subject: `[Rapid Squares] New order RS-${order.report_number}: ${p.label}`,
        text: `New order RS-${order.report_number}\n\nReport: ${label}\nProperty: ${order.address}\nTotal: ${total}\nOrdered by: ${by}` });
    }
  } catch (e) { console.error('[email] order confirmation for RS-' + order.report_number, e.message); }
}
async function orderedBy(order) {
  if (order.guest_email) return `${order.guest_name || 'Guest'} <${order.guest_email}> (guest)`;
  const [u, c] = await Promise.all([
    order.ordered_by ? db.one('users', { id: eq(order.ordered_by), select: 'full_name,email' }) : null,
    order.company_id ? db.one('companies', { id: eq(order.company_id), select: 'name' }) : null
  ]);
  return [u && `${u.full_name} <${u.email}>`, c && c.name].filter(Boolean).join(', ') || 'Unknown';
}
// A finished file as an email attachment, in the company's branding. Null if it can't be fetched right now
// (the email then gives a link for it instead).
const MAX_ATTACH = 35 * 1024 * 1024; // Resend allows 40 MB per email in all
export async function attachment(order, kind) {
  if (!order.roofquery_order_id) return null;
  try {
    const template = /^storm-/.test(kind) ? kind.slice(6) : null;
    const company = order.company_id ? await db.one('companies', { id: eq(order.company_id) }) : null;
    const brand = (kind === 'pdf' || template) && company ? await rq.ensureBrand(company) : null;
    const res = template ? await rq.fetchStormPdf(order.roofquery_order_id, template, { brand, details: order.order_details || {} })
      : await rq.fetchFile(order.roofquery_order_id, kind, { brand, esxPaid: !!order.esx_purchased });
    const content = Buffer.from(await res.arrayBuffer());
    const street = String(order.address || '').split(',')[0].replace(/[^A-Za-z0-9]+/g, '_').replace(/^_|_$/g, '').slice(0, 40);
    const filename = template ? `RS-${order.report_number}_${template}.pdf` : `RS-${order.report_number}${street ? '_' + street : ''}.${kind}`;
    return { filename, content };
  } catch (e) {
    console.error('[email] couldn\u2019t attach', kind, 'for RS-' + order.report_number, e.message);
    return null;
  }
}
// Attaches what fits; anything that couldn't be fetched (or would make the email too big) gets a link line.
async function attachOrLink(order, files, ttl) {
  const attachments = [], links = [];
  let total = 0;
  for (const f of files) {
    const a = await attachment(order, f.kind);
    if (a && total + a.content.length <= MAX_ATTACH) { attachments.push(a); total += a.content.length; }
    else links.push(`${f.label}: ${downloadUrl(order.id, f.kind, ttl)}`);
  }
  return { attachments, links };
}

async function tellReady(order) {
  // Only once, even if two webhooks race.
  const claimed = await db.update('report_orders', { id: eq(order.id), ready_notified: eq(false) }, { ready_notified: true });
  if (!claimed.length) return;
  if (config.orderAlerts && config.adminEmail) {
    await email.send({ to: config.adminEmail, subject: `[Rapid Squares] Order RS-${order.report_number} completed`,
      text: `RS-${order.report_number} is ready.\n\nProperty: ${order.address}${order.total_squares != null ? `\n${order.total_squares} squares, ${order.predominant_pitch} predominant pitch` : ''}\nOrdered by: ${await orderedBy(order)}\n\nPDF (link works for 30 days): ${downloadUrl(order.id, order.report_type === 'storm_report' ? 'storm-weather_history' : 'pdf', 30 * 24 * 60 * MIN)}` });
  }
  const who = await recipient(order);
  if (!who) return;
  const first = String(who.name || '').split(' ')[0];
  if (order.report_type === 'storm_report') {
    const ttl = (who.guest ? 365 : 30) * 24 * 60 * MIN;
    // The PDFs are attached. Date of Loss is only included when a date was given with the order.
    const hasDate = !!(order.order_details && order.order_details.date_of_loss);
    const files = stormDocuments().filter((d) => !d.needs_date_of_loss || hasDate).map((d) => ({ kind: 'storm-' + d.template, label: d.title }));
    const { attachments, links } = await attachOrLink(order, files, ttl);
    const head = order.measurements && order.measurements.storm && order.measurements.storm.headline;
    const got = attachments.length ? `\n\nThe PDFs are attached${links.length ? '. These couldn\u2019t be attached; download them here:' : '.'}` : '\n\nDownload the PDFs:';
    // The only email for a storm report, so it carries the order details too.
    const paid = `\n\nOrder: RS-${order.report_number}\nTotal: ${order.used_free_report ? 'Free' : money(order.price_cents || 0)}${order.receipt_url ? '\nReceipt: ' + order.receipt_url : ''}`;
    await email.send({ to: who.to, subject: `Your storm report RS-${order.report_number} is ready`, attachments,
      text: `Hi${first ? ' ' + first : ''},\n\nYour storm report for ${order.address} is ready.${head ? '\n\n' + head : ''}${paid}${got}${links.length ? '\n' + links.join('\n') : ''}\n\n${who.guest ? (links.length ? 'These links work for a year. Keep this email.' : 'Keep this email for your records.') : `See the full report, add a date of loss or claim number, and download every PDF: ${config.appUrl}/storm-report.html?id=${order.id}`}` });
    return;
  }
  const size = order.total_squares != null ? `\n${order.total_squares} squares, ${order.predominant_pitch} predominant pitch.` : '';
  // The PDF (and the ESX file, if bought) are attached; anything that can't be fetched right now gets a link instead.
  const ttl = (who.guest ? 365 : 30) * 24 * 60 * MIN;
  const files = [{ kind: 'pdf', label: 'Download the PDF report' }, ...(order.esx_purchased ? [{ kind: 'esx', label: 'Download the Xactimate (ESX) file' }] : [])];
  const { attachments, links: fileLinks } = await attachOrLink(order, files, ttl);
  let links = (attachments.length ? `\n\n${attachments.length === 2 ? 'The PDF report and the Xactimate (ESX) file are attached.' : attachments[0].filename.endsWith('.esx') ? 'The Xactimate (ESX) file is attached.' : 'The PDF report is attached.'}` : '')
    + (fileLinks.length ? '\n\n' + fileLinks.join('\n') : '');
  links += who.guest ? (fileLinks.length ? '\n\nThese links work for a year. Keep this email.' : '\n\nKeep this email for your records.')
    : `\n\nYou can download the report again any time from your Rapid Squares home page: ${config.appUrl}/orders.html`;
  await email.send({ to: who.to, subject: `Your roof report RS-${order.report_number} is ready`, attachments,
    text: `Hi${first ? ' ' + first : ''},\n\nYour report for ${order.address} is ready.${size}${links}` });
}
// The corrected report, with the new PDF (and ESX, if bought) attached.
async function tellCorrected(order) {
  const who = await recipient(order);
  if (!who) return;
  const first = String(who.name || '').split(' ')[0];
  const ttl = (who.guest ? 365 : 30) * 24 * 60 * MIN;
  const files = [{ kind: 'pdf', label: 'Download the corrected PDF report' }, ...(order.esx_purchased ? [{ kind: 'esx', label: 'Download the corrected Xactimate (ESX) file' }] : [])];
  const { attachments, links } = await attachOrLink(order, files, ttl);
  const size = order.total_squares != null ? `\n${order.total_squares} squares, ${order.predominant_pitch} predominant pitch.` : '';
  await email.send({ to: who.to, subject: `Your corrected report RS-${order.report_number} is ready`, attachments,
    text: `Hi${first ? ' ' + first : ''},\n\nYour report for ${order.address} has been corrected.${size}${attachments.length ? `\n\nThe corrected ${attachments.length === 2 ? 'PDF report and ESX file are' : 'PDF report is'} attached. Use these instead of the earlier ones.` : ''}${links.length ? '\n\n' + links.join('\n') : ''}${who.guest ? '' : `\n\nYour Rapid Squares home page always has the latest version: ${config.appUrl}/orders.html`}` });
}
// ---------- ESX bought after delivery ----------
export async function esxPriceFor(order) {
  const p = await db.one('products', { id: eq('esx_addon') });
  if (!p) return 500;
  if (order.company_id) {
    const c = await db.one('companies', { id: eq(order.company_id), select: 'subscription_status,email' });
    const u = order.ordered_by ? await db.one('users', { id: eq(order.ordered_by), select: 'email' }) : null;
    // FREE_ACCOUNT_EMAILS: no charge.
    if ([c && c.email, u && u.email].some((e) => e && config.freeAccounts.has(String(e).toLowerCase()))) return 0;
    if (c && c.subscription_status === 'active') return p.subscriber_price_cents;
  }
  return p.price_cents;
}
// Marks the ESX as bought (once) and emails the download link.
export async function esxPaid(orderId, paymentId, receiptUrl, priceCents) {
  const order = await db.one('report_orders', { id: eq(orderId) });
  if (!order || order.esx_purchased) return order;
  const patch = { esx_purchased: true, esx_purchased_at: now(), esx_payment_id: paymentId || null, esx_receipt_url: receiptUrl || null };
  if (priceCents != null) patch.esx_price_cents = priceCents;
  else if (order.esx_price_cents == null) patch.esx_price_cents = await esxPriceFor(order);
  const claimed = await db.update('report_orders', { id: eq(order.id), esx_purchased: eq(false) }, patch);
  if (!claimed.length) return order;
  const saved = claimed[0];
  // Add it to the RoofQuery order now, so it's ready with the report (a download adds it too, if this fails).
  // Not placed yet: the order goes to RoofQuery with the ESX included.
  if (saved.roofquery_order_id) await rq.addEsx(saved.roofquery_order_id).catch((e) => console.error('[roofquery] adding ESX to RS-' + saved.report_number, e.code || '', e.message));
  try {
    const who = await recipient(saved);
    if (who) {
      const ttl = (who.guest ? 365 : 30) * 24 * 60 * MIN;
      const { attachments, links } = await attachOrLink(saved, [{ kind: 'esx', label: 'Download the Xactimate (ESX) file' }], ttl);
      await email.send({ to: who.to, subject: `Your ESX file for RS-${saved.report_number}`, attachments,
        text: `Thanks for your purchase.\n\n${attachments.length ? 'The Xactimate (ESX) file is attached.' : links[0]}\nProperty: ${saved.address}\nTotal: ${money(saved.esx_price_cents || 0)}${saved.esx_receipt_url ? '\nReceipt: ' + saved.esx_receipt_url : ''}` });
    }
    if (config.orderAlerts && config.adminEmail) {
      await email.send({ to: config.adminEmail, subject: `[Rapid Squares] ESX file bought for RS-${saved.report_number}`,
        text: `ESX file bought for RS-${saved.report_number} (${money(saved.esx_price_cents || 0)}).\n\nProperty: ${saved.address}\nOrdered by: ${await orderedBy(saved)}` });
    }
  } catch (e) { console.error('[email] ESX purchase for RS-' + saved.report_number, e.message); }
  return saved;
}

async function refundAndTell(order, reason) {
  // Claim the refund first so it can only happen once.
  const claimed = await db.update('report_orders', { id: eq(order.id), refunded_at: 'is.null' }, { refunded_at: now() });
  if (!claimed.length) return;
  let refundNote = '';
  try {
    if (order.used_free_report && order.company_id) {
      const c = await db.one('companies', { id: eq(order.company_id), select: 'free_reports_remaining' });
      if (c) await db.update('companies', { id: eq(order.company_id) }, { free_reports_remaining: c.free_reports_remaining + 1 });
      refundNote = 'Your free report has been added back to your account.';
    } else if (order.price_cents > 0) {
      const id = await stripe.refundOrder(order);
      if (id) { await db.update('report_orders', { id: eq(order.id) }, { refund_id: id }); refundNote = `We've refunded ${money(order.price_cents)} to your card. It can take 5 to 10 days to show.`; }
      else if (order.stripe_payment_id) refundNote = 'We’ll refund your payment.';
    }
  } catch (e) {
    console.error('[refund] failed for RS-' + order.report_number, e.message);
    await db.update('report_orders', { id: eq(order.id) }, { refunded_at: null });
    await alertAdmin(`Refund needed for RS-${order.report_number}`, `RS-${order.report_number} (${order.address}) couldn't be measured, but the automatic refund failed: ${e.message}\n\nRefund ${money(order.price_cents)} by hand in Stripe.`);
    refundNote = 'We’ll refund your payment shortly.';
  }
  const who = await recipient(order);
  if (who) await email.send({ to: who.to, subject: `We couldn't complete report RS-${order.report_number}`,
    text: `Hi${who.name ? ' ' + String(who.name).split(' ')[0] : ''},\n\nWe couldn't complete your report for ${order.address}.\nReason: ${reason}\n\n${refundNote}`.trim() });
}
async function alertAdmin(subject, text) {
  console.warn('[admin]', subject);
  if (config.adminEmail) await email.send({ to: config.adminEmail, subject: '[Rapid Squares] ' + subject, text });
}

// ---------- background: check on orders whose webhook may have been missed ----------
let running = false;
export async function tick() {
  if (running || !rq.connected()) return;
  running = true;
  try {
    const stale = new Date(Date.now() - 15 * MIN).toISOString();
    const open = await db.select('report_orders', { roofquery_order_id: 'not.is.null', status: inList(['pending', 'in_progress']), rq_checked_at: 'lt.' + stale, order: 'rq_checked_at.asc', limit: 20 });
    for (const o of open) {
      try { await apply(o, await rq.getOrder(o.roofquery_order_id)); }
      catch (e) { await db.update('report_orders', { id: eq(o.id) }, { rq_checked_at: now() }); }
    }
  } catch (e) { console.error('[sync]', e.message); }
  finally { running = false; }
}
export function startSync() {
  if (!rq.connected()) return;
  setTimeout(tick, 10000);
  setInterval(tick, config.roofquery.syncEverySeconds * 1000).unref();
}
