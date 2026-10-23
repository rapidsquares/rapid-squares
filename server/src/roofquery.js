// RoofQuery: places measurement orders, reads their status, keeps each company's brand
// profile in sync, and fetches the finished PDF / ESX. Uses the SECRET API key, so it only
// ever runs on the server. Docs: https://api.roofquery.com (API reference).
import crypto from 'node:crypto';
import { config } from './config.js';
import { db, eq } from './supabase.js';

const rq = config.roofquery;
export const connected = () => !!rq.apiKey;
export const sandbox = () => /^rq_test_/.test(rq.apiKey);

// Our products → RoofQuery report types. Certified Residential is RoofQuery's Rapid Squares (beta, turned on
// per account): each building outlined by a person, one estimated pitch, squares at every pitch. No ESX or drawings.
const REPORT_TYPE = { premium_residential: 'residential', certified_residential: 'rapid_squares', commercial: 'commercial' };
export const isRapidSquares = (reportType) => REPORT_TYPE[reportType] === 'rapid_squares';

export class RqError extends Error {
  constructor(status, code, message) { super(message || code); this.status = status; this.code = code; }
}

export async function api(method, path, { body, raw, headers = {}, idempotencyKey, auth = true } = {}) {
  const h = { ...headers };
  if (auth) h.Authorization = 'Bearer ' + rq.apiKey;
  if (body !== undefined) h['Content-Type'] = 'application/json';
  if (idempotencyKey) h['Idempotency-Key'] = idempotencyKey;
  let res;
  try {
    res = await fetch(rq.baseUrl + path, { method, headers: h, body: body !== undefined ? JSON.stringify(body) : raw, signal: AbortSignal.timeout(60000) });
  } catch (e) {
    throw new RqError(0, 'unreachable', 'Can’t reach RoofQuery: ' + e.message);
  }
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    const err = new RqError(res.status, data.error || 'http_' + res.status, data.error_description || res.statusText);
    console.error('[roofquery]', res.status, method, path.replace(/\?.*/, ''), err.code, err.message);
    throw err;
  }
  return res;
}
const json = async (method, path, opts) => (await api(method, path, opts)).json();

// ---------- address ----------
const US_ZIP = /^\d{5}(-\d{4})?$/, CA_POST = /^[A-Za-z]\d[A-Za-z] ?\d[A-Za-z]\d$/;
// Street / city / state / postal code / country, from what Azure gave us at lookup, or parsed
// from the one-line address ("6515 Turnbridge Pl, Prospect, KY 40059, USA") as a fallback.
export function addressParts(order) {
  const p = order.address_parts || {};
  const out = { street: p.street, city: p.city, state: p.state, postalCode: p.postalCode, country: p.country };
  if (!(out.street && out.city && out.state && out.postalCode)) {
    const m = String(order.address || '').match(/^(.+?),\s*([^,]+?),\s*([A-Za-z]{2})\.?\s+(\d{5}(?:-\d{4})?|[A-Za-z]\d[A-Za-z] ?\d[A-Za-z]\d)\s*(?:,\s*(.+))?$/);
    if (m) Object.assign(out, { street: out.street || m[1], city: out.city || m[2], state: out.state || m[3], postalCode: out.postalCode || m[4], country: out.country || m[5] });
  }
  out.state = String(out.state || '').trim().toUpperCase();
  out.postalCode = String(out.postalCode || '').trim().toUpperCase();
  let c = String(out.country || '').trim().toUpperCase();
  if (/^(US|USA|UNITED STATES.*)$/.test(c)) c = 'US';
  else if (/^(CA|CAN|CANADA)$/.test(c)) c = 'CA';
  else c = CA_POST.test(out.postalCode) ? 'CA' : 'US';
  out.country = c;
  if (c === 'CA' && /^[A-Z]\d[A-Z]\d[A-Z]\d$/.test(out.postalCode)) out.postalCode = out.postalCode.slice(0, 3) + ' ' + out.postalCode.slice(3);
  const missing = ['street', 'city', 'state', 'postalCode'].filter((k) => !String(out[k] || '').trim());
  if (!missing.length && !(c === 'US' ? US_ZIP : CA_POST).test(out.postalCode)) missing.push('postalCode');
  if (!/^[A-Z]{2}$/.test(out.state)) missing.push('state');
  return { parts: out, missing };
}

// ---------- ordering ----------
// key: the Idempotency-Key for this try (a new one after RoofQuery refused the last). brand: the company's
// brand profile, which the order keeps for good.
export async function placeOrder(order, { key, brand } = {}) {
  const { parts, missing } = addressParts(order);
  if (missing.length) throw new RqError(400, 'ADDRESS_INCOMPLETE', `The address is missing its ${missing.join(', ')}.`);
  const body = {
    country: parts.country, street: parts.street, city: parts.city, state: parts.state, postalCode: parts.postalCode,
    latitude: order.lat, longitude: order.lon,
    // What to measure, as chosen when ordering (older orders: commercial measures every building).
    scope: (order.order_details && order.order_details.scope) || (order.report_type === 'commercial' ? 'all_structures' : rq.scope),
    reportType: REPORT_TYPE[order.report_type] || 'residential'
  };
  // The ESX is part of the order when it was bought with it (Rapid Squares never has one).
  if (body.reportType !== 'rapid_squares') body.esx = !!order.esx_purchased;
  if (brand) body.brand = brand;
  // Optional job details from the order form. The claim number also names the ESX file.
  // (Client details stay with us: RoofQuery no longer takes them.)
  const d = order.order_details || {};
  if (d.claim) body.claim = d.claim;
  if (d.notes) body.notes = d.notes;
  return json('POST', '/api/v1/reports/orders', { body, idempotencyKey: key || 'rs-order-' + order.id });
}
// Adds the Xactimate ESX to an order already placed. Safe to call twice: RoofQuery charges once.
export const addEsx = (rqId) => json('POST', `/api/v1/reports/orders/${encodeURIComponent(rqId)}/esx`);
// Storm Report (open beta): hail, wind and tornado history. The response is the finished report.
export const STORM_TEMPLATES = { weather_history: 'Weather History', hail_verification: 'Hail Verification', wind_verification: 'Wind Verification', date_of_loss: 'Date of Loss', homeowner: 'Homeowner Storm Summary' };
export async function placeStorm(order, { key } = {}) {
  const { parts, missing } = addressParts(order);
  if (missing.length) throw new RqError(400, 'ADDRESS_INCOMPLETE', `The address is missing its ${missing.join(', ')}.`);
  // Date of loss, claim, insured name and notes are asked per PDF download instead (see fetchStormPdf).
  const body = {
    reportType: 'storm', country: parts.country, street: parts.street, city: parts.city, state: parts.state, postalCode: parts.postalCode,
    latitude: order.lat, longitude: order.lon, reportName: 'RS-' + order.report_number
  };
  return json('POST', '/api/v1/reports/orders', { body, idempotencyKey: key || 'rs-storm-' + order.id });
}
// One PDF, with this download's details (date of loss, claim number, insured name, notes).
export async function fetchStormPdf(rqId, template, { brand, details = {} } = {}) {
  const body = { template, download: '1', ...(brand ? { brand } : {}) };
  if (details.date_of_loss) body.dateOfLoss = details.date_of_loss;
  if (details.claim) body.claimNumber = details.claim;
  if (details.insured_name) body.insuredName = details.insured_name;
  if (details.notes) body.notes = details.notes;
  // POST takes the same parameters as a JSON body, so long notes never hit a URL length limit.
  return api('POST', `/api/v1/reports/orders/${encodeURIComponent(rqId)}/pdf`, { body, auth: false });
}
// One roof drawing: target is 'all' or a building number; type is lengths, area or pitch.
// SVG, because RoofQuery's PNGs currently come out with blank boxes where the numbers should be.
export const DIAGRAM_TYPES = ['lengths', 'area', 'pitch'];
export const fetchDiagram = (rqId, target, type, size = 1200) =>
  api('GET', `/api/v1/reports/orders/${encodeURIComponent(rqId)}/diagrams/${encodeURIComponent(target)}/${type}?format=svg&size=${size}`, { auth: false });
// Rapid Squares: the photo the outlines were traced on, and the outlines from the XML in that photo's pixels.
export const fetchPhoto = (rqId) => api('GET', `/api/v1/reports/orders/${encodeURIComponent(rqId)}/photo`, { auth: false });
export async function rapidOutlines(rqId) {
  const xml = await (await api('GET', `/api/v1/reports/orders/${encodeURIComponent(rqId)}/xml`, { auth: false })).text();
  const attr = (tag, name) => { const m = tag.match(new RegExp('\\b' + name + '="([^"]*)"')); return m ? m[1] : null; };
  const points = (body) => [...body.matchAll(/<POINT\b[^>]*>/g)].map((m) => [+attr(m[0], 'px'), +attr(m[0], 'py')]).filter((p) => p.every(Number.isFinite));
  const image = (xml.match(/<IMAGE\b[^>]*>/) || [''])[0];
  const width = +attr(image, 'width'), height = +attr(image, 'height');
  if (!(width > 0 && height > 0)) return null;
  const buildings = [...xml.matchAll(/<STRUCTURE\b([^>]*)>([\s\S]*?)<\/STRUCTURE>/g)].map((m) => ({
    index: +attr(m[1], 'id') || null,
    outlines: [...m[2].matchAll(/<OUTLINE\b[^>]*>([\s\S]*?)<\/OUTLINE>/g)].map((o) => points(o[1])).filter((p) => p.length > 2),
    holes: [...m[2].matchAll(/<HOLE\b[^>]*>([\s\S]*?)<\/HOLE>/g)].map((o) => points(o[1])).filter((p) => p.length > 2)
  })).filter((b) => b.outlines.length);
  return { width, height, buildings };
}
export const fetchStormMap = (rqId) => api('GET', `/api/v1/reports/orders/${encodeURIComponent(rqId)}/map.png`, { auth: false });
export const getOrder = (rqId) => json('GET', `/api/v1/reports/orders/${encodeURIComponent(rqId)}/status`);
export const identity = () => json('GET', '/api/v1/identity');
// Instant Query (beta): roof outlines, pitch and area for every building at a point, plus storm history.
// Enabled per account by RoofQuery support; answers 404 until then.
export const instantQuery = (lat, lon) => json('POST', '/api/v1/instant-query', { body: { latitude: lat, longitude: lon } });
export const webhooks = () => json('GET', '/api/v1/webhooks');

// ---------- files (these RoofQuery routes take no key: the order id is the credential) ----------
// The PDF prints the brand the order was placed with; `brand` only applies to orders from before 22 Oct 2026.
// esxPaid: the roofer asked for the ESX and paid for it. Only then, if RoofQuery's order doesn't have it yet,
// is it added (RoofQuery charges us for that upgrade).
export async function fetchFile(rqId, kind, { brand, esxPaid = false } = {}) {
  const qs = new URLSearchParams();
  if (kind === 'pdf') { qs.set('download', '1'); if (brand) qs.set('brand', brand); }
  const q = qs.toString(), get = () => api('GET', `/api/v1/reports/orders/${encodeURIComponent(rqId)}/${kind}${q ? '?' + q : ''}`, { auth: false });
  try { return await get(); }
  catch (e) {
    if (kind !== 'esx' || e.code !== 'ESX_NOT_PURCHASED' || !esxPaid) throw e;
    await addEsx(rqId);
    return get();
  }
}

// ---------- brand profiles: one per company, so PDFs carry the company's own name, logo and colors ----------
const cut = (v, n) => { const s = String(v || '').trim(); return s ? s.slice(0, n) : undefined; };
function brandFields(c) {
  const hex = (v) => (/^#([0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i.test(String(v || '').trim()) ? String(v).trim() : undefined);
  const color = hex(c.brand_color), textColor = hex(c.brand_text_color) || '#FFFFFF'; // header text defaults to white
  return {
    companyName: cut(c.name, 80), address: cut(c.address, 160), licenseNumber: cut(c.license_number, 40),
    publicPhone: cut(c.phone, 32), publicEmail: cut(c.email, 160), brandColor: color, brandTextColor: textColor,
    // Never printed: who RoofQuery reaches if they need to ask about a property.
    contactEmail: cut(c.email, 160), contactPhone: cut(c.phone, 32)
  };
}
// Returns the company's brand profile id, creating or updating it when the branding changed.
// Never throws: on any problem the PDF simply uses the account's default branding.
export async function ensureBrand(company) {
  if (!connected() || !company) return null;
  try {
    const fields = brandFields(company);
    const hash = crypto.createHash('sha256').update(JSON.stringify([fields, company.logo_url || ''])).digest('hex').slice(0, 32);
    let id = company.roofquery_brand_profile_id;
    if (id && company.roofquery_brand_hash === hash) return id;
    // Text fields: create, or update (null clears a field the company removed).
    const patch = Object.fromEntries(Object.entries(fields).map(([k, v]) => [k, v === undefined ? null : v]));
    if (id) {
      try { await json('PATCH', `/api/v1/branding/profiles/${encodeURIComponent(id)}`, { body: patch }); }
      catch (e) { if (e.status === 404) id = null; else throw e; } // deleted in the portal: make a new one
    }
    if (!id) {
      const created = await json('POST', '/api/v1/branding/profiles', { body: Object.fromEntries(Object.entries(fields).filter(([, v]) => v !== undefined)) });
      id = created.profile.profileId;
    }
    // Logo: copy the bytes over (RoofQuery takes the file, never a link).
    if (company.logo_url) {
      const img = await fetch(company.logo_url, { signal: AbortSignal.timeout(20000) });
      const type = img.headers.get('content-type') || '';
      if (img.ok && /^image\//.test(type)) {
        await api('PUT', `/api/v1/branding/profiles/${encodeURIComponent(id)}/logo`, { raw: Buffer.from(await img.arrayBuffer()), headers: { 'Content-Type': type } });
      }
    } else {
      await api('DELETE', `/api/v1/branding/profiles/${encodeURIComponent(id)}/logo`).catch(() => {});
    }
    await db.update('companies', { id: eq(company.id) }, { roofquery_brand_profile_id: id, roofquery_brand_hash: hash });
    company.roofquery_brand_profile_id = id; company.roofquery_brand_hash = hash;
    return id;
  } catch (e) {
    console.error('[roofquery] brand profile not updated for', company.id, e.code || '', e.message);
    return company.roofquery_brand_profile_id || null;
  }
}
