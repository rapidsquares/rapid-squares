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
const BACKOFF = [5, 15, 60, 180];
const PERMANENT = new Set(['ADDRESS_INCOMPLETE', 'VALIDATION', 'validation']);
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
// Sends a paid order to RoofQuery. Never throws: problems are recorded on the order and retried.
export async function place(orderId) {
  if (!rq.connected()) return null;
  const order = await db.one('report_orders', { id: eq(orderId) });
  if (!order || order.status !== 'pending' || order.roofquery_order_id) return order;
  try {
    const r = await rq.placeOrder(order);
    const [saved] = await db.update('report_orders', { id: eq(order.id) }, { roofquery_order_id: r.orderId, rq_status: r.status, rq_error: null, rq_next_try_at: null, rq_checked_at: now(), status_detail: null });
    return apply(saved, r);
  } catch (e) {
    const attempts = (order.rq_attempts || 0) + 1;
    const why = `${e.code || 'error'}: ${e.message}`;
    if (PERMANENT.has(e.code)) {
      // Our data can't be fixed by retrying: refund and tell everyone.
      const [saved] = await db.update('report_orders', { id: eq(order.id) }, { rq_attempts: attempts, rq_error: why, rq_next_try_at: null, status: 'failed', status_detail: 'We couldn’t place this order: ' + e.message });
      await alertAdmin(`Order RS-${order.report_number} couldn't be placed`, `RoofQuery refused RS-${order.report_number} (${order.address}).\n\n${why}\n\nThe customer has been refunded.`);
      await refundAndTell(saved, 'We couldn’t place the order for this address (' + e.message + ').');
      return saved;
    }
    const wait = BACKOFF[Math.min(attempts - 1, BACKOFF.length - 1)];
    const [saved] = await db.update('report_orders', { id: eq(order.id) }, {
      rq_attempts: attempts, rq_error: why, rq_next_try_at: new Date(Date.now() + wait * MIN).toISOString(),
      status_detail: 'Queued: sending to the measuring team'
    });
    if (attempts === 1 && BALANCE.has(e.code)) {
      await alertAdmin('RoofQuery balance too low: orders are waiting',
        `RS-${order.report_number} couldn't be sent to RoofQuery because the account balance won't cover it (${e.code}).\n\nAdd credit in the RoofQuery portal. Waiting orders are retried automatically (next try in ${wait} minutes).`);
    } else if (attempts === 3) {
      await alertAdmin(`RS-${order.report_number} still not sent to RoofQuery`, `Three tries so far for RS-${order.report_number} (${order.address}).\n\nLast error: ${why}\n\nIt will keep retrying every few hours.`);
    }
    return saved;
  }
}

// ---------- following progress ----------
// RoofQuery status → ours. Never moves an order backwards (webhooks can arrive out of order).
const RANK = { awaiting_payment: 0, pending: 1, in_progress: 2, needs_info: 2, delivered: 3, failed: 4, cancelled: 4 };
function measurements(t, structures) {
  if (!t) return null;
  const e = t.edgeTotals || {}, len = (k) => (e[k] ? Math.round(e[k].lengthFt * 10) / 10 : 0);
  return {
    total_area_sqft: t.totalAreaSqFt, total_squares: t.totalSquares, facets: t.facetCount, structures: t.structureCount,
    complexity: t.complexity, estimated_attic_sqft: t.estimatedAtticSqFt, hips_and_ridges_ft: t.hipsAndRidgesLengthFt, total_edge_ft: t.totalEdgeLengthFt,
    pitch_breakdown: Object.entries(t.pitchAreas || {}).map(([pitch, a]) => ({ pitch, area_sqft: a })).sort((a, b) => b.area_sqft - a.area_sqft),
    lengths_ft: { eave: len('EAVE'), rake: len('RAKE'), ridge: len('RIDGE'), hip: len('HIP'), valley: len('VALLEY'), step_flashing: len('STEP_FLASHING'), wall_flashing: len('WALL_FLASHING'), parapet: len('PARAPET'), bend: len('BEND'), other: len('OTHER') },
    buildings: (structures || []).map((s) => ({ index: s.index, total_squares: s.totalSquares, total_area_sqft: s.totalAreaSqFt, predominant_pitch: s.predominantPitch, facets: s.facetCount }))
  };
}
export async function apply(order, r) {
  const st = r.status;
  const patch = { rq_status: st, rq_checked_at: now() };
  let next = null;
  if (st === 'processing') next = 'pending';
  else if (st === 'in-progress') { next = 'in_progress'; patch.status_detail = null; }
  else if (st === 'on-hold') { next = 'in_progress'; patch.status_detail = 'Paused while the property is checked'; }
  else if (['completed', 'revisions_requested', 'revision_completed', 'updated'].includes(st)) {
    if (r.totals) {
      patch.total_squares = r.totals.totalSquares; patch.predominant_pitch = r.totals.predominantPitch;
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
  const [saved] = await db.update('report_orders', { id: eq(order.id) }, patch);
  if (!saved) return order;
  if (saved.status === 'delivered' && order.status !== 'delivered') await tellReady(saved);
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
async function tellReady(order) {
  // Only once, even if two webhooks race.
  const claimed = await db.update('report_orders', { id: eq(order.id), ready_notified: eq(false) }, { ready_notified: true });
  if (!claimed.length) return;
  const who = await recipient(order);
  if (!who) return;
  const first = String(who.name || '').split(' ')[0];
  const size = order.total_squares != null ? `\n${order.total_squares} squares, ${order.predominant_pitch} predominant pitch.` : '';
  let links;
  if (who.guest) {
    const year = 365 * 24 * 60 * MIN;
    links = `\n\nDownload the PDF report: ${downloadUrl(order.id, 'pdf', year)}` + (order.esx_purchased ? `\nDownload the Xactimate (ESX) file: ${downloadUrl(order.id, 'esx', year)}` : '') + '\n\nThese links work for a year. Keep this email.';
  } else links = `\n\nDownload it from your order history: ${config.appUrl}/orders.html`;
  await email.send({ to: who.to, subject: `Your roof report RS-${order.report_number} is ready`,
    text: `Hi${first ? ' ' + first : ''},\n\nYour report for ${order.address} is ready.${size}${links}` });
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

// ---------- background: retry failed placements, and check on orders whose webhook may have been missed ----------
let running = false;
export async function tick() {
  if (running || !rq.connected()) return;
  running = true;
  try {
    const retry = await db.select('report_orders', { status: eq('pending'), roofquery_order_id: 'is.null', rq_attempts: 'gt.0', rq_next_try_at: 'lte.' + now(), order: 'rq_next_try_at.asc', limit: 10 });
    for (const o of retry) await place(o.id);
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
