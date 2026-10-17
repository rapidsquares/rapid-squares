// Talks to Supabase over its standard HTTP APIs (database, storage, sign-in checks).
// Uses the SECRET key, so it must only ever run on the server.
import crypto from 'node:crypto';
import { config } from './config.js';
import { HttpError, fail } from './http.js';

const sb = config.supabase;

function headers(extra = {}) {
  const h = { apikey: sb.secretKey, ...extra };
  // Legacy service_role keys are JWTs and also go in Authorization; new sb_secret_ keys go in apikey only.
  if (/^eyJ/.test(sb.secretKey)) h.Authorization = 'Bearer ' + sb.secretKey;
  return h;
}

async function call(url, init) {
  let res;
  try { res = await fetch(url, init); }
  catch (e) { console.error('[supabase] unreachable:', e.message); throw new HttpError(503, 'database_unreachable', 'Can’t reach the database right now. Try again in a moment.'); }
  const text = await res.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  if (!res.ok) {
    const code = data && data.code;
    console.error('[supabase]', res.status, init.method || 'GET', url.replace(sb.url, ''), data);
    if (code === '23505') throw new HttpError(409, 'conflict', 'That already exists.');
    if (code === '23503') throw new HttpError(409, 'conflict', 'That refers to something that no longer exists.');
    if (code === '42501') throw new HttpError(500, 'database_setup', 'The backend isn’t allowed to use the database tables yet. Run the latest supabase/schema.sql in the SQL Editor.');
    if (res.status === 401 || res.status === 403) throw new HttpError(500, 'database_auth', 'The server’s database key was rejected. Check SUPABASE_SECRET_KEY in server/.env.');
    if (code === '42P01' || code === 'PGRST205') throw new HttpError(500, 'database_setup', 'A database table is missing. Run supabase/schema.sql in the Supabase SQL Editor.');
    throw new HttpError(500, 'database_error', 'The database couldn’t complete that request.');
  }
  return { data, res };
}

// Filter helpers (PostgREST syntax).
export const eq = (v) => 'eq.' + v;
export const inList = (arr) => 'in.(' + arr.map((v) => '"' + String(v).replace(/"/g, '') + '"').join(',') + ')';
export const gte = (v) => 'gte.' + v;
export const gt = (v) => 'gt.' + v;
export const ilike = (v) => 'ilike.' + v;

function qs(params) {
  const u = new URLSearchParams();
  Object.entries(params || {}).forEach(([k, v]) => { if (v !== undefined && v !== null) u.append(k, String(v)); });
  const s = u.toString();
  return s ? '?' + s : '';
}

export const db = {
  async select(table, params = {}, { count = false } = {}) {
    const { data, res } = await call(`${sb.url}/rest/v1/${table}${qs({ select: '*', ...params })}`,
      { method: 'GET', headers: headers({ Accept: 'application/json', ...(count ? { Prefer: 'count=exact' } : {}) }) });
    const list = Array.isArray(data) ? data : [];
    if (!count) return list;
    const range = res.headers.get('content-range') || '';
    const total = parseInt(range.split('/')[1], 10);
    return { rows: list, total: Number.isFinite(total) ? total : list.length };
  },
  async one(table, params = {}) {
    const rows = await db.select(table, { ...params, limit: 1 });
    return rows[0] || null;
  },
  async insert(table, rows) {
    const { data } = await call(`${sb.url}/rest/v1/${table}`,
      { method: 'POST', headers: headers({ 'Content-Type': 'application/json', Accept: 'application/json', Prefer: 'return=representation' }), body: JSON.stringify(rows) });
    return data;
  },
  async update(table, filters, patch) {
    if (!filters || !Object.keys(filters).length) throw new Error('update needs filters');
    const { data } = await call(`${sb.url}/rest/v1/${table}${qs(filters)}`,
      { method: 'PATCH', headers: headers({ 'Content-Type': 'application/json', Accept: 'application/json', Prefer: 'return=representation' }), body: JSON.stringify(patch) });
    return data;
  },
  async remove(table, filters) {
    if (!filters || !Object.keys(filters).length) throw new Error('remove needs filters');
    const { data } = await call(`${sb.url}/rest/v1/${table}${qs(filters)}`,
      { method: 'DELETE', headers: headers({ Accept: 'application/json', Prefer: 'return=representation' }) });
    return data;
  }
};

export const storage = {
  // Uploads bytes and returns the public URL (logos and avatars live in public buckets).
  async uploadPublic(bucket, objectPath, bytes, contentType) {
    await call(`${sb.url}/storage/v1/object/${bucket}/${objectPath}`,
      { method: 'POST', headers: headers({ 'Content-Type': contentType, 'x-upsert': 'true', 'Cache-Control': 'max-age=60' }), body: bytes });
    return `${sb.url}/storage/v1/object/public/${bucket}/${objectPath}?v=${Date.now()}`;
  }
};

// ---------- sign-in checks ----------
// The website sends the Supabase session's access token. We verify its signature locally
// (new projects: public keys from JWKS; older projects: the shared JWT secret), and fall
// back to asking Supabase if neither is possible.
let jwksCache = { at: 0, keys: [] };
async function jwks(kid) {
  const fresh = Date.now() - jwksCache.at < 10 * 60 * 1000;
  const known = !kid || jwksCache.keys.some((k) => k.kid === kid);
  // Refetch when stale, or when a new key id shows up (Supabase rotated its signing key) — at most once a minute.
  if (fresh && jwksCache.keys.length && (known || Date.now() - jwksCache.at < 60 * 1000)) return jwksCache.keys;
  try {
    const res = await fetch(`${sb.url}/auth/v1/.well-known/jwks.json`, { headers: { apikey: sb.publishableKey } });
    const body = res.ok ? await res.json() : { keys: [] };
    jwksCache = { at: Date.now(), keys: Array.isArray(body.keys) ? body.keys : [] };
  } catch { jwksCache = { at: Date.now(), keys: [] }; }
  return jwksCache.keys;
}
function b64urlJson(part) { return JSON.parse(Buffer.from(part, 'base64url').toString('utf8')); }

async function verifyLocally(token) {
  const parts = token.split('.');
  if (parts.length !== 3) return { ok: false };
  let header, payload;
  try { header = b64urlJson(parts[0]); payload = b64urlJson(parts[1]); } catch { return { ok: false }; }
  const data = Buffer.from(parts[0] + '.' + parts[1]);
  const sig = Buffer.from(parts[2], 'base64url');
  let valid = null;
  if (header.alg === 'HS256') {
    if (!sb.jwtSecret) return { ok: null };
    const expect = crypto.createHmac('sha256', sb.jwtSecret).update(data).digest();
    valid = expect.length === sig.length && crypto.timingSafeEqual(expect, sig);
  } else if (header.alg === 'ES256' || header.alg === 'RS256') {
    const keys = await jwks(header.kid);
    const jwk = keys.find((k) => k.kid === header.kid) || (keys.length === 1 ? keys[0] : null);
    if (!jwk) return { ok: null };
    const key = crypto.createPublicKey({ key: jwk, format: 'jwk' });
    valid = header.alg === 'ES256'
      ? crypto.verify('sha256', data, { key, dsaEncoding: 'ieee-p1363' }, sig)
      : crypto.verify('RSA-SHA256', data, key, sig);
  } else return { ok: false };
  if (!valid) return { ok: false };
  const now = Math.floor(Date.now() / 1000);
  if (payload.exp && payload.exp < now - 30) return { ok: false, expired: true };
  if (payload.nbf && payload.nbf > now + 30) return { ok: false };
  const aud = Array.isArray(payload.aud) ? payload.aud : [payload.aud];
  if (!aud.includes('authenticated')) return { ok: false };
  if (payload.iss && payload.iss !== `${sb.url}/auth/v1`) return { ok: false };
  if (!payload.sub) return { ok: false };
  return { ok: true, user: { id: payload.sub, email: payload.email || null } };
}

export async function userFromToken(token) {
  if (!token) fail(401, 'unauthorized', 'Sign in to continue.');
  const local = await verifyLocally(token);
  if (local.ok) return local.user;
  if (local.ok === false) fail(401, 'unauthorized', local.expired ? 'Your session expired. Sign in again.' : 'Sign in to continue.');
  // Couldn't verify locally: ask Supabase.
  let res;
  try { res = await fetch(`${sb.url}/auth/v1/user`, { headers: { apikey: sb.publishableKey, Authorization: 'Bearer ' + token } }); }
  catch { fail(503, 'auth_unreachable', 'Can’t reach the sign-in service right now. Try again in a moment.'); }
  if (!res.ok) fail(401, 'unauthorized', 'Sign in to continue.');
  const u = await res.json();
  return { id: u.id, email: u.email || null };
}
