// `npm run check`: tests each connection in server/.env and explains what to fix.
import { config, configProblems } from '../src/config.js';

const ok = (m) => console.log('  ✔ ' + m);
const bad = (m) => { console.log('  ✘ ' + m); failed = true; };
const skip = (m) => console.log('  – ' + m);
let failed = false;

console.log('\nChecking Rapid Squares settings (server/.env)\n');
const problems = configProblems();
if (problems.length) { problems.forEach(bad); console.log('\nFix the items above, then run this again.\n'); process.exit(1); }

const sb = config.supabase;
const h = { apikey: sb.secretKey, ...(/^eyJ/.test(sb.secretKey) ? { Authorization: 'Bearer ' + sb.secretKey } : {}) };

async function tryFetch(url, init) {
  try { return await fetch(url, init); } catch (e) { return { ok: false, status: 0, error: e.message, text: async () => '' }; }
}

// 1. Supabase reachable + secret key accepted + schema installed.
const r = await tryFetch(`${sb.url}/rest/v1/products?select=id`, { headers: h });
const rText = r.status ? await r.text() : '';
if (r.status === 0) bad(`Can’t reach ${sb.url}. Check SUPABASE_URL and your internet connection.`);
else if (/42501|permission denied/i.test(rText)) bad('Your secret key works, but the database hasn’t given the backend access to the tables yet. Run the latest supabase/schema.sql in the SQL Editor again.');
else if (r.status === 401 || r.status === 403) bad('Supabase rejected SUPABASE_SECRET_KEY. Copy the secret (service_role) key again.');
else if (r.status === 404 || /PGRST205|42P01/.test(rText)) bad(`Connected to Supabase (${sb.url}), but the tables aren’t there. Run supabase/schema.sql in the SQL Editor of this same project and check it says Success.`);
else if (!r.ok) bad(`Supabase answered with an error (${r.status}).`);
else {
  const rows = JSON.parse(rText || '[]');
  ok('Supabase database: connected');
  rows.length ? ok(`Database tables: installed (${rows.length} products)`) : bad('Database tables exist but the price list is empty. Run supabase/schema.sql again.');
}

// 2. Public key works for sign-in.
const a = await tryFetch(`${sb.url}/auth/v1/settings`, { headers: { apikey: sb.publishableKey } });
if (a.status === 0) bad('Can’t reach Supabase sign-in.');
else if (!a.ok) bad(`Supabase rejected SUPABASE_PUBLISHABLE_KEY (error ${a.status}). Copy the publishable key again from Project Settings › API Keys; it starts with sb_publishable_ (or eyJ for the older anon key).`);
else {
  const s = await a.json();
  ok('Supabase sign-in: connected');
  if (s.external && s.external.email === false) bad('Email sign-in is turned off. Turn it on in Supabase › Authentication › Sign In / Providers.');
  if (s.mailer_autoconfirm) skip('Email confirmation is off: new accounts can sign in without confirming their email.');
}

// 3. Storage buckets.
const b = await tryFetch(`${sb.url}/storage/v1/bucket`, { headers: h });
if (b.ok) {
  const names = (await b.json()).map((x) => x.id);
  const missing = ['logos', 'avatars', 'roof-photos'].filter((n) => !names.includes(n));
  missing.length ? bad(`Storage buckets missing: ${missing.join(', ')}. Run supabase/schema.sql again.`) : ok('File storage: ready');
}
else if (b.status) skip('Couldn\u2019t list file storage buckets. If logo uploads fail, run supabase/schema.sql again.');

// 4. Later connections.
config.roofquery.apiKey ? ok('RoofQuery key: set') : skip('RoofQuery: not connected yet');
if (config.stripe.secretKey) {
  const st = await tryFetch(`${config.stripe.apiBase}/v1/customers?limit=1`, { headers: { Authorization: 'Bearer ' + config.stripe.secretKey } });
  if (st.status === 0) bad('Can\u2019t reach Stripe.');
  else if (st.status === 401) bad('Stripe rejected STRIPE_SECRET_KEY. Copy the secret key (sk_test_…) again.');
  else ok(`Stripe: connected (${/^sk_live_/.test(config.stripe.secretKey) ? 'LIVE mode, real charges' : 'test mode'})`);
  config.stripe.webhookSecret ? ok('Stripe webhook secret: set') : bad('STRIPE_WEBHOOK_SECRET is empty. Card saving and payment pages won\u2019t finish without it.');
} else skip(`Stripe: not connected yet${config.allowUnpaidTestOrders ? ' (test orders allowed without payment)' : ''}`);
config.email.sendgridKey ? ok('SendGrid key: set') : skip('SendGrid: not connected yet (emails print in the server window)');
if (!/^https:/.test(config.appUrl) && !/localhost|127\.0\.0\.1/.test(config.appUrl)) bad('APP_URL should start with https:// when the site is online.');

console.log(failed ? '\nSome checks failed. Fix them, then run `npm run check` again.\n' : '\nAll set. Start the app with `npm start`.\n');
process.exit(failed ? 1 : 0);
