// Rapid Squares — sample-data mode: the site without the Node.js server.
//
// Opened as plain files (or with start-windows.bat), the pages have no server to talk to.
// This answers the same /api calls the server does (server/src/routes.js), from made-up data
// kept in this browser's localStorage, so every page can be tried and designed without
// Supabase, RoofQuery or Stripe. It follows the server's rules: every request is scoped to the
// signed-in user's company, permissions are checked, and errors come back as
// { error: { code, message } } with the same status codes.
//
// Nothing here is sent anywhere. Through the real server (npm start), api.js never calls it.
(function () {
  window.RS = window.RS || {};
  var STORE_KEY = 'rs.sample.v1';
  var USER_KEY = 'rs.sample.user';
  var DAY = 86400000, MIN = 60000;

  var ALL_PERMS = ['orders.create', 'orders.view_all', 'orders.download', 'branding.edit', 'billing.manage', 'users.manage'];
  var PRODUCTS = {
    certified_residential: { label: 'Certified Residential Rapid Squares', price: 800, subscriber_price: 500, available: false, esx: false, delivery_minutes: 30 },
    premium_residential: { label: 'Premium Residential Report', price: 1200, subscriber_price: 800, available: true, esx: true, delivery_minutes: 120 },
    commercial: { label: 'Commercial Report', price: 3000, subscriber_price: 2500, available: true, esx: true, delivery_minutes: null },
    storm_report: { label: 'Storm Report', price: 500, subscriber_price: 300, available: true, esx: false, delivery_minutes: 0 }
  };
  // What a Storm Report looks like (sample data; a live one comes from RoofQuery).
  var SAMPLE_STORM = {
    headline: 'Sample data: hail was estimated at or within 1 mile of this property on 3 days since 2021, the largest 1.75\u2033 on Jun 11, 2023.',
    damage_chance: 'medium', damage_reason: '1\u2033+ hail fell within 1 mile of the property.', period: { from: '2021-10-20', to: '2026-10-20', years: 5 }, county: 'Sample County', country: 'US',
    storm_days: 21, hail_days: 6, wind_days: 11, tornado_days: 1, hail_days_near: 3,
    largest_hail: { sizeIn: 1.75, sizeName: 'golf ball', date: '2023-06-11', where: 'within_1_mi', confidence: 'high' },
    strongest_wind: { mph: 68, distanceMi: 2.4, source: 'measured_gust', date: '2024-04-02', confidence: 'medium' },
    closest_tornado: { distanceMi: 4.1, date: '2024-04-02', efScale: 'EF1', confidence: 'medium' },
    hail: [
      { date: '2025-05-25', atPropertyIn: 0.75, within1MiIn: 1, within3MiIn: 1.25, within5MiIn: 1.5, confidence: 'high', damageChance: 'medium' },
      { date: '2023-06-11', atPropertyIn: 1.25, within1MiIn: 1.75, within3MiIn: 2, within5MiIn: 2, confidence: 'high', damageChance: 'medium' },
      { date: '2022-04-12', atPropertyIn: null, within1MiIn: 0.75, within3MiIn: 1, within5MiIn: 1.25, confidence: 'medium', damageChance: 'low' }
    ],
    wind: [
      { date: '2024-04-02', within1MiMph: 55, within3MiMph: 68, within5MiMph: 72, tornado: { distanceMi: 4.1, efScale: 'EF1' }, confidence: 'medium', damageChance: 'low' },
      { date: '2023-07-29', within1MiMph: 50, within3MiMph: 61, within5MiMph: 61, confidence: 'medium', damageChance: 'low' }
    ],
    days: [
      { date: '2025-05-25', hazards: ['hail'], confidence: 'high', maxHailIn: 1.5, maxGustMph: 40, evidence: 'Radar estimated 0.75\u2033 hail over the parcel; 1\u2033 within 1 mile.' },
      { date: '2024-04-02', hazards: ['wind', 'tornado'], confidence: 'medium', maxHailIn: null, maxGustMph: 72, evidence: '68 mph gust measured 2.4 mi away; EF1 tornado 4.1 mi away.' },
      { date: '2023-06-11', hazards: ['hail'], confidence: 'high', maxHailIn: 2, maxGustMph: 45, evidence: 'Radar estimated 1.25\u2033 hail over the parcel; 1.75\u2033 ground report within 1 mile.' }
    ],
    has_map: false, nothing_found: false
  };
  var STORM_DOCS = { weather_history: 'Weather History', hail_verification: 'Hail Verification', wind_verification: 'Wind Verification', date_of_loss: 'Date of Loss', homeowner: 'Homeowner Storm Summary' };
  // Optional job details from the order form, same rules as the server.
  var SCOPES = ['primary_only', 'primary_and_garage', 'all_structures'];
  function jobDetails(b, type) {
    var j = (b && b.job) || {}, out = {};
    if (type !== 'storm_report') {
      out.scope = str(b && b.scope) || (type === 'commercial' ? 'all_structures' : 'primary_and_garage');
      if (SCOPES.indexOf(out.scope) === -1) fail(422, 'invalid', 'Choose what to measure: the main building, the main building and garage, or every building.');
    }
    if (str(j.claim)) out.claim = str(j.claim, 64);
    if (str(j.client_name)) out.client_name = str(j.client_name, 120);
    if (str(j.client_email)) { out.client_email = str(j.client_email, 160).toLowerCase(); if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(out.client_email)) fail(422, 'invalid', 'Check the client email, or leave it blank.'); }
    if (str(j.client_phone)) out.client_phone = str(j.client_phone, 32);
    if (str(j.notes)) out.notes = str(j.notes, 450);
    if (type === 'storm_report' && out.client_name) out.insured_name = out.client_name;
    return Object.keys(out).length ? out : null;
  }
  function stormDocs() {
    return Object.keys(STORM_DOCS).map(function (t) { return { template: t, title: STORM_DOCS[t], needs_date_of_loss: t === 'date_of_loss' }; });
  }
  // A PDF's details, asked at download. Same checks as the server: optional, date of loss not in the future.
  function stormDetails(b) {
    var s = b || {}, out = {};
    if (str(s.date_of_loss)) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(str(s.date_of_loss))) fail(422, 'invalid', 'Enter the date of loss as a date, like 2025-05-25.');
      if (new Date(str(s.date_of_loss) + 'T12:00:00Z').getTime() > Date.now() + DAY) fail(422, 'invalid', 'The date of loss can\u2019t be in the future.');
      out.date_of_loss = str(s.date_of_loss);
    }
    if (str(s.claim)) out.claim = str(s.claim, 64);
    if (str(s.insured_name)) out.insured_name = str(s.insured_name, 120);
    if (str(s.notes)) out.notes = str(s.notes, 450);
    return out;
  }
  var ESX_PRICE = 500;

  // ---------- storage (falls back to memory if the browser blocks localStorage) ----------
  var memory = {};
  function storeGet(k) { try { return window.localStorage.getItem(k); } catch (_) { return memory[k] || null; } }
  function storeSet(k, v) { try { window.localStorage.setItem(k, v); } catch (_) { memory[k] = v; } }
  function storeDel(k) { try { window.localStorage.removeItem(k); } catch (_) { delete memory[k]; } }

  function iso(t) { return new Date(t).toISOString(); }
  function uid(prefix) { return prefix + '_' + Math.random().toString(36).slice(2, 10); }

  // ---------- sample data ----------
  function seed() {
    var now = Date.now();
    var company = {
      id: 'co_sample', name: 'Lone Star Roofing Co.', license_number: 'TX-RC-204815',
      contact_name: 'Dana Whitfield', phone: '(512) 555-0142', email: 'estimates@lonestarroofing.example',
      website: 'lonestarroofing.example', address: '2300 Ranch Rd 620 S, Lakeway, TX 78734',
      logo_url: null, brand_color: '#B03A0A', created_at: iso(now - 120 * DAY),
      subscription: { plan: 'monthly', price_cents: 10000, status: 'active', renews_at: iso(now + 12 * DAY) },
      card: { brand: 'Visa', last4: '4242', exp: '08/28' },
      free_reports_remaining: 0, trial_used: true,
      billing_email: 'billing@lonestarroofing.example', billing_address: '2300 Ranch Rd 620 S, Lakeway, TX 78734'
    };
    var users = [
      { id: 'u_owner', company_id: company.id, full_name: 'Dana Whitfield', email: 'dana@lonestarroofing.example', phone: '(512) 555-0142', job_title: 'Owner', avatar_url: null, role: 'owner', preset: 'admin', permissions: ALL_PERMS.slice(), monthly_order_limit: null, office_phone: '(512) 555-0100', preferred_contact: 'Email', timezone: 'Central Time (CT)', created_at: iso(now - 120 * DAY) },
      { id: 'u_marcus', company_id: company.id, full_name: 'Marcus Bell', email: 'marcus@lonestarroofing.example', phone: '(512) 555-0177', job_title: 'Operations Manager', avatar_url: null, role: 'user', preset: 'manager', permissions: ['orders.create', 'orders.view_all', 'orders.download', 'branding.edit'], monthly_order_limit: null, office_phone: '', preferred_contact: 'Text message', timezone: 'Central Time (CT)', created_at: iso(now - 90 * DAY) },
      { id: 'u_priya', company_id: company.id, full_name: 'Priya Nair', email: 'priya@lonestarroofing.example', phone: '(512) 555-0193', job_title: 'Estimator', avatar_url: null, role: 'user', preset: 'estimator', permissions: ['orders.create', 'orders.download'], monthly_order_limit: null, office_phone: '', preferred_contact: 'Email', timezone: 'Central Time (CT)', created_at: iso(now - 60 * DAY) },
      { id: 'u_tom', company_id: company.id, full_name: 'Tom Alvarez', email: 'tom@lonestarroofing.example', phone: '', job_title: 'Sales', avatar_url: null, role: 'user', preset: 'viewer', permissions: ['orders.download'], monthly_order_limit: null, office_phone: '', preferred_contact: 'Phone call', timezone: 'Central Time (CT)', created_at: iso(now - 30 * DAY) }
    ];
    var invites = [
      { id: 'inv_1', company_id: company.id, email: 'jordan@lonestarroofing.example', full_name: 'Jordan Reyes', job_title: 'Estimator', role: 'user', preset: 'estimator', permissions: ['orders.create', 'orders.download'], monthly_order_limit: null, invited_by: 'u_owner', status: 'pending', expires_at: iso(now + 5 * DAY), created_at: iso(now - 2 * DAY) },
      { id: 'inv_2', company_id: company.id, email: 'kim.adjuster@example.com', full_name: '', job_title: '', role: 'user', preset: 'viewer', permissions: ['orders.download'], monthly_order_limit: null, invited_by: 'u_marcus', status: 'pending', expires_at: iso(now + 12 * DAY), created_at: iso(now - 2 * DAY) }
    ];
    function m(sq, pitch, facets) {
      return { total_squares: sq, predominant_pitch: pitch, measurements: { total_area_sqft: Math.round(sq * 100), facets: facets, structures: 1, pitch_breakdown: [{ pitch: pitch, area_sqft: Math.round(sq * 70) }], lengths_ft: { ridge: Math.round(sq * 2.1), hip: Math.round(sq * 3.4), valley: Math.round(sq * 1.2), eave: Math.round(sq * 5.6), rake: Math.round(sq * 1.8) } } };
    }
    var orders = [
      order(1048, 'u_marcus', 'premium_residential', '907 Live Oak Ln, Round Rock, TX 78664', 30.5083, -97.6789, 'pending', now - 8 * MIN, null),
      order(1047, 'u_priya', 'premium_residential', '1418 Brushy Creek Rd, Cedar Park, TX 78613', 30.5121, -97.8076, 'in_progress', now - 40 * MIN, null),
      order(1046, 'u_priya', 'premium_residential', '3305 Hidden Hollow Dr, Austin, TX 78748', 30.1712, -97.8203, 'in_progress', now - 1 * DAY, null),
      order(1045, 'u_marcus', 'commercial', '12100 Metric Blvd, Austin, TX 78758', 30.3955, -97.7166, 'delivered', now - 2 * DAY, m(186.4, '1/12', 4), true),
      order(1044, 'u_owner', 'premium_residential', '615 Mesa Verde Trl, Leander, TX 78641', 30.5788, -97.8531, 'delivered', now - 3 * DAY, m(34.2, '6/12', 14), true),
      order(1043, 'u_priya', 'premium_residential', '2209 Pecan Grove Cv, Georgetown, TX 78626', 30.6332, -97.6772, 'delivered', now - 6 * DAY, m(27.8, '8/12', 11), false),
      order(1042, 'u_priya', 'premium_residential', '48 Canyon Ridge Dr, Dripping Springs, TX 78620', 30.1902, -98.0867, 'failed', now - 9 * DAY, null),
      order(1041, 'u_owner', 'premium_residential', '1730 Barton Hills Dr, Austin, TX 78704', 30.2552, -97.7713, 'delivered', now - 14 * DAY, m(22.6, '5/12', 9), false)
    ];
    function order(n, by, type, address, lat, lon, status, created, meas, esx) {
      var p = PRODUCTS[type];
      var o = {
        id: 'ord_' + n, report_number: 'RS-' + n, company_id: company.id, ordered_by: by, report_type: type,
        address: address, lat: lat, lon: lon, status: status, price_cents: p.subscriber_price + (esx ? ESX_PRICE : 0),
        esx_purchased: !!esx, stripe_payment_id: 'pi_sample_' + n, roofquery_order_id: 'rq_sample_' + n,
        total_squares: null, predominant_pitch: null, measurements: null,
        created_at: iso(created), completed_at: null, simulate: false
      };
      if (meas) { o.total_squares = meas.total_squares; o.predominant_pitch = meas.predominant_pitch; o.measurements = meas.measurements; o.completed_at = iso(created + 95 * MIN); }
      return o;
    }
    return { version: 1, company: company, users: users, invites: invites, orders: orders, next_report: 1049 };
  }

  function load() {
    var raw = storeGet(STORE_KEY), db = null;
    try { db = raw ? JSON.parse(raw) : null; } catch (_) { db = null; }
    if (!db || db.version !== 1) { db = seed(); save(db); }
    return db;
  }
  function save(db) { storeSet(STORE_KEY, JSON.stringify(db)); }

  function currentUserId(db) {
    var id = storeGet(USER_KEY);
    return db.users.some(function (u) { return u.id === id; }) ? id : 'u_owner';
  }

  // ---------- helpers ----------
  function fail(status, code, message) {
    var e = RS.api && RS.api.ApiError ? RS.api.ApiError(status, code, message) : new Error(message);
    e.status = status; e.code = code; throw e;
  }
  function permsOf(u) { return u.role === 'owner' ? ALL_PERMS.slice() : (u.permissions || []).slice(); }
  function need(u, perm) {
    if (permsOf(u).indexOf(perm) === -1) fail(403, 'forbidden', 'You don’t have permission to do that. Ask your company admin.');
  }
  function clone(x) { return JSON.parse(JSON.stringify(x)); }
  function str(v, max) { return String(v == null ? '' : v).trim().slice(0, max || 200); }
  function emailOk(e) { return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e); }
  function startOfMonth() { var d = new Date(); return new Date(d.getFullYear(), d.getMonth(), 1).getTime(); }

  // Orders placed in sample mode move along on their own, like RoofQuery would.
  function advance(db) {
    var now = Date.now(), changed = false;
    db.orders.forEach(function (o) {
      if (!o.simulate) return;
      var age = now - new Date(o.created_at).getTime();
      var target = age > 45000 ? 'delivered' : age > 15000 ? 'in_progress' : 'pending';
      if (target !== o.status && (o.status === 'pending' || o.status === 'in_progress')) {
        o.status = target; changed = true;
        if (target === 'delivered') {
          var sq = Math.round((18 + Math.random() * 24) * 10) / 10;
          o.total_squares = sq; o.predominant_pitch = ['5/12', '6/12', '7/12', '8/12'][Math.floor(Math.random() * 4)];
          o.measurements = { total_area_sqft: Math.round(sq * 100), facets: 6 + Math.floor(Math.random() * 10), structures: 1 };
          o.completed_at = iso(now);
        }
      }
    });
    if (changed) save(db);
  }

  function orderOut(db, o) {
    var p = PRODUCTS[o.report_type] || { label: o.report_type };
    var by = db.users.filter(function (u) { return u.id === o.ordered_by; })[0];
    var out = clone(o); delete out.simulate;
    out.product_label = p.label;
    out.ordered_by_name = by ? by.full_name : 'Former team member';
    out.esx_available = o.status === 'delivered' && !o.esx_purchased && !!p.esx;
    if (o.report_type === 'storm_report' && o.status === 'delivered') out.documents = stormDocs();
    if (o.status === 'pending' || o.status === 'in_progress') {
      var mins = p.delivery_minutes != null ? p.delivery_minutes : 120;
      out.eta = iso(new Date(o.created_at).getTime() + mins * MIN);
    }
    return out;
  }
  function userOut(u) {
    var out = clone(u); out.permissions = permsOf(u); return out;
  }
  function companyOut(c) {
    var out = clone(c); delete out.subscription; delete out.card; delete out.billing_email; delete out.billing_address; return out;
  }

  // ---------- routes ----------
  var routes = [];
  function route(method, pattern, fn) {
    var keys = [];
    var re = new RegExp('^' + pattern.replace(/:(\w+)/g, function (_, k) { keys.push(k); return '([^/]+)'; }) + '$');
    routes.push({ method: method, re: re, keys: keys, fn: fn });
  }

  route('GET', '/api/me', function (c) {
    return { user: userOut(c.me), company: { id: c.db.company.id, name: c.db.company.name }, permissions: permsOf(c.me) };
  });
  route('PATCH', '/api/me', function (c) {
    var b = c.body || {};
    var allowed = ['full_name', 'job_title', 'phone', 'office_phone', 'preferred_contact', 'timezone'];
    if ('full_name' in b && !str(b.full_name)) fail(422, 'invalid', 'Enter your name.');
    allowed.forEach(function (k) { if (k in b) c.me[k] = str(b[k]); });
    save(c.db);
    return { user: userOut(c.me) };
  });
  route('POST', '/api/me/avatar', function (c) {
    if (!c.body || !c.body.file) fail(422, 'no_file', 'Choose a photo to upload.');
    c.me.avatar_url = c.body.file; save(c.db);
    return { avatar_url: c.me.avatar_url };
  });

  route('GET', '/api/company', function (c) { return { company: companyOut(c.db.company) }; });
  route('PATCH', '/api/company', function (c) {
    need(c.me, 'branding.edit');
    var b = c.body || {};
    if ('name' in b && !str(b.name)) fail(422, 'invalid', 'Enter your company name.');
    if ('email' in b && str(b.email) && !emailOk(str(b.email))) fail(422, 'invalid', 'Enter a valid email address, like estimates@yourcompany.com.');
    if (b.brand_color && !/^#[0-9A-Fa-f]{6}$/.test(str(b.brand_color))) fail(422, 'invalid', 'Enter the brand color as a hex code like #0F7A4D.');
    if (b.brand_text_color && !/^#[0-9A-Fa-f]{6}$/.test(str(b.brand_text_color))) fail(422, 'invalid', 'Enter the header text color as a hex code like #FFFFFF.');
    ['name', 'license_number', 'contact_name', 'phone', 'email', 'website', 'address', 'brand_color', 'brand_text_color'].forEach(function (k) { if (k in b) c.db.company[k] = str(b[k]); });
    save(c.db);
    return { company: companyOut(c.db.company) };
  });
  route('DELETE', '/api/company/logo', function (c) {
    need(c.me, 'branding.edit');
    c.db.company.logo_url = null; save(c.db);
    return { logo_url: null };
  });
  route('POST', '/api/company/logo', function (c) {
    need(c.me, 'branding.edit');
    if (!c.body || !c.body.file) fail(422, 'no_file', 'Choose a logo to upload.');
    c.db.company.logo_url = c.body.file; save(c.db);
    return { logo_url: c.db.company.logo_url };
  });

  route('GET', '/api/products', function (c) {
    var co = c.db.company;
    return {
      products: Object.keys(PRODUCTS).map(function (k) { var p = PRODUCTS[k]; return { id: k, label: p.label, price_cents: p.price, subscriber_price_cents: p.subscriber_price, available: p.available, esx_addon_allowed: p.esx, delivery_minutes: p.delivery_minutes }; }),
      esx_price_cents: ESX_PRICE, free_reports_remaining: co.free_reports_remaining, subscribed: !!(co.subscription && co.subscription.status === 'active'),
      trial_days: 30, trial_eligible: !co.trial_used && !(co.subscription && co.subscription.status === 'active')
    };
  });

  // ---------- no account needed ----------
  route('GET', '/api/public/products', function () {
    return {
      products: Object.keys(PRODUCTS).map(function (k) { var p = PRODUCTS[k]; return { id: k, label: p.label, price_cents: p.price, subscriber_price_cents: p.subscriber_price, available: p.available, esx_addon_allowed: p.esx, delivery_minutes: p.delivery_minutes }; }),
      esx_price_cents: ESX_PRICE, free_reports_remaining: 0, subscribed: false, signup_free_reports: 0, trial_days: 30,
      plans: { monthly_cents: 10000, yearly_cents: 100000 }
    };
  });
  route('POST', '/api/guest-orders', function (c) {
    var b = c.body || {};
    var type = b.report_type || 'premium_residential', p = PRODUCTS[type];
    if (!p) fail(422, 'invalid', 'Choose a report type.');
    if (!p.available) fail(422, 'unavailable', p.label + ' isn’t available yet.');
    if (b.esx && !p.esx) fail(422, 'invalid', 'The ESX file isn’t available for ' + p.label + '.');
    if (!str(b.address) || typeof b.lat !== 'number' || typeof b.lon !== 'number') fail(422, 'invalid', 'Look up the property address first.');
    var email = str(b.email).toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) fail(422, 'invalid', 'Enter the email address where we should send the report.');
    if (!str(b.name)) fail(422, 'invalid', 'Enter your name.');
    jobDetails(b, type);
    var n = c.db.next_report++; save(c.db);
    var price = p.price + (b.esx ? ESX_PRICE : 0);
    return { order: { report_number: 'RS-' + n, product_label: p.label, address: str(b.address, 300), price_cents: price, esx_purchased: !!b.esx, status: 'awaiting_payment' }, checkout_url: null, email: email };
  });

  route('GET', '/api/orders', function (c) {
    advance(c.db);
    var q = c.query, mine = permsOf(c.me).indexOf('orders.view_all') === -1;
    var visible = c.db.orders.filter(function (o) { return !mine || o.ordered_by === c.me.id; });
    var counts = { all: visible.length };
    visible.forEach(function (o) { counts[o.status] = (counts[o.status] || 0) + 1; });
    var statuses = q.status ? q.status.split(',') : null;
    var text = (q.q || '').toLowerCase().trim();
    var list = visible.filter(function (o) {
      return (!statuses || statuses.indexOf(o.status) !== -1) &&
        (!text || (o.address + ' ' + o.report_number).toLowerCase().indexOf(text) !== -1);
    }).sort(function (a, b) { return b.created_at < a.created_at ? -1 : 1; });
    var size = Math.min(50, parseInt(q.page_size, 10) || 10), page = Math.max(1, parseInt(q.page, 10) || 1);
    return { orders: list.slice((page - 1) * size, page * size).map(function (o) { return orderOut(c.db, o); }), total: list.length, page: page, page_size: size, counts: counts, scope: mine ? 'mine' : 'company' };
  });
  route('GET', '/api/orders/:id', function (c) {
    advance(c.db);
    var o = findOrder(c);
    return { order: orderOut(c.db, o) };
  });
  route('POST', '/api/orders', function (c) {
    need(c.me, 'orders.create');
    var b = c.body || {};
    var type = b.report_type || 'premium_residential';
    var p = PRODUCTS[type];
    if (!p) fail(422, 'invalid', 'Choose a report type.');
    if (!p.available) fail(422, 'unavailable', p.label + ' isn’t available yet.');
    if (!str(b.address) || typeof b.lat !== 'number' || typeof b.lon !== 'number') fail(422, 'invalid', 'Look up the property address first.');
    var subscribed = c.db.company.subscription && c.db.company.subscription.status === 'active';
    var free = c.db.company.free_reports_remaining > 0 && type === 'premium_residential';
    if (b.esx && !p.esx) fail(422, 'invalid', 'The ESX file isn’t available for ' + p.label + '.');
    var storm = type === 'storm_report', job = jobDetails(b, type);
    // A free report covers the Premium report, including the ESX add-on.
    var price = free ? 0 : (subscribed ? p.subscriber_price : p.price) + (b.esx ? ESX_PRICE : 0);
    if (free) c.db.company.free_reports_remaining -= 1;
    var n = c.db.next_report++;
    var o = {
      id: 'ord_' + n, report_number: 'RS-' + n, company_id: c.db.company.id, ordered_by: c.me.id, report_type: type,
      address: str(b.address, 300), lat: b.lat, lon: b.lon, status: 'pending', price_cents: price, esx_purchased: !!b.esx,
      stripe_payment_id: price ? 'pi_sample_' + n : null, roofquery_order_id: 'rq_sample_' + n,
      total_squares: null, predominant_pitch: null, measurements: null, created_at: iso(Date.now()), completed_at: null, simulate: true,
      order_details: job
    };
    // Storm Reports come back finished straight away.
    if (storm) {
      o.status = 'delivered'; o.simulate = false; o.completed_at = o.created_at;
      o.measurements = { storm: SAMPLE_STORM };
    }
    c.db.orders.push(o); save(c.db);
    // Real backend: charges the saved card (or returns a checkout link) and places the RoofQuery order.
    return { order: orderOut(c.db, o), checkout_url: null, charged_cents: price, used_free_report: free };
  });
  function notYet(what) {
    return function (c) { findOrder(c); need(c.me, 'orders.download'); fail(501, 'not_connected', what + ' will download once RoofQuery is connected. This is sample data.'); };
  }
  route('GET', '/api/orders/:id/pdf', notYet('The PDF report'));
  route('GET', '/api/orders/:id/storm', function (c) {
    advance(c.db);
    var o = findOrder(c);
    if (o.report_type !== 'storm_report') fail(404, 'not_found', 'That isn\u2019t a storm report.');
    return { order: orderOut(c.db, o), storm: (o.measurements && o.measurements.storm) || SAMPLE_STORM, details: o.order_details || {}, can_download: permsOf(c.me).indexOf('orders.download') !== -1, map_url: null };
  });
  route('POST', '/api/orders/:id/storm/:template', function (c) {
    var o = findOrder(c); need(c.me, 'orders.download');
    if (!STORM_DOCS[c.params.template]) fail(404, 'not_found', 'That PDF isn\u2019t part of a storm report.');
    var d = stormDetails(c.body);
    if (c.params.template === 'date_of_loss' && !d.date_of_loss) fail(422, 'needs_date_of_loss', 'Enter the date of loss for this PDF.');
    var keep = {}; Object.keys(o.order_details || {}).forEach(function (k) { if (/^client_/.test(k)) keep[k] = o.order_details[k]; });
    o.order_details = Object.assign(keep, d); save(c.db);
    fail(501, 'not_connected', 'Your details are saved. The ' + STORM_DOCS[c.params.template] + ' PDF will download once RoofQuery is connected. This is sample data.');
  });
  route('GET', '/api/orders/:id/esx', notYet('The Xactimate (ESX) file'));
  // Roof report page (sample): numbers like RoofQuery's sample report, scaled to this order's squares. No drawings.
  route('GET', '/api/orders/:id/report', function (c) {
    advance(c.db);
    var o = findOrder(c);
    if (o.report_type === 'storm_report') fail(404, 'not_found', 'Storm reports have their own page.');
    var out = { order: orderOut(c.db, o), can_download: permsOf(c.me).indexOf('orders.download') !== -1, can_buy_esx: permsOf(c.me).indexOf('orders.create') !== -1, esx_price_cents: o.status === 'delivered' && !o.esx_purchased ? ESX_PRICE : null, report: null, live: false };
    if (o.status !== 'delivered') return out;
    var sq = o.total_squares || 55.97, k = sq / 55.97, f = function (n) { return Math.round(n * k * 10) / 10; };
    var edges = [['eave', 'Eaves', 276.3, 27], ['rake', 'Rakes', 169.2, 13], ['ridge', 'Ridges', 114.6, 12], ['hip', 'Hips', 304.2, 20], ['valley', 'Valleys', 237.3, 17], ['step_flashing', 'Step flashing', 72.8, 9], ['wall_flashing', 'Wall flashing', 55.4, 14], ['parapet', 'Parapet walls', 0, 0], ['bend', 'Bends (pitch changes)', 4.7, 1], ['other', 'Other', 0, 0]]
      .map(function (e) { return { key: e[0], label: e[1], length_ft: f(e[2]), count: e[3] }; });
    var area = Math.round(sq * 1000) / 10, pitch = o.predominant_pitch || '12/12';
    out.report = {
      summary: { squares: sq, area_sqft: area, pitch: pitch, facets: (o.measurements && o.measurements.facets) || 33, structures: 1, complexity: 'complex', attic_sqft: Math.round(area * 0.72), edges_ft: f(1234.6), hips_ridges_ft: f(418.8), edges: edges,
        pitches: [{ pitch: pitch, area_sqft: Math.round(area * 0.93 * 10) / 10, pct: 93 }, { pitch: '5/12', area_sqft: Math.round(area * 0.046 * 10) / 10, pct: 4.6 }, { pitch: '11/12', area_sqft: Math.round(area * 0.024 * 10) / 10, pct: 2.4 }] },
      buildings: [{ index: 1, squares: sq, area_sqft: area, pitch: pitch, facets: 33, complexity: 'complex', hips_ridges_ft: f(418.8), edges: edges }],
      drawings: null, scope_label: 'Primary structure and detached garage', completed_at: o.completed_at, sandbox: true
    };
    return out;
  });
  route('POST', '/api/orders/:id/buy-esx', function (c) {
    need(c.me, 'orders.create'); var o = findOrder(c);
    if (o.status !== 'delivered') fail(409, 'not_ready', 'The ESX file can be bought once the report is ready.');
    o.esx_purchased = true; save(c.db);
    return { purchased: true, url: null, charged_cents: ESX_PRICE };
  });
  function findOrder(c) {
    var mine = permsOf(c.me).indexOf('orders.view_all') === -1;
    var o = c.db.orders.filter(function (x) { return x.id === c.params.id && (!mine || x.ordered_by === c.me.id); })[0];
    if (!o) fail(404, 'not_found', 'That report doesn’t exist, or you don’t have access to it.');
    return o;
  }

  route('GET', '/api/team', function (c) {
    need(c.me, 'users.manage');
    var now = Date.now();
    c.db.invites.forEach(function (i) { if (i.status === 'pending' && new Date(i.expires_at).getTime() < now) i.status = 'expired'; });
    var invites = c.db.invites.filter(function (i) { return i.status === 'pending' || i.status === 'expired'; });
    return { members: c.db.users.map(userOut), invites: clone(invites), counts: { members: c.db.users.length, pending_invites: invites.filter(function (i) { return i.status === 'pending'; }).length } };
  });
  function cleanPerms(list) {
    return (Array.isArray(list) ? list : []).filter(function (p) { return ALL_PERMS.indexOf(p) !== -1; });
  }
  route('POST', '/api/invites', function (c) {
    need(c.me, 'users.manage');
    var b = c.body || {};
    var emails = (Array.isArray(b.emails) ? b.emails : []).map(function (e) { return str(e).toLowerCase(); }).filter(Boolean);
    if (!emails.length) fail(422, 'invalid', 'Enter at least one email address.');
    var bad = emails.filter(function (e) { return !emailOk(e); });
    if (bad.length) fail(422, 'invalid', 'Check ' + (bad.length > 1 ? 'these email addresses: ' : 'this email address: ') + bad.join(', ') + '.');
    var taken = emails.filter(function (e) {
      return c.db.users.some(function (u) { return u.email.toLowerCase() === e; }) || c.db.invites.some(function (i) { return i.status === 'pending' && i.email === e; });
    });
    if (taken.length) fail(409, 'already_invited', taken.join(', ') + (taken.length > 1 ? ' are' : ' is') + ' already on the team or has a pending invite.');
    var perms = cleanPerms(b.permissions);
    if (perms.indexOf('users.manage') !== -1 && c.me.role !== 'owner' && c.me.role !== 'admin') fail(403, 'forbidden', 'Only an owner or admin can invite someone who manages the team.');
    var days = 7; // invitations always expire after 7 days
    var created = emails.map(function (e) {
      var inv = { id: uid('inv'), company_id: c.db.company.id, email: e, full_name: emails.length === 1 ? str(b.full_name) : '', job_title: str(b.job_title),
        role: b.preset === 'admin' ? 'admin' : 'user', preset: str(b.preset, 20) || 'custom', permissions: perms,
        monthly_order_limit: null,
        invited_by: c.me.id, status: 'pending', expires_at: iso(Date.now() + days * DAY), created_at: iso(Date.now()) };
      c.db.invites.push(inv); return clone(inv);
    });
    save(c.db);
    return { invites: created };
  });
  route('POST', '/api/invites/:id/resend', function (c) {
    need(c.me, 'users.manage');
    var inv = findInvite(c);
    inv.status = 'pending'; inv.expires_at = iso(Date.now() + 7 * DAY); save(c.db);
    return { invite: clone(inv) };
  });
  route('DELETE', '/api/invites/:id', function (c) {
    need(c.me, 'users.manage');
    var inv = findInvite(c); inv.status = 'revoked'; save(c.db);
    return { invite: clone(inv) };
  });
  function findInvite(c) {
    var inv = c.db.invites.filter(function (i) { return i.id === c.params.id && i.status !== 'revoked' && i.status !== 'accepted'; })[0];
    if (!inv) fail(404, 'not_found', 'That invite no longer exists.');
    return inv;
  }
  function findMember(c) {
    var u = c.db.users.filter(function (x) { return x.id === c.params.userId; })[0];
    if (!u) fail(404, 'not_found', 'That person isn’t on the team anymore.');
    if (u.role === 'owner') fail(403, 'forbidden', 'The company owner can’t be changed or removed.');
    if (u.id === c.me.id) fail(403, 'forbidden', 'You can’t change your own access. Ask another admin.');
    if (u.role === 'admin' && c.me.role !== 'owner') fail(403, 'forbidden', 'Only the owner can change or remove an admin.');
    return u;
  }
  route('PATCH', '/api/team/:userId', function (c) {
    need(c.me, 'users.manage');
    var u = findMember(c), b = c.body || {};
    if ('permissions' in b) u.permissions = cleanPerms(b.permissions);
    if ('preset' in b) {
      if (b.preset === 'admin' && c.me.role !== 'owner' && c.me.role !== 'admin') fail(403, 'forbidden', 'Only an owner or admin can make someone an admin.');
      u.preset = str(b.preset, 20) || 'custom';
      u.role = b.preset === 'admin' ? 'admin' : 'user';
    }
    u.monthly_order_limit = null;
    if ('job_title' in b) u.job_title = str(b.job_title);
    save(c.db);
    return { member: userOut(u) };
  });
  route('DELETE', '/api/team/:userId', function (c) {
    need(c.me, 'users.manage');
    var u = findMember(c);
    c.db.users = c.db.users.filter(function (x) { return x.id !== u.id; }); save(c.db);
    return { removed: u.id };
  });

  route('GET', '/api/billing', function (c) {
    need(c.me, 'billing.manage');
    var co = c.db.company, start = startOfMonth();
    var month = c.db.orders.filter(function (o) { return new Date(o.created_at).getTime() >= start; });
    var charged = function (o) { return o.price_cents > 0 && o.status !== 'failed' && o.status !== 'cancelled'; };
    var invoices = c.db.orders.filter(charged).map(function (o) {
      return { date: o.created_at, description: (PRODUCTS[o.report_type] || {}).label + (o.esx_purchased ? ' + ESX' : '') + ' · ' + o.report_number, amount_cents: o.price_cents };
    });
    if (co.subscription && co.subscription.status === 'active') {
      var subStart = new Date(co.subscription.renews_at).getTime() - 30 * DAY;
      invoices.push({ date: iso(subStart), description: 'Rapid Squares subscription · monthly', amount_cents: co.subscription.price_cents });
    }
    invoices.sort(function (a, b) { return b.date < a.date ? -1 : 1; });
    return {
      subscription: co.subscription ? clone(co.subscription) : { status: 'none' }, plans: { monthly_cents: 10000, yearly_cents: 100000 },
      trial_days: 30, trial_eligible: !co.trial_used && !(co.subscription && co.subscription.status === 'active'), card: clone(co.card), free_reports_remaining: co.free_reports_remaining,
      reports_this_month: month.filter(charged).length, spend_this_month_cents: month.filter(charged).reduce(function (s, o) { return s + o.price_cents; }, 0),
      billing_email: co.billing_email, billing_address: co.billing_address, invoices: invoices.slice(0, 10)
    };
  });
  route('POST', '/api/billing/portal', function (c) {
    need(c.me, 'billing.manage');
    return { url: null, message: 'Stripe’s billing page will open here once Stripe is connected. This is sample data.' };
  });
  route('POST', '/api/billing/card', function (c) {
    need(c.me, 'billing.manage');
    return { url: null, message: 'Stripe’s secure card page opens here on the live site. This is sample data.' };
  });
  route('POST', '/api/billing/subscribe', function (c) {
    need(c.me, 'billing.manage');
    return { url: null, message: 'Stripe’s subscription checkout opens here on the live site. This is sample data.' };
  });

  // ---------- request entry point (adds a short delay, like a real network call) ----------
  function handle(method, path, body) {
    return new Promise(function (resolve, reject) {
      setTimeout(function () {
        try {
          var parts = path.split('?'), pathname = parts[0], query = {};
          new URLSearchParams(parts[1] || '').forEach(function (v, k) { query[k] = v; });
          var db = load();
          var me = db.users.filter(function (u) { return u.id === currentUserId(db); })[0];
          var isPublic = /^\/api\/(public\/|guest-orders)/.test(pathname);
          if (!me && !isPublic) fail(401, 'unauthorized', 'Sign in to continue.');
          for (var i = 0; i < routes.length; i++) {
            var r = routes[i];
            if (r.method !== method) continue;
            var mm = pathname.match(r.re);
            if (!mm) continue;
            var params = {};
            r.keys.forEach(function (k, j) { params[k] = decodeURIComponent(mm[j + 1]); });
            resolve(clone(r.fn({ db: db, me: me, params: params, query: query, body: body === undefined ? null : clone(body) }) || null));
            return;
          }
          fail(404, 'not_found', 'Unknown request: ' + method + ' ' + pathname);
        } catch (e) { reject(e); }
      }, 120 + Math.random() * 120);
    });
  }

  RS.sample = {
    handle: handle,
    users: function () { return load().users.map(function (u) { return { id: u.id, name: u.full_name, preset: u.preset, role: u.role }; }); },
    currentUserId: function () { return currentUserId(load()); },
    switchUser: function (id) { storeSet(USER_KEY, id); },
    reset: function () { storeDel(STORE_KEY); storeDel(USER_KEY); }
  };
})();
