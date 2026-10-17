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
  roofquery: { apiKey: String(env.ROOFQUERY_API_KEY || '').trim(), webhookSecret: String(env.ROOFQUERY_WEBHOOK_SECRET || '').trim(), baseUrl: trimSlash(env.ROOFQUERY_BASE_URL) || 'https://api.roofquery.com' },
  stripe: { secretKey: String(env.STRIPE_SECRET_KEY || '').trim(), webhookSecret: String(env.STRIPE_WEBHOOK_SECRET || '').trim() },
  azureMapsKey: String(env.AZURE_MAPS_KEY || '').trim(),
  email: { sendgridKey: String(env.SENDGRID_API_KEY || '').trim(), from: String(env.EMAIL_FROM || 'reports@rapidsquares.com').trim() }
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
  return p;
}

export function connected() {
  return {
    supabase: !!(config.supabase.url && config.supabase.secretKey),
    roofquery: !!config.roofquery.apiKey,
    stripe: !!config.stripe.secretKey,
    email: !!config.email.sendgridKey
  };
}
