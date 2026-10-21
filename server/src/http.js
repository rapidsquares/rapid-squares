// Small HTTP toolkit: errors, a router, body parsing and static files. Node built-ins only.
import fs from 'node:fs/promises';
import path from 'node:path';

export class HttpError extends Error {
  constructor(status, code, message) { super(message); this.status = status; this.code = code; }
}
export const fail = (status, code, message) => { throw new HttpError(status, code, message); };

export function sendJson(res, status, data, headers = {}) {
  const body = data === null || data === undefined ? '' : JSON.stringify(data);
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...headers });
  res.end(body);
}
export function sendError(res, err) {
  if (err instanceof HttpError) return sendJson(res, err.status, { error: { code: err.code, message: err.message } });
  console.error('[error]', err);
  return sendJson(res, 500, { error: { code: 'server_error', message: 'Something went wrong on our side. Try again in a moment.' } });
}

// ---------- router ----------
export function createRouter() {
  const routes = [];
  const add = (method) => (pattern, handler) => {
    const keys = [];
    const re = new RegExp('^' + pattern.replace(/:(\w+)/g, (_, k) => { keys.push(k); return '([^/]+)'; }) + '$');
    routes.push({ method, re, keys, handler });
  };
  return {
    get: add('GET'), post: add('POST'), patch: add('PATCH'), delete: add('DELETE'),
    match(method, pathname) {
      let pathMatched = false;
      for (const r of routes) {
        const m = pathname.match(r.re);
        if (!m) continue;
        pathMatched = true;
        if (r.method !== method) continue;
        const params = {};
        r.keys.forEach((k, i) => { params[k] = decodeURIComponent(m[i + 1]); });
        return { handler: r.handler, params };
      }
      return pathMatched ? { methodNotAllowed: true } : null;
    }
  };
}

// ---------- request bodies ----------
export async function readBody(req, limitBytes) {
  const chunks = []; let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > limitBytes) fail(413, 'too_large', 'That upload is too large.');
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}
export async function readJson(req) {
  const type = String(req.headers['content-type'] || '');
  const raw = await readBody(req, 1024 * 1024);
  if (!raw.length) return {};
  if (!type.includes('application/json')) fail(415, 'unsupported_type', 'Send the request as JSON.');
  try { return JSON.parse(raw.toString('utf8')); } catch { fail(400, 'bad_json', 'The request body isn’t valid JSON.'); }
}
// Parses multipart/form-data (file uploads) with the built-in Request/FormData.
export async function readForm(req, limitBytes) {
  const type = String(req.headers['content-type'] || '');
  if (!type.includes('multipart/form-data')) fail(415, 'unsupported_type', 'Upload the file as multipart form data.');
  const raw = await readBody(req, limitBytes);
  try { return await new Request('http://local/upload', { method: 'POST', headers: { 'content-type': type }, body: raw }).formData(); }
  catch { fail(400, 'bad_upload', 'That upload couldn’t be read. Try again.'); }
}

// ---------- static website ----------
const MIME = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp',
  '.gif': 'image/gif', '.ico': 'image/x-icon', '.woff2': 'font/woff2', '.txt': 'text/plain; charset=utf-8', '.pdf': 'application/pdf'
};
// Folders and files in the repo that must never be served to browsers.
const PRIVATE_TOP = new Set(['server', 'supabase', 'node_modules', 'package.json', 'package-lock.json']);
const PRIVATE_EXT = new Set(['.ps1', '.bat', '.md', '.sql', '.env', '.log']);

export async function serveStatic(req, res, siteDir, pathname) {
  let rel;
  try { rel = decodeURIComponent(pathname).replace(/^\/+/, ''); } catch { return false; }
  if (rel === '') rel = 'index.html';
  const parts = rel.split('/');
  if (parts.some((p) => p === '..' || p.startsWith('.')) || PRIVATE_TOP.has(parts[0])) return false;
  const full = path.resolve(siteDir, rel);
  if (!full.startsWith(siteDir + path.sep)) return false;
  const ext = path.extname(full).toLowerCase();
  if (PRIVATE_EXT.has(ext)) return false;
  let data;
  try {
    const st = await fs.stat(full);
    if (!st.isFile()) return false;
    data = await fs.readFile(full);
  } catch { return false; }
  res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream', 'Content-Length': data.length, 'Cache-Control': 'no-cache' });
  res.end(req.method === 'HEAD' ? undefined : data);
  return true;
}
