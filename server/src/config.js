// Reads settings from environment variables (loaded from .env by `node --env-file=.env`).
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const env = process.env;

// Supabase URL: keep only https://xxxx.supabase.co even if extra bits like /rest/v1/ were pasted.
function origin(s) { const t = trimSlash(s).replace(/^['"]|['"]$/g, ''); try { return new URL(t).origin; } catch { return t; } }
function trimSlash(s) { return String(s || '').trim().replace(/\/+$/, ''); }
function list(s) { return String(s || '').split(',').map((x) => trimSlash(x)).filter(Boolean); }
function bool(s, dflt) { if (s === undefined || s === '') return dflt; return /^(1|true|yes|on)$/i.test(String(s).trim()); }

export const config = {
  port: parseInt(env.PORT, 10) || 3000,
  appUrl: trimSlash(env.APP_URL) || `http://localhost:${parseInt(env.PORT, 10) || 3000}`,
  siteDir: path.resolve(env.SITE_DIR || path.join(here, '..', '..')),
  allowedOrigins: list(env.ALLOWED_ORIGINS),
  freeReportsOnSignup: Math.max(0, parseInt(env.FREE_REPORTS_ON_SIGNUP, 10) || 0),
  allowUnpaidTestOrders: bool(env.ALLOW_UNPAID_TEST_ORDERS, false),

  supabase: {
    url: origin(env.SUPABASE_URL),
    publishableKey: String(env.SUPABASE_PUBLISHABLE_KEY || env.SUPABASE_ANON_KEY || '').trim().replace(/^['"]|['"]$/g, ''),
    secretKey: String(env.SUPABASE_SECRET_KEY || env.SUPABASE_SERVICE_ROLE_KEY || '').trim().replace(/^['"]|['"]$/g, ''),
    jwtSecret: String(env.SUPABASE_JWT_SECRET || '').trim()
  },
  roofquery: {
    apiKey: String(env.ROOFQUERY_API_KEY || '').trim().replace(/^["']|["']$/g, ''),
    webhookSecret: String(env.ROOFQUERY_WEBHOOK_SECRET || '').trim().replace(/^["']|["']$/g, ''),
    baseUrl: trimSlash(env.ROOFQUERY_BASE_URL) || 'https://api.roofquery.com',
    // What gets measured: primary_only · primary_and_garage · all_structures
    scope: ['primary_only', 'primary_and_garage', 'all_structures'].includes(String(env.ROOFQUERY_SCOPE || '').trim()) ? String(env.ROOFQUERY_SCOPE).trim() : 'primary_and_garage',
    syncEverySeconds: Math.max(30, parseInt(env.ROOFQUERY_SYNC_SECONDS, 10) || 120)
  },
  // Who hears about problems that need a person (RoofQuery balance too low, an order that couldn't be placed).
  adminEmail: String(env.ADMIN_EMAIL || env.EMAIL_REPLY_TO || '').trim(),
  // Signs download links. Defaults to a value derived from the Supabase secret key.
  downloadSecret: String(env.DOWNLOAD_LINK_SECRET || '').trim(),
  stripe: {
    secretKey: String(env.STRIPE_SECRET_KEY || '').trim(), webhookSecret: String(env.STRIPE_WEBHOOK_SECRET || '').trim(),
    apiBase: trimSlash(env.STRIPE_API_BASE) || 'https://api.stripe.com',
    monthlyCents: parseInt(env.SUBSCRIPTION_MONTHLY_CENTS, 10) || 10000,
    yearlyCents: parseInt(env.SUBSCRIPTION_YEARLY_CENTS, 10) || 100000
  },
  azureMapsKey: String(env.AZURE_MAPS_KEY || '').trim(),
  email: {
    resendKey: String(env.RESEND_API_KEY || '').trim().replace(/^["']|["']$/g, ''),
    apiBase: trimSlash(env.RESEND_API_BASE) || 'https://api.resend.com',
    from: String(env.EMAIL_FROM || 'Rapid Squares <reports@rapidsquares.com>').trim().replace(/^["']|["']$/g, ''),
    replyTo: String(env.EMAIL_REPLY_TO || '').trim()
  }
};

// Problems that stop the server from starting, explained in plain words.
export function configProblems() {
  const p = [];
  const s = config.supabase;
  if (!s.url) p.push('SUPABASE_URL is empty. Copy the Project URL from Supabase › Project Settings › Data API.');
  else if (!/^https:\/\/.+/.test(s.url) && !/^http:\/\/(localhost|127\.0\.0\.1)/.test(s.url)) p.push('SUPABASE_URL should look like https://abcd1234.supabase.co');
  if (!s.publishableKey) p.push('SUPABASE_PUBLISHABLE_KEY is empty. Use the public "publishable" (or "anon") key.');
  if (!s.secretKey) p.push('SUPABASE_SECRET_KEY is empty. Use the "secret" (or "service_role") key.');
  if (s.secretKey && s.publishableKey && s.secretKey === s.publishableKey) p.push('SUPABASE_SECRET_KEY and SUPABASE_PUBLISHABLE_KEY are the same. The secret key is a different value.');
  if (/^sb_publishable_/.test(s.secretKey)) p.push('SUPABASE_SECRET_KEY holds a publishable key. Use the key that starts with sb_secret_ (or the service_role key).');
  const k = config.stripe.secretKey;
  if (k && !/^(sk|rk)_(test|live)_/.test(k)) p.push('STRIPE_SECRET_KEY should start with sk_test_ (test mode) or sk_live_. The pk_ key is the wrong one.');
  if (k && !config.stripe.webhookSecret) console.warn('[stripe] STRIPE_WEBHOOK_SECRET is empty: card saving, subscriptions and payment pages won\u2019t finish until it\u2019s set.');
  const rqk = config.roofquery.apiKey;
  if (rqk && !/^rq_(test|live)_sk_/.test(rqk)) p.push('ROOFQUERY_API_KEY should start with rq_test_sk_ (sandbox) or rq_live_sk_. Copy it again from the RoofQuery portal.');
  const rk = config.email.resendKey;
  if (rk && !/^re_/.test(rk)) p.push('RESEND_API_KEY should start with re_. Copy it again from Resend › API Keys.');
  if (!/@[^@\s>]+\.[a-z]{2,}/i.test(config.email.from)) p.push('EMAIL_FROM should be an address like Rapid Squares <reports@rapidsquares.com>.');
  return p;
}

export function connected() {
  return {
    supabase: !!(config.supabase.url && config.supabase.secretKey),
    roofquery: !!config.roofquery.apiKey,
    stripe: !!config.stripe.secretKey,
    email: !!config.email.resendKey
  };
}
