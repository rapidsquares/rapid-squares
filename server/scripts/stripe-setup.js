// `npm run stripe:setup` (test keys, server/.env) or `npm run stripe:setup:prod` (live keys, server/.env.production):
// makes sure the Stripe account has what the site needs. Safe to run again: it finds what already exists.
//
//   1. The subscription product, with a monthly and a yearly price (found by their lookup keys).
//   2. The billing portal setup behind "Manage subscription" (card, invoices, cancel, switch plans).
//   3. The webhook for https://rapidsquares.com/webhooks/stripe with every event the server handles.
//      A new webhook's signing secret is shown only once, so it's written to the env file given
//      with --save-secret (never printed).
import fs from 'node:fs';
import { config } from '../src/config.js';
import { api, SUBSCRIPTION_PRODUCT, PLANS, WEBHOOK_EVENTS } from '../src/stripe.js';

const arg = (name) => { const i = process.argv.indexOf(name); return i > 0 ? process.argv[i + 1] : null; };
const webhookUrl = arg('--webhook-url') || 'https://rapidsquares.com/webhooks/stripe';
const saveSecretTo = arg('--save-secret');
const mode = /^sk_live_/.test(config.stripe.secretKey) ? 'LIVE' : 'test';
const say = (m) => console.log('  ' + m);
const money = (c) => '$' + (c / 100).toLocaleString('en-US', { minimumFractionDigits: 2 });

if (!config.stripe.secretKey) { console.log('STRIPE_SECRET_KEY is empty.'); process.exit(1); }
console.log(`\nSetting up Stripe (${mode} mode)\n`);

// ---------- 1. product and prices ----------
const found = await api('GET', '/prices', { lookup_keys: Object.values(PLANS).map((p) => p.lookupKey), active: true, expand: ['data.product'] });
let product = found.data.map((p) => p.product).find((p) => p && p.active && p.metadata && p.metadata.app === 'rapid-squares');
if (!product) {
  const list = await api('GET', '/products', { active: true, limit: 100 });
  product = list.data.find((p) => p.metadata && p.metadata.app === 'rapid-squares' && p.metadata.kind === 'subscription');
}
if (!product) {
  product = await api('POST', '/products', {
    name: SUBSCRIPTION_PRODUCT.name, description: SUBSCRIPTION_PRODUCT.description,
    metadata: { app: 'rapid-squares', kind: 'subscription', trial_days: String(config.trialDays) }
  }, { idempotencyKey: 'rs-subscription-product-v1' });
  say(`✔ Created product “${product.name}” (${product.id})`);
} else say(`✔ Product “${product.name}” already exists (${product.id})`);

for (const [plan, p] of Object.entries(PLANS)) {
  const have = found.data.find((x) => x.lookup_key === p.lookupKey);
  if (have && have.unit_amount === p.cents && have.recurring && have.recurring.interval === p.interval) {
    say(`✔ ${plan} price already exists: ${money(have.unit_amount)}/${p.interval} (${have.id})`);
    continue;
  }
  // New price (or the amount changed): create it and move the lookup key over; the old price is kept for current subscribers.
  const price = await api('POST', '/prices', {
    product: product.id, currency: 'usd', unit_amount: p.cents, recurring: { interval: p.interval },
    lookup_key: p.lookupKey, transfer_lookup_key: true, nickname: p.label,
    metadata: { app: 'rapid-squares', plan, trial_days: String(config.trialDays) }
  });
  say(`✔ Created ${plan} price: ${money(price.unit_amount)}/${p.interval} (${price.id})${have ? ', replacing ' + have.id : ''}`);
}
const prices = (await api('GET', '/prices', { lookup_keys: Object.values(PLANS).map((p) => p.lookupKey), active: true })).data;

// ---------- 2. billing portal ----------
const portalFeatures = {
  customer_update: { enabled: true, allowed_updates: ['email', 'address', 'name'] },
  invoice_history: { enabled: true },
  payment_method_update: { enabled: true },
  subscription_cancel: { enabled: true, mode: 'at_period_end' },
  subscription_update: {
    enabled: true, default_allowed_updates: ['price'], proration_behavior: 'create_prorations',
    products: [{ product: product.id, prices: prices.map((p) => p.id) }]
  }
};
const configs = await api('GET', '/billing_portal/configurations', { active: true, limit: 100 });
const ours = configs.data.find((c) => c.metadata && c.metadata.app === 'rapid-squares');
const portal = {
  business_profile: { headline: 'Manage your Rapid Squares subscription' },
  features: portalFeatures, default_return_url: `${config.appUrl}/account.html#billing`, metadata: { app: 'rapid-squares' }
};
if (ours) { await api('POST', `/billing_portal/configurations/${ours.id}`, portal); say(`✔ Billing portal updated (${ours.id})`); }
else { const c = await api('POST', '/billing_portal/configurations', portal); say(`✔ Billing portal set up (${c.id})`); }

// ---------- 3. webhook ----------
const hooks = await api('GET', '/webhook_endpoints', { limit: 100 });
const hook = hooks.data.find((h) => h.url === webhookUrl);
if (hook) {
  const missing = WEBHOOK_EVENTS.filter((e) => !hook.enabled_events.includes(e) && !hook.enabled_events.includes('*'));
  if (missing.length || hook.status !== 'enabled') {
    await api('POST', `/webhook_endpoints/${hook.id}`, { enabled_events: [...new Set([...hook.enabled_events, ...WEBHOOK_EVENTS])], disabled: false });
    say(`✔ Webhook ${webhookUrl}: added ${missing.join(', ') || 'nothing'}${hook.status !== 'enabled' ? ', turned on' : ''}`);
  } else say(`✔ Webhook ${webhookUrl} already has every event the server needs`);
  say('  (its signing secret is unchanged: keep the STRIPE_WEBHOOK_SECRET you have)');
} else {
  const created = await api('POST', '/webhook_endpoints', { url: webhookUrl, enabled_events: WEBHOOK_EVENTS, description: 'Rapid Squares server', metadata: { app: 'rapid-squares' } });
  say(`✔ Created webhook ${webhookUrl} with ${WEBHOOK_EVENTS.length} events (${created.id})`);
  if (saveSecretTo) {
    const file = fs.readFileSync(saveSecretTo, 'utf8');
    const next = /^STRIPE_WEBHOOK_SECRET=.*$/m.test(file) ? file.replace(/^STRIPE_WEBHOOK_SECRET=.*$/m, 'STRIPE_WEBHOOK_SECRET=' + created.secret) : file + '\nSTRIPE_WEBHOOK_SECRET=' + created.secret + '\n';
    fs.writeFileSync(saveSecretTo, next, { mode: 0o600 });
    say(`  Its signing secret was saved to ${saveSecretTo} as STRIPE_WEBHOOK_SECRET.`);
  } else say('  Its signing secret is only shown once and wasn’t saved (run with --save-secret <env file>). Roll it in the Stripe dashboard to get a new one.');
}
console.log('\nDone.\n');
