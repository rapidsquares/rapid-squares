// Rapid Squares backend: serves the website and the /api routes. Start with `npm start`.
import http from 'node:http';
import { config, configProblems, connected } from './config.js';
import { createRouter, sendJson, sendError, serveStatic } from './http.js';
import { registerRoutes } from './routes.js';

const problems = configProblems();
if (problems.length) {
  console.error('\nRapid Squares can’t start yet. Fix these in server/.env:\n');
  problems.forEach((p) => console.error('  • ' + p));
  console.error('\n(Copy server/.env.example to server/.env if you haven’t yet.)\n');
  process.exit(1);
}

const router = createRouter();
registerRoutes(router);

const SECURITY_HEADERS = {
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'X-Frame-Options': 'SAMEORIGIN',
  'Content-Security-Policy': "frame-ancestors 'self'",
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=(self)'
};

// The browser learns how to reach sign-in and the API from this file. Only PUBLIC values go here.
function runtimeConfig() {
  const cfg = { mode: 'live', supabaseUrl: config.supabase.url, supabasePublishableKey: config.supabase.publishableKey, apiBaseUrl: '', azureMapsKey: config.azureMapsKey };
  return `window.RS_RUNTIME = ${JSON.stringify(cfg)};\n`;
}

function cors(req, res) {
  const origin = req.headers.origin;
  if (!origin) return true;
  // Same site as this server (whatever address it's reached at), the APP_URL, or local testing.
  const host = String(req.headers['x-forwarded-host'] || req.headers.host || '');
  const same = origin === config.appUrl || origin === `https://${host}` || origin === `http://${host}` ||
    origin === `http://localhost:${config.port}` || origin === `http://127.0.0.1:${config.port}`;
  if (!same && !config.allowedOrigins.includes(origin)) return false;
  res.setHeader('Access-Control-Allow-Origin', origin);
  res.setHeader('Vary', 'Origin');
  res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PATCH, DELETE, OPTIONS');
  res.setHeader('Access-Control-Max-Age', '600');
  return true;
}

const server = http.createServer(async (req, res) => {
  Object.entries(SECURITY_HEADERS).forEach(([k, v]) => res.setHeader(k, v));
  const url = new URL(req.url, 'http://local');
  const pathname = url.pathname;
  try {
    // Webhooks come from Stripe's servers (no browser, no CORS); signature checks happen in the route.
    if (pathname.startsWith('/webhooks/') && req.method === 'POST') {
      const hit = router.match('POST', pathname);
      if (!hit || hit.methodNotAllowed) return sendJson(res, 404, { error: { code: 'not_found', message: 'Unknown webhook.' } });
      const out = await hit.handler({ req, res, params: hit.params, query: url.searchParams });
      if (!res.headersSent) sendJson(res, 200, out ?? {});
      return;
    }
    if (pathname.startsWith('/api/')) {
      if (!cors(req, res)) return sendJson(res, 403, { error: { code: 'origin_not_allowed', message: 'This website isn’t allowed to use the Rapid Squares API.' } });
      if (req.method === 'OPTIONS') { res.writeHead(204); return res.end(); }
      const hit = router.match(req.method, pathname);
      if (!hit) return sendJson(res, 404, { error: { code: 'not_found', message: 'That API route doesn’t exist.' } });
      if (hit.methodNotAllowed) return sendJson(res, 405, { error: { code: 'method_not_allowed', message: 'That method isn’t supported here.' } });
      const out = await hit.handler({ req, res, params: hit.params, query: url.searchParams });
      if (!res.headersSent) sendJson(res, 200, out ?? {});
      return;
    }
    if (req.method !== 'GET' && req.method !== 'HEAD') return sendJson(res, 405, { error: { code: 'method_not_allowed', message: 'Method not allowed.' } });
    if (pathname === '/runtime-config.js') {
      res.writeHead(200, { 'Content-Type': 'application/javascript; charset=utf-8', 'Cache-Control': 'no-store' });
      return res.end(runtimeConfig());
    }
    if (await serveStatic(req, res, config.siteDir, pathname)) return;
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Not found');
  } catch (err) {
    if (!res.headersSent) sendError(res, err); else res.end();
  }
});

server.on('error', (e) => {
  if (e.code === 'EADDRINUSE') console.error(`\nPort ${config.port} is already in use. Close the other program using it, or set PORT in server/.env.\n`);
  else console.error(e);
  process.exit(1);
});

server.listen(config.port, () => {
  const c = connected();
  const mark = (on) => (on ? 'connected' : 'not connected yet');
  console.log(`\nRapid Squares is running: ${config.appUrl}\n`);
  console.log(`  Supabase   ${mark(c.supabase)}`);
  console.log(`  RoofQuery  ${mark(c.roofquery)}`);
  console.log(`  Stripe     ${mark(c.stripe)}${!c.stripe && config.allowUnpaidTestOrders ? ' (test orders allowed without payment)' : ''}`);
  console.log(`  SendGrid   ${mark(c.email)}${c.email ? '' : ' (emails print here instead)'}`);
  console.log('\nPress Ctrl+C to stop.\n');
});
