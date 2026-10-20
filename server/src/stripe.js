// Stripe: saved cards, per-order charges, Checkout pages, subscriptions, billing portal and
// webhooks. Talks to Stripe's REST API directly (no extra packages). Uses the SECRET key, so
// it only ever runs on the server.
import crypto from 'node:crypto';
import { config } from './config.js';
import { HttpError, fail } from './http.js';
import { db, eq } from './supabase.js';

const sk = () => config.stripe.secretKey;
export const connected = () => !!sk();
export const PLANS = {
  monthly: { label: 'Rapid Squares subscription (monthly)', cents: config.stripe.monthlyCents, interval: 'month' },
  yearly: { label: 'Rapid Squares subscription (yearly)', cents: config.stripe.yearlyCents, interval: 'year' }
};

// Stripe wants form encoding with brackets for nested values: a[b][0][c]=1
function encode(obj, prefix, out = []) {
  for (const [k, v] of Object.entries(obj || {})) {
    if (v === undefined || v === null) continue;
    const key = prefix ? `${prefix}[${k}]` : k;
    if (Array.isArray(v)) v.forEach((item, i) => (typeof item === 'object' ? encode(item, `${key}[${i}]`, out) : out.push([`${key}[${i}]`, String(item)])));
    else if (typeof v === 'object') encode(v, key, out);
    else out.push([key, String(v)]);
  }
  return out;
}

export async function api(method, path, params, { idempotencyKey } = {}) {
  if (!connected()) fail(503, 'payments_not_connected', 'Payments aren’t connected yet.');
  const headers = { Authorization: 'Bearer ' + sk(), 'Stripe-Version': '2024-06-20' };
  let url = `${config.stripe.apiBase}/v1${path}`, body;
  const pairs = encode(params);
  if (method === 'GET') { if (pairs.length) url += '?' + new URLSearchParams(pairs).toString(); }
  else { headers['Content-Type'] = 'application/x-www-form-urlencoded'; body = new URLSearchParams(pairs).toString(); }
  if (idempotencyKey) headers['Idempotency-Key'] = idempotencyKey;
  let res;
  try { res = await fetch(url, { method, headers, body }); }
  catch (e) { console.error('[stripe] unreachable', e.message); throw new HttpError(503, 'payments_unreachable', 'Can’t reach the payment service right now. Try again in a moment.'); }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = data.error || {};
    console.error('[stripe]', res.status, method, path, err.type, err.code, err.message);
    if (res.status === 401) throw new HttpError(500, 'payments_auth', 'The server’s Stripe key was rejected. Check STRIPE_SECRET_KEY.');
    const e = new HttpError(err.type === 'card_error' ? 402 : 502, err.code || 'payment_error',
      err.type === 'card_error' ? (err.message || 'Your card was declined.') : 'The payment service couldn’t complete that. Try again.');
    e.stripe = err; e.paymentIntent = err.payment_intent || null;
    throw e;
  }
  return data;
}

// ---------- customers & saved cards ----------
export async function ensureCustomer(company) {
  if (company.stripe_customer_id) return company.stripe_customer_id;
  const cust = await api('POST', '/customers', { name: company.name, email: company.email || undefined, metadata: { company_id: company.id } }, { idempotencyKey: 'cust-' + company.id });
  await db.update('companies', { id: eq(company.id) }, { stripe_customer_id: cust.id });
  company.stripe_customer_id = cust.id;
  return cust.id;
}
function cardSummary(pm) {
  const c = pm && pm.card;
  return c ? { id: pm.id, brand: c.brand ? c.brand[0].toUpperCase() + c.brand.slice(1) : 'Card', last4: c.last4, exp: String(c.exp_month).padStart(2, '0') + '/' + String(c.exp_year).slice(-2) } : null;
}
async function saveDefaultCard(company, paymentMethodId) {
  const pm = await api('GET', `/payment_methods/${paymentMethodId}`);
  await api('POST', `/customers/${company.stripe_customer_id}`, { invoice_settings: { default_payment_method: paymentMethodId } });
  const cfg = { ...(company.stripe_config || {}), card: cardSummary(pm) };
  await db.update('companies', { id: eq(company.id) }, { stripe_config: cfg });
  return cfg.card;
}

// Hosted Stripe page to add or replace the saved card.
export async function cardSetupUrl(company, returnPath = 'account.html') {
  const customer = await ensureCustomer(company);
  const s = await api('POST', '/checkout/sessions', {
    mode: 'setup', customer, currency: 'usd', payment_method_types: ['card'],
    metadata: { kind: 'card_setup', company_id: company.id },
    success_url: `${config.appUrl}/${returnPath}${returnPath.includes('?') ? '&' : '?'}card=saved#billing`,
    cancel_url: `${config.appUrl}/${returnPath}#billing`
  });
  return s.url;
}

// ---------- charging for an order ----------
// Charges the saved card right away. Returns { paid: true, payment_id, receipt_url } or, when there is no
// saved card or the bank wants the customer to confirm, { checkout_url } for a Stripe payment page.
export async function chargeOrder(company, amountCents, description, order) {
  const customer = await ensureCustomer(company);
  const card = company.stripe_config && company.stripe_config.card;
  if (card && card.id) {
    try {
      const pi = await api('POST', '/payment_intents', {
        amount: amountCents, currency: 'usd', customer, payment_method: card.id, off_session: true, confirm: true,
        description, receipt_email: company.email || undefined,
        metadata: { order_id: order.id, company_id: company.id, report_number: 'RS-' + order.report_number }
      }, { idempotencyKey: 'order-' + order.id });
      if (pi.status === 'succeeded') return { paid: true, payment_id: pi.id, receipt_url: await receiptUrl(pi) };
    } catch (e) {
      // Bank wants the customer present (authentication_required) → fall through to a payment page.
      if (!(e.stripe && e.stripe.code === 'authentication_required')) throw e;
    }
  }
  return { checkout_url: await checkoutForOrder({ customer, amountCents, description, order, saveCard: true, email: null }) };
}

export async function checkoutForOrder({ customer, amountCents, description, order, saveCard, email, guest }) {
  const back = guest ? 'new-sketch.html' : 'orders.html';
  const s = await api('POST', '/checkout/sessions', {
    mode: 'payment', customer: customer || undefined, customer_email: customer ? undefined : (email || undefined),
    line_items: [{ quantity: 1, price_data: { currency: 'usd', unit_amount: amountCents, product_data: { name: description } } }],
    payment_intent_data: { description, metadata: { order_id: order.id, report_number: 'RS-' + order.report_number }, ...(saveCard ? { setup_future_usage: 'off_session' } : {}) },
    metadata: { kind: 'order', order_id: order.id },
    success_url: `${config.appUrl}/${back}?paid=RS-${order.report_number}`,
    cancel_url: `${config.appUrl}/${back}?unpaid=RS-${order.report_number}`
  }, { idempotencyKey: 'checkout-' + order.id });
  await db.update('report_orders', { id: eq(order.id) }, { stripe_checkout_session_id: s.id });
  return s.url;
}

async function receiptUrl(pi) {
  try {
    const chargeId = typeof pi.latest_charge === 'string' ? pi.latest_charge : pi.latest_charge && pi.latest_charge.id;
    if (!chargeId) return null;
    const ch = await api('GET', `/charges/${chargeId}`);
    return ch.receipt_url || null;
  } catch { return null; }
}

// ---------- subscriptions & billing portal ----------
export async function subscribeUrl(company, plan) {
  const p = PLANS[plan];
  if (!p) fail(422, 'invalid', 'Choose monthly or yearly.');
  if (company.subscription_status === 'active') fail(409, 'already_subscribed', 'You already have a subscription. Use Manage billing to change it.');
  const customer = await ensureCustomer(company);
  const s = await api('POST', '/checkout/sessions', {
    mode: 'subscription', customer,
    line_items: [{ quantity: 1, price_data: { currency: 'usd', unit_amount: p.cents, recurring: { interval: p.interval }, product_data: { name: p.label } } }],
    subscription_data: { metadata: { company_id: company.id, plan } },
    metadata: { kind: 'subscription', company_id: company.id, plan },
    success_url: `${config.appUrl}/account.html?subscribed=1#billing`,
    cancel_url: `${config.appUrl}/account.html#billing`
  });
  return s.url;
}
export async function portalUrl(company) {
  const customer = await ensureCustomer(company);
  const s = await api('POST', '/billing_portal/sessions', { customer, return_url: `${config.appUrl}/account.html#billing` });
  return s.url;
}

// ---------- webhooks ----------
export function verifySignature(rawBody, header) {
  const secret = config.stripe.webhookSecret;
  if (!secret) fail(503, 'webhook_not_configured', 'STRIPE_WEBHOOK_SECRET isn’t set.');
  const parts = Object.fromEntries(String(header || '').split(',').map((kv) => kv.split('=')).filter((x) => x.length === 2).map(([k, v]) => [k.trim(), v.trim()]));
  const sigs = String(header || '').split(',').filter((kv) => kv.trim().startsWith('v1=')).map((kv) => kv.trim().slice(3));
  const t = Number(parts.t);
  if (!t || !sigs.length) fail(400, 'bad_signature', 'Missing Stripe signature.');
  if (Math.abs(Date.now() / 1000 - t) > 300) fail(400, 'bad_signature', 'Stripe signature is too old.');
  const expected = crypto.createHmac('sha256', secret).update(`${t}.${rawBody.toString('utf8')}`).digest('hex');
  const ok = sigs.some((s) => s.length === expected.length && crypto.timingSafeEqual(Buffer.from(s), Buffer.from(expected)));
  if (!ok) fail(400, 'bad_signature', 'Stripe signature doesn’t match.');
  return JSON.parse(rawBody.toString('utf8'));
}

async function companyByCustomer(customerId) {
  return customerId ? db.one('companies', { stripe_customer_id: eq(customerId) }) : null;
}

// What to do for each Stripe event. `onOrderPaid(orderId, paymentIntentId, receiptUrl)` is supplied by routes.
export async function handleEvent(event, { onOrderPaid, onOrderCancelled }) {
  const o = event.data && event.data.object || {};
  switch (event.type) {
    case 'checkout.session.completed': {
      const kind = o.metadata && o.metadata.kind;
      const company = await companyByCustomer(o.customer);
      if (kind === 'card_setup' && company && o.setup_intent) {
        const si = await api('GET', `/setup_intents/${o.setup_intent}`);
        if (si.payment_method) await saveDefaultCard(company, si.payment_method);
      } else if (kind === 'order' && o.metadata.order_id) {
        let receipt = null, pmId = null;
        if (o.payment_intent) {
          const pi = await api('GET', `/payment_intents/${o.payment_intent}`);
          receipt = await receiptUrl(pi); pmId = pi.payment_method;
        }
        if (company && pmId && !(company.stripe_config && company.stripe_config.card)) await saveDefaultCard(company, pmId).catch(() => {});
        if (o.payment_status === 'paid') await onOrderPaid(o.metadata.order_id, o.payment_intent || null, receipt);
      } else if (kind === 'subscription' && company && o.subscription) {
        await syncSubscription(company, await api('GET', `/subscriptions/${o.subscription}`));
      }
      break;
    }
    case 'checkout.session.async_payment_succeeded':
      if (o.metadata && o.metadata.kind === 'order') await onOrderPaid(o.metadata.order_id, o.payment_intent || null, null);
      break;
    case 'checkout.session.expired':
    case 'checkout.session.async_payment_failed':
      if (o.metadata && o.metadata.kind === 'order') await onOrderCancelled(o.metadata.order_id, event.type === 'checkout.session.expired' ? 'Payment page expired before payment' : 'Payment failed');
      break;
    case 'customer.subscription.created':
    case 'customer.subscription.updated':
    case 'customer.subscription.deleted': {
      const company = await companyByCustomer(o.customer);
      if (company) await syncSubscription(company, o);
      break;
    }
    case 'payment_method.attached':
    case 'customer.updated': {
      // Card changed in the billing portal → refresh the saved-card summary.
      const custId = event.type === 'customer.updated' ? o.id : o.customer;
      const company = await companyByCustomer(custId);
      const pmId = event.type === 'customer.updated' ? o.invoice_settings && o.invoice_settings.default_payment_method : null;
      if (company && pmId && (!company.stripe_config || !company.stripe_config.card || company.stripe_config.card.id !== pmId)) {
        const pm = await api('GET', `/payment_methods/${pmId}`);
        await db.update('companies', { id: eq(company.id) }, { stripe_config: { ...(company.stripe_config || {}), card: cardSummary(pm) } });
      }
      break;
    }
    default: break; // other events are ignored
  }
}

async function syncSubscription(company, sub) {
  const active = ['active', 'trialing'].includes(sub.status) && !sub.ended_at;
  const item = sub.items && sub.items.data && sub.items.data[0];
  const interval = item && item.price && item.price.recurring && item.price.recurring.interval;
  const periodEnd = sub.current_period_end || (item && item.current_period_end);
  await db.update('companies', { id: eq(company.id) }, {
    subscription_status: active ? 'active' : (sub.status === 'past_due' ? 'past_due' : 'canceled'),
    subscription_plan: interval === 'year' ? 'yearly' : 'monthly',
    subscription_renews_at: periodEnd ? new Date(periodEnd * 1000).toISOString() : null,
    stripe_config: { ...(company.stripe_config || {}), subscription_id: sub.id, cancel_at_period_end: !!sub.cancel_at_period_end }
  });
}

// ---------- refunds ----------
// Full refund of an order's payment (used when RoofQuery can't measure the roof). Safe to call twice.
export async function refundOrder(order) {
  const pi = order.stripe_payment_id;
  if (!connected() || !pi || !/^pi_/.test(pi)) return null;
  try {
    const r = await api('POST', '/refunds', { payment_intent: pi, reason: 'requested_by_customer', metadata: { order_id: order.id, report_number: 'RS-' + order.report_number } }, { idempotencyKey: 'refund-' + order.id });
    return r.id;
  } catch (e) {
    if (e.stripe && e.stripe.code === 'charge_already_refunded') return 'already_refunded';
    throw e;
  }
}
