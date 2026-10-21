// All /api routes. Matches the API contract in the Company Data Schema doc and the
// placeholder in the website's mock-api.js, so pages behave the same on either.
import crypto from 'node:crypto';
import { config, connected } from './config.js';
import { fail, readJson, readForm, readBody } from './http.js';
import { db, storage, eq, inList, gte } from './supabase.js';
import { member, signedIn, effectivePerms, cleanPerms, userOut, ALL_PERMS } from './access.js';
import { roofquery, stripe, email } from './services.js';
import * as fulfillment from './fulfillment.js';

const DAY = 86400000;
const INVITE_DAYS = 7; // invitations always expire after 7 days
const str = (v, max = 200) => String(v ?? '').trim().slice(0, max);
const emailOk = (e) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e);
const startOfMonth = () => { const d = new Date(); return new Date(d.getFullYear(), d.getMonth(), 1).toISOString(); };
const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex');
const newToken = () => crypto.randomBytes(24).toString('base64url');
const inviteUrl = (token) => `${config.appUrl}/signin.html?invite=${encodeURIComponent(token)}`;
const IMAGE_TYPES = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp', 'image/gif': 'gif', 'image/svg+xml': 'svg' };

async function products() {
  const rows = await db.select('products', { order: 'sort.asc' });
  return Object.fromEntries(rows.map((p) => [p.id, p]));
}
function companyOut(c) {
  const { stripe_config, stripe_customer_id, subscription_status, subscription_plan, subscription_renews_at, free_reports_remaining, trial_used, trial_ends_at, ...rest } = c;
  return rest;
}
function orderOut(o, prods, people) {
  const p = prods[o.report_type] || { label: o.report_type };
  const out = {
    id: o.id, report_number: 'RS-' + o.report_number, company_id: o.company_id, ordered_by: o.ordered_by,
    ordered_by_name: (people[o.ordered_by] && people[o.ordered_by].full_name) || 'Former team member',
    report_type: o.report_type, product_label: p.label, address: o.address, lat: o.lat, lon: o.lon, status: o.status, rq_status: o.rq_status || null,
    status_detail: o.status_detail, price_cents: o.price_cents, esx_purchased: o.esx_purchased, used_free_report: o.used_free_report,
    total_squares: o.total_squares === null ? null : Number(o.total_squares), predominant_pitch: o.predominant_pitch,
    measurements: o.measurements, created_at: o.created_at, completed_at: o.completed_at, refunded: !!o.refunded_at,
    esx_available: o.status === 'delivered' && !o.esx_purchased && !!p.esx_addon_allowed,
    order_details: o.order_details || null
  };
  if (o.report_type === 'storm_report' && o.status === 'delivered') out.documents = fulfillment.stormDocuments();
  if (o.status === 'pending' || o.status === 'in_progress') out.eta = new Date(new Date(o.created_at).getTime() + (p.delivery_minutes ?? 120) * 60000).toISOString();
  return out;
}
async function peopleById(companyId) {
  const rows = await db.select('users', { company_id: eq(companyId), select: 'id,full_name' });
  return Object.fromEntries(rows.map((u) => [u.id, u]));
}
async function imageUpload(req) {
  const form = await readForm(req, 10 * 1024 * 1024);
  const file = form.get('file');
  if (!file || typeof file === 'string') fail(422, 'no_file', 'Choose an image to upload.');
  const ext = IMAGE_TYPES[file.type];
  if (!ext) fail(422, 'bad_file', 'Upload a PNG, JPG, WebP, GIF or SVG image.');
  if (file.size > 10 * 1024 * 1024) fail(422, 'file_too_large', 'That image is over 10 MB. Choose a smaller one.');
  return { bytes: Buffer.from(await file.arrayBuffer()), type: file.type, ext };
}

// Simple per-visitor limit for routes anyone can call without signing in.
const hits = new Map();
function rateLimit(req, key, max, windowMs, message) {
  const ip = req ? String(req.headers['x-forwarded-for'] || req.socket.remoteAddress || '').split(',')[0].trim() : '';
  const k = key + '|' + ip, now = Date.now();
  const list = (hits.get(k) || []).filter((t) => now - t < windowMs);
  if (list.length >= max) fail(429, 'too_many', message || 'Too many orders from this connection. Try again later, or create a free account.');
  list.push(now); hits.set(k, list);
  if (hits.size > 5000) for (const [kk, v] of hits) if (!v.some((t) => now - t < windowMs)) hits.delete(kk);
}
function publicProducts(p) {
  return Object.values(p).filter((x) => x.id !== 'esx_addon').map((x) => ({ id: x.id, label: x.label, price_cents: x.price_cents, subscriber_price_cents: x.subscriber_price_cents, available: x.available, esx_addon_allowed: x.esx_addon_allowed, delivery_minutes: x.delivery_minutes }));
}

// Paid (or free): mark the order pending and send it to RoofQuery when that's connected.
// A placement problem never fails the customer's request: it's recorded and retried in the background.
async function markPaidAndPlace(order, company, payment) {
  const patch = { status: 'pending', status_detail: roofquery.connected() ? null : 'Waiting for RoofQuery to be connected' };
  if (payment && payment.payment_id) patch.stripe_payment_id = payment.payment_id;
  if (payment && payment.receipt_url) patch.receipt_url = payment.receipt_url;
  const [saved] = await db.update('report_orders', { id: eq(order.id) }, patch);
  await fulfillment.tellPlaced(saved); // confirmation to the customer (+ copy to ADMIN_EMAIL)
  if (!roofquery.connected()) return saved;
  try { return (await fulfillment.place(saved.id)) || saved; }
  catch (e) { console.error('[roofquery] placing RS-' + saved.report_number, e.message); return saved; }
}
// Street / city / state / postal code / country from the address lookup (Azure Maps).
function addressPartsIn(b) {
  const p = b && typeof b.parts === 'object' && b.parts ? b.parts : {};
  const out = { street: str(p.street, 200), city: str(p.city, 100), state: str(p.state, 40), postalCode: str(p.postalCode, 12), country: str(p.country, 3).toUpperCase() };
  return Object.values(out).some(Boolean) ? out : null;
}
// Optional job details entered when ordering: claim number, client name / email / phone, notes.
// A Storm Report also uses them as the starting details for its PDFs (claim number, insured name, notes).
function jobDetailsIn(b, type) {
  const j = b && typeof b.job === 'object' && b.job ? b.job : {};
  const out = { claim: str(j.claim, 64), client_name: str(j.client_name, 120), client_email: str(j.client_email, 160).toLowerCase(), client_phone: str(j.client_phone, 32), notes: String(j.notes ?? '').trim().slice(0, 450) };
  if (out.client_email && !emailOk(out.client_email)) fail(422, 'invalid', 'Check the client email, or leave it blank.');
  if (type === 'storm_report' && out.client_name) out.insured_name = out.client_name;
  Object.keys(out).forEach((k) => { if (!out[k]) delete out[k]; });
  return Object.keys(out).length ? out : null;
}
// A Storm Report PDF's details, asked when it's downloaded: date of loss, claim number, insured name, notes.
function stormDetailsIn(b) {
  const s = b && typeof b === 'object' ? b : {};
  const out = { date_of_loss: str(s.date_of_loss, 10), claim: str(s.claim, 64), insured_name: str(s.insured_name, 120), notes: String(s.notes ?? '').trim().slice(0, 450) };
  if (out.date_of_loss) {
    const d = new Date(out.date_of_loss + 'T12:00:00Z');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(out.date_of_loss) || isNaN(d)) fail(422, 'invalid', 'Enter the date of loss as a date, like 2025-05-25.');
    if (d.getTime() > Date.now() + DAY) fail(422, 'invalid', 'The date of loss can\u2019t be in the future.');
  }
  Object.keys(out).forEach((k) => { if (!out[k]) delete out[k]; });
  return out;
}
// Called from the Stripe webhook when a payment page is paid.
async function orderPaid(orderId, paymentIntentId, receiptUrl) {
  const order = await db.one('report_orders', { id: eq(orderId) });
  if (!order || order.status !== 'awaiting_payment') return; // already handled
  const company = order.company_id ? await db.one('companies', { id: eq(order.company_id) }) : null;
  const saved = await markPaidAndPlace(order, company, { payment_id: paymentIntentId, receipt_url: receiptUrl });
  return saved;
}
async function orderCancelled(orderId, why) {
  const order = await db.one('report_orders', { id: eq(orderId) });
  if (order && order.status === 'awaiting_payment') await db.update('report_orders', { id: eq(orderId) }, { status: 'cancelled', status_detail: why });
}

export function registerRoutes(r) {
  // ---------- no account needed ----------
  // Price list for visitors who aren't signed in (regular prices; free reports need an account).
  r.get('/api/public/products', async () => {
    const p = await products();
    return { products: publicProducts(p), esx_price_cents: p.esx_addon ? p.esx_addon.price_cents : 500, free_reports_remaining: 0, subscribed: false, signup_free_reports: config.freeReportsOnSignup, trial_days: stripe.connected() ? config.trialDays : 0,
      plans: { monthly_cents: config.stripe.monthlyCents, yearly_cents: config.stripe.yearlyCents } };
  });

  // Guest order: no account. Saved as awaiting payment; it is only sent to RoofQuery after payment.
  r.post('/api/guest-orders', async ({ req }) => {
    rateLimit(req, 'guest-order', 5, 60 * 60 * 1000);
    const b = await readJson(req);
    const prods = await products();
    const type = str(b.report_type) || 'premium_residential';
    const p = prods[type];
    if (!p || type === 'esx_addon') fail(422, 'invalid', 'Choose a report type.');
    if (!p.available) fail(422, 'unavailable', `${p.label} isn\u2019t available yet.`);
    const esx = !!b.esx;
    if (esx && !p.esx_addon_allowed) fail(422, 'invalid', `The ESX file isn\u2019t available for ${p.label}.`);
    if (!str(b.address) || typeof b.lat !== 'number' || typeof b.lon !== 'number' || Math.abs(b.lat) > 90 || Math.abs(b.lon) > 180) fail(422, 'invalid', 'Look up the property address first.');
    const emailAddr = str(b.email).toLowerCase();
    if (!emailOk(emailAddr)) fail(422, 'invalid', 'Enter the email address where we should send the report.');
    const name = str(b.name);
    if (!name) fail(422, 'invalid', 'Enter your name.');
    const job = jobDetailsIn(b, type);
    if (!stripe.connected() && !config.allowUnpaidTestOrders) fail(503, 'payments_not_connected', 'Guest ordering isn\u2019t open yet: payments aren\u2019t connected.');
    const esxPrice = prods.esx_addon ? prods.esx_addon.price_cents : 500;
    const price = p.price_cents + (esx ? esxPrice : 0);
    const [order] = await db.insert('report_orders', {
      company_id: null, ordered_by: null, guest_email: emailAddr, guest_name: name, guest_phone: str(b.phone, 40) || null,
      report_type: type, address: str(b.address, 300), address_parts: addressPartsIn(b), lat: b.lat, lon: b.lon, status: 'awaiting_payment', price_cents: price, esx_purchased: esx,
      order_details: job, status_detail: stripe.connected() ? 'Waiting for payment' : 'Test order: payment and RoofQuery aren\u2019t connected yet'
    });
    if (stripe.connected()) {
      const url = await stripe.checkoutForOrder({ customer: null, email: emailAddr, guest: true, amountCents: price, order,
        description: `${p.label}${esx ? ' + ESX' : ''} \u00b7 RS-${order.report_number}` });
      return { order: { report_number: 'RS-' + order.report_number, product_label: p.label, address: order.address, price_cents: price, esx_purchased: esx, status: order.status }, checkout_url: url, email: emailAddr };
    }
    await email.send({ to: emailAddr, subject: `Rapid Squares order RS-${order.report_number} received`,
      text: `Hi ${name},\n\nWe received your order for a ${p.label}${esx ? ' + ESX file' : ''} at ${order.address}.\nOrder number: RS-${order.report_number}\nTotal: $${(price / 100).toFixed(2)}\n\nWe'll email your report to this address when it's ready.` });
    return {
      order: { report_number: 'RS-' + order.report_number, product_label: p.label, address: order.address, price_cents: price, esx_purchased: esx, status: order.status },
      checkout_url: null, email: emailAddr
    };
  });

  // ---------- health ----------
  r.get('/api/health', async () => ({ ok: true, connected: connected() }));

  // ---------- signed-in user ----------
  r.get('/api/me', async ({ req }) => {
    const m = await member(req);
    return { user: userOut(m.user), company: { id: m.company.id, name: m.company.name }, permissions: m.perms };
  });
  r.patch('/api/me', async ({ req }) => {
    const m = await member(req); const b = await readJson(req);
    const patch = {};
    ['full_name', 'job_title', 'phone', 'office_phone', 'preferred_contact', 'timezone'].forEach((k) => { if (k in b) patch[k] = str(b[k]); });
    if ('full_name' in patch && !patch.full_name) fail(422, 'invalid', 'Enter your name.');
    const [u] = await db.update('users', { id: eq(m.user.id) }, patch);
    return { user: userOut(u) };
  });
  r.post('/api/me/avatar', async ({ req }) => {
    const m = await member(req); const f = await imageUpload(req);
    const url = await storage.uploadPublic('avatars', `${m.user.id}/avatar.${f.ext}`, f.bytes, f.type);
    await db.update('users', { id: eq(m.user.id) }, { avatar_url: url });
    return { avatar_url: url };
  });

  // ---------- first sign-up: create the company ----------
  r.post('/api/onboarding', async ({ req }) => {
    const auth = await signedIn(req); const b = await readJson(req);
    if (await db.one('users', { id: eq(auth.id) })) fail(409, 'already_member', 'Your account is already set up.');
    const name = str(b.company_name), fullName = str(b.full_name);
    if (!name) fail(422, 'invalid', 'Enter your company name.');
    if (!fullName) fail(422, 'invalid', 'Enter your name.');
    const [company] = await db.insert('companies', { name, email: auth.email, free_reports_remaining: config.freeReportsOnSignup });
    try {
      const [u] = await db.insert('users', { id: auth.id, company_id: company.id, full_name: fullName, email: auth.email, role: 'owner', preset: 'admin', permissions: ALL_PERMS });
      return { user: userOut(u), company: { id: company.id, name: company.name } };
    } catch (e) { await db.remove('companies', { id: eq(company.id) }).catch(() => {}); throw e; }
  });

  // ---------- company branding ----------
  r.get('/api/company', async ({ req }) => { const m = await member(req); return { company: companyOut(m.company) }; });
  r.patch('/api/company', async ({ req }) => {
    const m = await member(req); m.need('branding.edit'); const b = await readJson(req);
    const patch = {};
    ['name', 'license_number', 'contact_name', 'phone', 'email', 'website', 'address', 'brand_color', 'brand_text_color'].forEach((k) => { if (k in b) patch[k] = str(b[k]); });
    if ('name' in patch && !patch.name) fail(422, 'invalid', 'Enter your company name.');
    if (patch.email && !emailOk(patch.email)) fail(422, 'invalid', 'Enter a valid email address, like estimates@yourcompany.com.');
    [['brand_color', 'brand color', '#0F7A4D'], ['brand_text_color', 'header text color', '#FFFFFF']].forEach(([k, what, eg]) => {
      if (!(k in patch)) return;
      let c = patch[k].toUpperCase(); if (c && c[0] !== '#') c = '#' + c;
      if (/^#[0-9A-F]{3}$/.test(c)) c = '#' + c[1] + c[1] + c[2] + c[2] + c[3] + c[3];
      if (c && !/^#[0-9A-F]{6}$/.test(c)) fail(422, 'invalid', `Enter the ${what} as a hex code like ${eg}.`);
      patch[k] = c || null;
    });
    const [c] = await db.update('companies', { id: eq(m.company.id) }, patch);
    roofquery.ensureBrand(c); // keep the PDF branding in step (background; never fails the save)
    return { company: companyOut(c) };
  });
  r.post('/api/company/logo', async ({ req }) => {
    const m = await member(req); m.need('branding.edit'); const f = await imageUpload(req);
    const url = await storage.uploadPublic('logos', `${m.company.id}/logo.${f.ext}`, f.bytes, f.type);
    const [c] = await db.update('companies', { id: eq(m.company.id) }, { logo_url: url });
    if (c) roofquery.ensureBrand(c);
    return { logo_url: url };
  });
  r.delete('/api/company/logo', async ({ req }) => {
    const m = await member(req); m.need('branding.edit');
    const [c] = await db.update('companies', { id: eq(m.company.id) }, { logo_url: null });
    // Delete the stored file(s) and take the logo off the PDF branding (both in the background, best effort).
    storage.remove('logos', Object.values(IMAGE_TYPES).map((ext) => `${m.company.id}/logo.${ext}`)).catch((e) => console.error('[storage] logo delete', e.message));
    if (c) roofquery.ensureBrand(c);
    return { logo_url: null };
  });

  // ---------- price list ----------
  r.get('/api/products', async ({ req }) => {
    const m = await member(req);
    const p = await products();
    return {
      products: Object.values(p).filter((x) => x.id !== 'esx_addon').map((x) => ({ id: x.id, label: x.label, price_cents: x.price_cents, subscriber_price_cents: x.subscriber_price_cents, available: x.available, esx_addon_allowed: x.esx_addon_allowed, delivery_minutes: x.delivery_minutes })),
      esx_price_cents: p.esx_addon ? p.esx_addon.price_cents : 500,
      free_reports_remaining: m.company.free_reports_remaining, subscribed: m.company.subscription_status === 'active',
      trial_days: config.trialDays, trial_eligible: stripe.connected() && stripe.trialEligible(m.company),
      has_card: !stripe.connected() || !!(m.company.stripe_config && m.company.stripe_config.card)
    };
  });

  // ---------- orders ----------
  r.get('/api/orders', async ({ req, query }) => {
    const m = await member(req);
    const mine = !m.can('orders.view_all');
    const scope = { company_id: eq(m.company.id), ...(mine ? { ordered_by: eq(m.user.id) } : {}) };
    const size = Math.min(50, parseInt(query.get('page_size'), 10) || 10);
    const page = Math.max(1, parseInt(query.get('page'), 10) || 1);
    const filters = { ...scope, order: 'created_at.desc', limit: size, offset: (page - 1) * size };
    const status = (query.get('status') || '').split(',').map((s) => s.trim()).filter(Boolean);
    if (status.length) filters.status = inList(status);
    const q = str(query.get('q'), 100).replace(/[,()*"\\:]/g, ' ').trim();
    if (q) {
      const num = q.match(/^(?:rs-?)?(\d{1,12})$/i);
      if (num) filters.or = `(report_number.eq.${num[1]},address.ilike.*${q}*)`;
      else filters.address = 'ilike.*' + q + '*';
    }
    const [{ rows, total }, statuses, prods, people] = await Promise.all([
      db.select('report_orders', filters, { count: true }),
      db.select('report_orders', { ...scope, select: 'status', limit: 10000 }),
      products(), peopleById(m.company.id)
    ]);
    const counts = { all: statuses.length };
    statuses.forEach((s) => { counts[s.status] = (counts[s.status] || 0) + 1; });
    const esxAddon = prods.esx_addon || { price_cents: 500, subscriber_price_cents: 500 };
    const esxPrice = m.company.subscription_status === 'active' ? esxAddon.subscriber_price_cents : esxAddon.price_cents;
    return { orders: rows.map((o) => orderOut(o, prods, people)), total, page, page_size: size, counts, scope: mine ? 'mine' : 'company', esx_price_cents: esxPrice, can_buy_esx: stripe.connected() || config.allowUnpaidTestOrders };
  });

  async function findOrder(m, id) {
    if (!/^[0-9a-f-]{36}$/i.test(id)) fail(404, 'not_found', 'That report doesn\u2019t exist, or you don\u2019t have access to it.');
    const o = await db.one('report_orders', { id: eq(id), company_id: eq(m.company.id) });
    if (!o || (!m.can('orders.view_all') && o.ordered_by !== m.user.id)) fail(404, 'not_found', 'That report doesn\u2019t exist, or you don\u2019t have access to it.');
    return o;
  }
  r.get('/api/orders/:id', async ({ req, params }) => {
    const m = await member(req); const o = await findOrder(m, params.id);
    return { order: orderOut(o, await products(), await peopleById(m.company.id)) };
  });

  r.post('/api/orders', async ({ req }) => {
    const m = await member(req); m.need('orders.create'); const b = await readJson(req);
    const prods = await products();
    const type = str(b.report_type) || 'premium_residential';
    const p = prods[type];
    if (!p || type === 'esx_addon') fail(422, 'invalid', 'Choose a report type.');
    if (!p.available) fail(422, 'unavailable', `${p.label} isn\u2019t available yet.`);
    const esx = !!b.esx;
    if (esx && !p.esx_addon_allowed) fail(422, 'invalid', `The ESX file isn\u2019t available for ${p.label}.`);
    if (!str(b.address) || typeof b.lat !== 'number' || typeof b.lon !== 'number' || Math.abs(b.lat) > 90 || Math.abs(b.lon) > 180) fail(422, 'invalid', 'Look up the property address first.');
    if (!stripe.connected() && !config.allowUnpaidTestOrders) fail(503, 'payments_not_connected', 'Ordering isn\u2019t open yet: payments aren\u2019t connected.');
    const job = jobDetailsIn(b, type); // checked before anything is charged

    // Price: free report (Premium only), else subscriber or regular price, plus ESX.
    const subscribed = m.company.subscription_status === 'active';
    let usedFree = false;
    if (type === 'premium_residential' && m.company.free_reports_remaining > 0) {
      const claimed = await db.update('companies', { id: eq(m.company.id), free_reports_remaining: eq(m.company.free_reports_remaining) }, { free_reports_remaining: m.company.free_reports_remaining - 1 });
      usedFree = claimed.length === 1;
    }
    const esxPrice = prods.esx_addon ? prods.esx_addon.price_cents : 500;
    // A free report covers the Premium report, including the ESX add-on.
    const price = usedFree ? 0 : (subscribed ? p.subscriber_price_cents : p.price_cents) + (esx ? esxPrice : 0);

    const [order] = await db.insert('report_orders', {
      company_id: m.company.id, ordered_by: m.user.id, report_type: type, address: str(b.address, 300), address_parts: addressPartsIn(b), lat: b.lat, lon: b.lon,
      status: 'awaiting_payment', price_cents: price, esx_purchased: esx, used_free_report: usedFree, order_details: job
    });
    let payment = null;
    try {
      if (price > 0 && stripe.connected()) payment = await stripe.chargeOrder(m.company, price, `${p.label}${esx ? ' + ESX' : ''} \u00b7 RS-${order.report_number}`, order);
    } catch (e) {
      await db.update('report_orders', { id: eq(order.id) }, { status: 'cancelled', status_detail: 'Payment failed' });
      if (usedFree) await db.update('companies', { id: eq(m.company.id) }, { free_reports_remaining: m.company.free_reports_remaining });
      throw e;
    }
    if (payment && payment.checkout_url) {
      // No saved card (or the bank wants confirmation): pay on Stripe's page; the webhook finishes the order.
      const [waiting] = await db.update('report_orders', { id: eq(order.id) }, { status_detail: 'Waiting for payment' });
      return { order: orderOut(waiting, prods, { [m.user.id]: m.user }), checkout_url: payment.checkout_url, charged_cents: 0, used_free_report: usedFree };
    }
    const saved = await markPaidAndPlace(order, m.company, payment);
    return { order: orderOut(saved, prods, { [m.user.id]: m.user }), checkout_url: null, charged_cents: price, used_free_report: usedFree, receipt_url: saved.receipt_url || null };
  });

  // ---------- Instant Squares (RoofQuery Instant Query): subscribers only ----------
  r.post('/api/instant-query', async ({ req }) => {
    const m = await member(req); m.need('orders.create'); const b = await readJson(req);
    if (m.company.subscription_status !== 'active') fail(403, 'subscribers_only', 'Instant Squares is for subscribers. Start a free trial on the Account page to use them.');
    const lat = Number(b.lat), lon = Number(b.lon);
    if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) fail(422, 'invalid', 'Look up the property first.');
    if (!roofquery.connected()) fail(503, 'not_connected', 'Instant Squares will work once RoofQuery is connected.');
    rateLimit(null, 'iq|' + m.company.id, 120, 60 * 60 * 1000, 'You\u2019ve used Instant Squares a lot this hour. Try again in a little while.');
    let q;
    try { q = await roofquery.instantQuery(lat, lon); }
    catch (e) {
      if (e.status === 404) fail(503, 'not_enabled', 'Instant Squares isn\u2019t switched on for this account yet.');
      if (e.status === 503) fail(503, 'busy', 'Instant Squares is busy. Try again in a minute.');
      if (e.status === 400) fail(422, 'invalid', 'That location couldn\u2019t be estimated. Move the pin onto the roof and try again.');
      fail(502, 'estimate_failed', 'Instant Squares didn\u2019t work this time. Try again in a moment.');
    }
    const r1 = (n) => (typeof n === 'number' ? Math.round(n * 10) / 10 : null);
    const pt = (p) => ({ lat: p.lat, lng: p.lng });
    const buildings = (q.buildings || []).slice(0, 25).map((x) => ({
      id: x.building_id, primary: !!x.primary, confidence: x.confidence || null,
      flat_sqft: r1(x.flat_sqft), pitched_sqft: r1(x.pitched_sqft), squares: typeof x.pitched_sqft === 'number' ? Math.round(x.pitched_sqft) / 100 : null,
      pitch: x.pitch ? x.pitch.ratio : null, polygon: (x.polygon || []).map(pt)
    }));
    const s = q.storm || {};
    return {
      address: q.address || null, parcel: q.parcel && q.parcel.found ? { polygon: (q.parcel.polygon || []).map(pt) } : null,
      buildings,
      total_squares: Math.round(buildings.reduce((t, x) => t + (x.pitched_sqft || 0), 0)) / 100,
      storm: { status: s.status || 'unavailable', period: s.period || null, damage_chance: s.damage_chance || null, hail: s.hail || null, wind: s.wind || null, tornado: s.tornado || null, top_storms: (s.top_storms || []).slice(0, 5) },
      sandbox: roofquery.sandbox()
    };
  });

  // Downloads: the website asks for a short-lived link, then opens it (works for any browser download).
  async function fileLink(req, id, kind) {
    const m = await member(req); m.need('orders.download'); const o = await findOrder(m, id);
    if (kind === 'esx' && !o.esx_purchased) fail(403, 'not_purchased', 'The ESX file wasn\u2019t added to this order.');
    if (o.status !== 'delivered' || !o.roofquery_order_id) fail(409, 'not_ready', 'This report isn\u2019t ready yet.');
    if (o.report_type === 'storm_report') fail(404, 'not_found', 'Choose which storm report PDF to download.');
    return { url: fulfillment.downloadUrl(o.id, kind, 10 * 60 * 1000) };
  }
  r.get('/api/orders/:id/pdf', async ({ req, params }) => fileLink(req, params.id, 'pdf'));

  // ---------- Storm Reports: the report page, and each PDF with this download's details ----------
  async function stormOrder(req, id) {
    const m = await member(req); const o = await findOrder(m, id);
    if (o.report_type !== 'storm_report') fail(404, 'not_found', 'That isn\u2019t a storm report.');
    if (o.status !== 'delivered' || !o.roofquery_order_id) fail(409, 'not_ready', 'This storm report isn\u2019t ready yet.');
    return { m, o };
  }
  r.get('/api/orders/:id/storm', async ({ req, params }) => {
    const { m, o } = await stormOrder(req, params.id);
    const storm = (o.measurements && o.measurements.storm) || {};
    return {
      order: orderOut(o, await products(), await peopleById(m.company.id)), storm,
      details: o.order_details || {}, can_download: m.can('orders.download'),
      map_url: storm.has_map ? fulfillment.downloadUrl(o.id, 'storm-map', 60 * 60 * 1000) : null
    };
  });
  // Saves the details (they're filled in next time) and returns a short-lived link to the PDF.
  r.post('/api/orders/:id/storm/:template', async ({ req, params }) => {
    const { m, o } = await stormOrder(req, params.id); m.need('orders.download');
    if (!roofquery.STORM_TEMPLATES[params.template]) fail(404, 'not_found', 'That PDF isn\u2019t part of a storm report.');
    const details = stormDetailsIn(await readJson(req));
    if (params.template === 'date_of_loss' && !details.date_of_loss) fail(422, 'needs_date_of_loss', 'Enter the date of loss for this PDF.');
    // Homeowner summary takes no details; keep what was entered before.
    if (params.template !== 'homeowner') {
      const keep = Object.fromEntries(Object.entries(o.order_details || {}).filter(([k]) => /^client_/.test(k)));
      await db.update('report_orders', { id: eq(o.id) }, { order_details: { ...keep, ...details } });
    }
    return { url: fulfillment.downloadUrl(o.id, 'storm-' + params.template, 10 * 60 * 1000) };
  });
  r.get('/api/orders/:id/esx', async ({ req, params }) => fileLink(req, params.id, 'esx'));
  r.post('/api/orders/:id/details', async ({ req, params }) => { const m = await member(req); m.need('orders.create'); await findOrder(m, params.id); fail(501, 'not_available', 'Adding details to an order isn\u2019t available yet. Email us and we\u2019ll pass them on.'); });

  // Buy the ESX file for a finished report: saved card → charged now; otherwise Stripe's payment page.
  r.post('/api/orders/:id/buy-esx', async ({ req, params }) => {
    const m = await member(req); m.need('orders.create'); const o = await findOrder(m, params.id);
    const prods = await products();
    if (o.esx_purchased) return { purchased: true, url: fulfillment.downloadUrl(o.id, 'esx', 10 * 60 * 1000), charged_cents: 0 };
    if (o.status !== 'delivered' || !o.roofquery_order_id) fail(409, 'not_ready', 'The ESX file can be bought once the report is ready.');
    if (!(prods[o.report_type] || {}).esx_addon_allowed) fail(422, 'invalid', 'The ESX file isn\u2019t available for this report type.');
    const price = await fulfillment.esxPriceFor(o);
    const desc = `ESX file (Xactimate) \u00b7 RS-${o.report_number}`;
    let pay = null;
    if (stripe.connected() && price > 0) pay = await stripe.chargeOrder(m.company, price, desc, o, { purpose: 'esx' });
    else if (!stripe.connected() && !config.allowUnpaidTestOrders) fail(503, 'payments_not_connected', 'Payments aren\u2019t connected yet.');
    if (pay && pay.checkout_url) return { purchased: false, checkout_url: pay.checkout_url };
    await fulfillment.esxPaid(o.id, pay && pay.payment_id, pay && pay.receipt_url, price);
    return { purchased: true, url: fulfillment.downloadUrl(o.id, 'esx', 10 * 60 * 1000), charged_cents: pay ? price : 0, receipt_url: (pay && pay.receipt_url) || null };
  });

  // The file itself: checked by the signed link, streamed from RoofQuery in the company's branding.
  r.get('/files/:id/:kind', async ({ res, params, query }) => {
    const { id, kind } = params;
    const bad = () => fail(404, 'not_found', 'This download link isn\u2019t valid or has expired. Download the report again from your Home page.');
    const stormTemplate = /^storm-([a-z_]+)$/.test(kind) && kind !== 'storm-map' ? kind.slice(6) : null;
    if (!(['pdf', 'esx', 'buy-esx', 'storm-map'].includes(kind) || (stormTemplate && roofquery.STORM_TEMPLATES[stormTemplate])) || !/^[0-9a-f-]{36}$/i.test(id) || !fulfillment.checkDownload(id, kind, query.get('exp'), query.get('sig'))) bad();
    let o = await db.one('report_orders', { id: eq(id) });
    if (!o || !o.roofquery_order_id || o.status !== 'delivered') bad();
    const year = 365 * 24 * 60 * 60 * 1000;
    // "Get the ESX file" link from the ready email: straight to Stripe's payment page (or the file, if already bought).
    if (kind === 'buy-esx') {
      if (o.esx_purchased) { res.writeHead(303, { Location: fulfillment.downloadUrl(o.id, 'esx', year) }); return res.end(); }
      if (!((await products())[o.report_type] || {}).esx_addon_allowed) bad();
      if (!stripe.connected()) fail(503, 'payments_not_connected', 'Buying the ESX file isn\u2019t available right now.');
      const company = o.company_id ? await db.one('companies', { id: eq(o.company_id) }) : null;
      const url = await stripe.checkoutForOrder({
        purpose: 'esx', order: o, amountCents: await fulfillment.esxPriceFor(o), description: `ESX file (Xactimate) \u00b7 RS-${o.report_number}`,
        customer: company ? await stripe.ensureCustomer(company) : null, email: company ? null : o.guest_email, guest: !company, saveCard: false,
        successUrl: fulfillment.downloadUrl(o.id, 'esx', year), cancelUrl: `${config.appUrl}/index.html`
      });
      res.writeHead(303, { Location: url }); return res.end();
    }
    // Back from Stripe before its webhook arrived: check the payment page directly.
    if (kind === 'esx' && !o.esx_purchased && o.esx_checkout_session_id) {
      const paid = await stripe.paidSession(o.esx_checkout_session_id).catch(() => null);
      if (paid) o = (await fulfillment.esxPaid(o.id, paid.payment_id, paid.receipt_url)) || o;
    }
    if (kind === 'esx' && !o.esx_purchased) bad();
    if ((stormTemplate || kind === 'storm-map') && o.report_type !== 'storm_report') bad();
    if (kind === 'storm-map') {
      let img;
      try { img = await roofquery.fetchStormMap(o.roofquery_order_id); } catch (e) { fail(502, 'download_failed', 'The storm map couldn\u2019t be loaded right now.'); }
      res.writeHead(200, { 'Content-Type': 'image/png', 'Cache-Control': 'private, max-age=3600' });
      for await (const chunk of img.body) res.write(chunk);
      return res.end();
    }
    const company = o.company_id ? await db.one('companies', { id: eq(o.company_id) }) : null;
    const brand = (kind === 'pdf' || stormTemplate) && company ? await roofquery.ensureBrand(company) : null;
    let up;
    // Date of Loss without a date can't be made (an old emailed link, say): show the report page instead.
    if (stormTemplate === 'date_of_loss' && !(o.order_details && o.order_details.date_of_loss)) { res.writeHead(303, { Location: `${config.appUrl}/storm-report.html?id=${o.id}` }); return res.end(); }
    try { up = stormTemplate ? await roofquery.fetchStormPdf(o.roofquery_order_id, stormTemplate, { brand, details: stormTemplate === 'homeowner' ? {} : o.order_details || {} }) : await roofquery.fetchFile(o.roofquery_order_id, kind, { brand }); }
    catch (e) {
      if (e.status === 409) fail(409, 'not_ready', 'This report is being updated. Try again in a few minutes.');
      fail(502, 'download_failed', 'The file couldn\u2019t be downloaded right now. Try again in a minute.');
    }
    const street = String(o.address || '').split(',')[0].replace(/[^A-Za-z0-9]+/g, '_').replace(/^_|_$/g, '').slice(0, 40);
    const name = stormTemplate ? `RS-${o.report_number}_${stormTemplate}.pdf` : `RS-${o.report_number}${street ? '_' + street : ''}.${kind}`;
    res.writeHead(200, {
      'Content-Type': kind === 'pdf' || stormTemplate ? 'application/pdf' : 'application/octet-stream',
      'Content-Disposition': `attachment; filename="${name}"`, 'Cache-Control': 'no-store',
      ...(up.headers.get('content-length') ? { 'Content-Length': up.headers.get('content-length') } : {})
    });
    for await (const chunk of up.body) res.write(chunk);
    res.end();
  });

  // ---------- team & invites ----------
  r.get('/api/team', async ({ req }) => {
    const m = await member(req); m.need('users.manage');
    const now = new Date().toISOString();
    await db.update('invites', { company_id: eq(m.company.id), status: eq('pending'), expires_at: 'lt.' + now }, { status: 'expired' });
    const [users, invites] = await Promise.all([
      db.select('users', { company_id: eq(m.company.id), order: 'created_at.asc' }),
      db.select('invites', { company_id: eq(m.company.id), status: inList(['pending', 'expired']), order: 'created_at.asc' })
    ]);
    const inv = invites.map(({ token_hash, ...i }) => i);
    return { members: users.map(userOut), invites: inv, counts: { members: users.length, pending_invites: inv.filter((i) => i.status === 'pending').length } };
  });

  async function sendInviteEmail(m, inv, token) {
    const url = inviteUrl(token);
    const r = await email.send({ to: inv.email, subject: `${m.user.full_name} invited you to ${m.company.name} on Rapid Squares`,
      text: `${m.user.full_name} invited you to join ${m.company.name} on Rapid Squares.\n\nAccept the invite: ${url}\n\nThis invitation expires in 7 days (${new Date(inv.expires_at).toDateString()}). If it runs out, ask ${m.user.full_name} to resend it.` });
    return { url, sent: !!(r && r.sent) };
  }

  r.post('/api/invites', async ({ req }) => {
    const m = await member(req); m.need('users.manage'); const b = await readJson(req);
    const emails = [...new Set((Array.isArray(b.emails) ? b.emails : []).map((e) => str(e).toLowerCase()).filter(Boolean))];
    if (!emails.length) fail(422, 'invalid', 'Enter at least one email address.');
    if (emails.length > 25) fail(422, 'invalid', 'Invite up to 25 people at a time.');
    const bad = emails.filter((e) => !emailOk(e));
    if (bad.length) fail(422, 'invalid', `Check ${bad.length > 1 ? 'these email addresses' : 'this email address'}: ${bad.join(', ')}.`);
    const [users, pend] = await Promise.all([
      db.select('users', { company_id: eq(m.company.id), select: 'email' }),
      db.select('invites', { company_id: eq(m.company.id), status: eq('pending'), select: 'email' })
    ]);
    const taken = emails.filter((e) => users.some((u) => (u.email || '').toLowerCase() === e) || pend.some((i) => i.email.toLowerCase() === e));
    if (taken.length) fail(409, 'already_invited', `${taken.join(', ')} ${taken.length > 1 ? 'are' : 'is'} already on the team or has a pending invite.`);
    const perms = cleanPerms(b.permissions);
    const makesAdmin = b.preset === 'admin' || perms.includes('users.manage');
    if (makesAdmin && !['owner', 'admin'].includes(m.user.role)) fail(403, 'forbidden', 'Only an owner or admin can invite someone who manages the team.');
    const days = INVITE_DAYS; // every invite lasts 7 days
    const limit = null; // monthly order limits are no longer offered
    const tokens = emails.map(() => newToken());
    const rows = await db.insert('invites', emails.map((e, i) => ({
      company_id: m.company.id, email: e, full_name: emails.length === 1 ? str(b.full_name) : null, job_title: str(b.job_title) || null,
      role: b.preset === 'admin' ? 'admin' : 'user', preset: str(b.preset, 20) || 'custom', permissions: perms, monthly_order_limit: limit,
      invited_by: m.user.id, token_hash: sha256(tokens[i]), status: 'pending', expires_at: new Date(Date.now() + days * DAY).toISOString()
    })));
    const out = [];
    for (let i = 0; i < rows.length; i++) {
      const { token_hash, ...inv } = rows.find((x) => x.email === emails[i]) || rows[i];
      { const e = await sendInviteEmail(m, inv, tokens[i]); out.push({ ...inv, invite_url: e.url, email_sent: e.sent }); }
    }
    return { invites: out };
  });

  async function findInvite(m, id) {
    if (!/^[0-9a-f-]{36}$/i.test(id)) fail(404, 'not_found', 'That invite no longer exists.');
    const inv = await db.one('invites', { id: eq(id), company_id: eq(m.company.id) });
    if (!inv || inv.status === 'revoked' || inv.status === 'accepted') fail(404, 'not_found', 'That invite no longer exists.');
    return inv;
  }
  r.post('/api/invites/:id/resend', async ({ req, params }) => {
    const m = await member(req); m.need('users.manage'); const inv = await findInvite(m, params.id);
    const token = newToken();
    const [u] = await db.update('invites', { id: eq(inv.id) }, { token_hash: sha256(token), status: 'pending', expires_at: new Date(Date.now() + INVITE_DAYS * DAY).toISOString() });
    const { token_hash, ...out } = u;
    { const e = await sendInviteEmail(m, u, token); return { invite: { ...out, invite_url: e.url, email_sent: e.sent } }; }
  });
  r.delete('/api/invites/:id', async ({ req, params }) => {
    const m = await member(req); m.need('users.manage'); const inv = await findInvite(m, params.id);
    const [u] = await db.update('invites', { id: eq(inv.id) }, { status: 'revoked' });
    const { token_hash, ...out } = u;
    return { invite: out };
  });

  // Shown on the sign-in page before accepting: who invited you and to which company.
  r.get('/api/invites/preview', async ({ query }) => {
    const token = str(query.get('token'), 100);
    if (!token) fail(404, 'not_found', 'This invite link isn\u2019t valid.');
    const inv = await db.one('invites', { token_hash: eq(sha256(token)) });
    if (!inv || inv.status !== 'pending') fail(404, 'not_found', 'This invite link isn\u2019t valid anymore. Ask for a new one.');
    if (new Date(inv.expires_at) < new Date()) fail(410, 'expired', 'This invite has expired. Ask your company admin to resend it.');
    const company = await db.one('companies', { id: eq(inv.company_id), select: 'name' });
    return { email: inv.email, company_name: company ? company.name : '', full_name: inv.full_name };
  });
  r.post('/api/invites/accept', async ({ req }) => {
    const auth = await signedIn(req); const b = await readJson(req);
    const token = str(b.token, 100);
    const inv = token ? await db.one('invites', { token_hash: eq(sha256(token)) }) : null;
    if (!inv || inv.status !== 'pending') fail(404, 'not_found', 'This invite link isn\u2019t valid anymore. Ask for a new one.');
    if (new Date(inv.expires_at) < new Date()) fail(410, 'expired', 'This invite has expired. Ask your company admin to resend it.');
    if (!auth.email || auth.email.toLowerCase() !== inv.email.toLowerCase()) fail(403, 'wrong_email', `This invite was sent to ${inv.email}. Sign in with that email to accept it.`);
    if (await db.one('users', { id: eq(auth.id) })) fail(409, 'already_member', 'Your account already belongs to a company.');
    const [u] = await db.insert('users', {
      id: auth.id, company_id: inv.company_id, full_name: str(b.full_name) || inv.full_name || auth.email.split('@')[0], email: auth.email,
      job_title: inv.job_title, role: inv.role === 'owner' ? 'user' : inv.role, preset: inv.preset, permissions: cleanPerms(inv.permissions), monthly_order_limit: null
    });
    await db.update('invites', { id: eq(inv.id) }, { status: 'accepted', accepted_by: auth.id });
    const company = await db.one('companies', { id: eq(inv.company_id), select: 'id,name' });
    return { user: userOut(u), company };
  });

  async function findMember(m, id) {
    const u = await db.one('users', { id: eq(id), company_id: eq(m.company.id) });
    if (!u) fail(404, 'not_found', 'That person isn\u2019t on the team anymore.');
    if (u.role === 'owner') fail(403, 'forbidden', 'The company owner can\u2019t be changed or removed.');
    if (u.id === m.user.id) fail(403, 'forbidden', 'You can\u2019t change your own access. Ask another admin.');
    if (u.role === 'admin' && m.user.role !== 'owner') fail(403, 'forbidden', 'Only the owner can change or remove an admin.');
    return u;
  }
  r.patch('/api/team/:userId', async ({ req, params }) => {
    const m = await member(req); m.need('users.manage'); const u = await findMember(m, params.userId); const b = await readJson(req);
    const patch = {};
    if ('permissions' in b) patch.permissions = cleanPerms(b.permissions);
    if ('preset' in b) {
      if (b.preset === 'admin' && !['owner', 'admin'].includes(m.user.role)) fail(403, 'forbidden', 'Only an owner or admin can make someone an admin.');
      patch.preset = str(b.preset, 20) || 'custom';
      patch.role = b.preset === 'admin' ? 'admin' : 'user';
    }
    if ((patch.permissions || []).includes('users.manage') && !['owner', 'admin'].includes(m.user.role)) fail(403, 'forbidden', 'Only an owner or admin can give someone team management.');
    patch.monthly_order_limit = null; // limits are no longer offered; clears any old one
    if ('job_title' in b) patch.job_title = str(b.job_title);
    const [saved] = await db.update('users', { id: eq(u.id) }, patch);
    return { member: userOut(saved) };
  });
  r.delete('/api/team/:userId', async ({ req, params }) => {
    const m = await member(req); m.need('users.manage'); const u = await findMember(m, params.userId);
    await db.remove('users', { id: eq(u.id) });
    return { removed: u.id };
  });

  // ---------- billing ----------
  r.get('/api/billing', async ({ req }) => {
    const m = await member(req); m.need('billing.manage');
    const c = m.company, cfg = c.stripe_config || {};
    const charged = await db.select('report_orders', { company_id: eq(c.id), price_cents: 'gt.0', status: 'not.in.(failed,cancelled,awaiting_payment)', order: 'created_at.desc', limit: 10 });
    const month = await db.select('report_orders', { company_id: eq(c.id), created_at: gte(startOfMonth()), status: 'not.in.(failed,cancelled,awaiting_payment)', select: 'price_cents' });
    const prods = await products();
    const esxBuys = await db.select('report_orders', { company_id: eq(c.id), esx_purchased_at: 'not.is.null', esx_price_cents: 'gt.0', order: 'esx_purchased_at.desc', limit: 10 });
    const monthStart = startOfMonth();
    const esxThisMonth = esxBuys.filter((o) => o.esx_purchased_at >= monthStart).reduce((t, o) => t + o.esx_price_cents, 0);
    const lines = charged.map((o) => ({ date: o.created_at, description: `${(prods[o.report_type] || {}).label || o.report_type}${o.esx_purchased && !o.esx_purchased_at ? ' + ESX' : ''} · RS-${o.report_number}`, amount_cents: o.price_cents, receipt_url: o.receipt_url || null }))
      .concat(esxBuys.map((o) => ({ date: o.esx_purchased_at, description: `ESX file (Xactimate) · RS-${o.report_number}`, amount_cents: o.esx_price_cents, receipt_url: o.esx_receipt_url || null })))
      .sort((a, b) => (a.date < b.date ? 1 : -1)).slice(0, 10);
    return {
      subscription: c.subscription_status === 'active' ? { plan: c.subscription_plan, status: 'active', price_cents: c.subscription_plan === 'yearly' ? config.stripe.yearlyCents : config.stripe.monthlyCents, renews_at: c.subscription_renews_at, cancel_at_period_end: !!cfg.cancel_at_period_end, trial_ends_at: c.trial_ends_at && new Date(c.trial_ends_at) > new Date() ? c.trial_ends_at : null } : { status: c.subscription_status || 'none' },
      trial_days: config.trialDays, trial_eligible: stripe.connected() && stripe.trialEligible(c),
      plans: { monthly_cents: config.stripe.monthlyCents, yearly_cents: config.stripe.yearlyCents },
      card: cfg.card ? { brand: cfg.card.brand, last4: cfg.card.last4, exp: cfg.card.exp } : null, free_reports_remaining: c.free_reports_remaining,
      reports_this_month: month.length, spend_this_month_cents: month.reduce((s, o) => s + o.price_cents, 0) + esxThisMonth,
      billing_email: cfg.billing_email || c.email, billing_address: cfg.billing_address || c.address,
      invoices: lines,
      payments_connected: stripe.connected()
    };
  });
  r.post('/api/billing/portal', async ({ req }) => {
    const m = await member(req); m.need('billing.manage');
    if (!stripe.connected()) return { url: null, message: 'Stripe\u2019s billing page will open here once Stripe is connected.' };
    return { url: await stripe.portalUrl(m.company) };
  });
  // Stripe page to add or replace the saved card.
  r.post('/api/billing/card', async ({ req }) => {
    const m = await member(req); m.need('billing.manage');
    if (!stripe.connected()) return { url: null, message: 'Adding a card will work once Stripe is connected.' };
    return { url: await stripe.cardSetupUrl(m.company) };
  });
  // Stripe page to start a subscription: { plan: 'monthly' | 'yearly' }
  r.post('/api/billing/subscribe', async ({ req }) => {
    const m = await member(req); m.need('billing.manage'); const b = await readJson(req);
    if (!stripe.connected()) return { url: null, message: 'Subscriptions will work once Stripe is connected.' };
    return { url: await stripe.subscribeUrl(m.company, str(b.plan)) };
  });

  // ---------- RoofQuery webhook (called by RoofQuery, not the website) ----------
  // Set in the RoofQuery portal as https://<your site>/webhooks/roofquery/<ROOFQUERY_WEBHOOK_SECRET>.
  async function rqWebhook({ req, params, query }) {
    const secret = config.roofquery.webhookSecret;
    const given = String(params.key || query.get('key') || '');
    if (secret && !(given.length === secret.length && crypto.timingSafeEqual(Buffer.from(given), Buffer.from(secret)))) fail(401, 'unauthorized', 'Unknown webhook key.');
    const raw = await readBody(req, 2 * 1024 * 1024);
    let body = null;
    try { body = JSON.parse(raw.toString('utf8')); } catch { fail(400, 'bad_json', 'Expected JSON.'); }
    return fulfillment.onWebhook(body);
  }
  r.post('/webhooks/roofquery', rqWebhook);
  r.post('/webhooks/roofquery/:key', rqWebhook);

  // ---------- Stripe webhook (called by Stripe, not the website) ----------
  r.post('/webhooks/stripe', async ({ req }) => {
    const raw = await readBody(req, 1024 * 1024);
    const event = stripe.verifySignature(raw, req.headers['stripe-signature']);
    try { await db.insert('webhook_events', { id: event.id, source: 'stripe' }); }
    catch (e) { if (e.status === 409) return { received: true, duplicate: true }; throw e; }
    try {
      await stripe.handleEvent(event, { onOrderPaid: orderPaid, onOrderCancelled: orderCancelled, onEsxPaid: (id, pi, receipt) => fulfillment.esxPaid(id, pi, receipt) });
    } catch (e) {
      await db.remove('webhook_events', { id: eq(event.id) }).catch(() => {}); // let Stripe retry
      throw e;
    }
    return { received: true };
  });
}
