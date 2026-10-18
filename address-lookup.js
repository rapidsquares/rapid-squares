// Rapid Squares — address lookup + aerial view (Azure Maps)
//
// Flow: type an address → suggestions from Azure Maps Autocomplete →
// pick one (or press Look up) → Azure Maps Geocoding gives the coordinates →
// the Azure Maps Web SDK shows satellite imagery centred on the roof.
//
// APIs used (Search 2026-01-01, Web SDK v3):
//   GET https://atlas.microsoft.com/geocode:autocomplete
//   GET https://atlas.microsoft.com/geocode
//   https://atlas.microsoft.com/sdk/javascript/mapcontrol/3/atlas.min.js
(function () {
  var cfg = window.RS_CONFIG || {};
  // The key comes from the server's AZURE_MAPS_KEY setting when it has one, otherwise from config.js.
  var rt = window.RS_RUNTIME || {};
  var KEY = (rt.azureMapsKey || cfg.azureMapsKey || '').trim();
  var COUNTRY = cfg.countryRegion || 'US';
  var ZOOM = cfg.propertyZoom || 19;
  var API = 'https://atlas.microsoft.com';
  var API_VERSION = '2026-01-01';
  var SDK_CSS = 'https://atlas.microsoft.com/sdk/javascript/mapcontrol/3/atlas.min.css';
  var SDK_JS = 'https://atlas.microsoft.com/sdk/javascript/mapcontrol/3/atlas.min.js';
  // Search area as lon1,lat1,lon2,lat2. Autocomplete needs a bbox or a point to rank results, and
  // Geocoding with a free-text query only accepts bbox/coordinates/view/top (not countryRegion).
  // US box covers all 50 states incl. Alaska and Hawaii; other countries fall back to the whole world.
  var SEARCH_BBOX = COUNTRY === 'US' ? '-179.9,18.5,-66.5,71.5' : '-180,-85,180,85';

  var $ = function (id) { return document.getElementById(id); };
  var form = $('lookup-form'), input = $('addr'), list = $('suggestions'), status = $('lookup-status');
  var mapEl = $('map'), mapEmpty = $('map-empty');
  var selected = null, suggestions = [], active = -1, debounce = null, reqId = 0;
  var map = null, marker = null, sdkPromise = null;

  if (!KEY) $('key-missing').classList.remove('hidden');
  if (location.protocol === 'file:') {
    var warn = $('key-missing');
    warn.querySelector('span').innerHTML = '<b>Open the site with start-windows.bat.</b> This page was opened directly as a file, and browsers block map lookups from files.';
    warn.classList.remove('hidden');
  }

  // ---------- Azure Maps REST ----------
  function azure(path, params) {
    var q = new URLSearchParams(Object.assign({ 'api-version': API_VERSION, 'subscription-key': KEY }, params));
    var url = API + path + '?' + q.toString();
    return fetch(url).catch(function (e) {
      // The request never got an answer: blocked by the browser (CORS), an ad blocker, a firewall, or offline.
      var err = new Error('network'); err.kind = 'network'; err.path = path; err.cause = e;
      console.error('[Rapid Squares] Azure Maps request failed before a response:', path, e);
      throw err;
    }).then(function (res) {
      if (res.ok) return res.json();
      return res.text().then(function (text) {
        var code = '', detail = '';
        try { var j = JSON.parse(text); code = (j.error && j.error.code) || ''; detail = (j.error && j.error.message) || ''; } catch (_) { detail = text.slice(0, 200); }
        var err = new Error('http');
        err.kind = (res.status === 401 || res.status === 403) ? 'auth' : 'http';
        err.status = res.status; err.code = code; err.detail = detail; err.path = path;
        console.error('[Rapid Squares] Azure Maps error', res.status, path, code, detail);
        throw err;
      });
    });
  }
  function toPlace(f) {
    var a = (f.properties && f.properties.address) || {};
    var coords = f.geometry && f.geometry.coordinates;
    var line1 = a.addressLine || (f.properties && f.properties.name) || a.formattedAddress || '';
    var rest = (a.formattedAddress || '').replace(line1, '').replace(/^[,\s]+/, '');
    return {
      label: a.formattedAddress || line1,
      line1: line1,
      line2: rest,
      lon: coords ? coords[0] : null,
      lat: coords ? coords[1] : null,
      confidence: f.properties && f.properties.confidence
    };
  }
  function geocode(query, top) {
    // Only query + bbox/coordinates/view/top are allowed alongside a free-text query.
    return azure('/geocode', { query: query, top: top || 5, bbox: SEARCH_BBOX })
      .then(function (data) { return (data.features || []).map(toPlace).filter(function (p) { return p.lat != null; }); });
  }
  var autoParams = { countryRegion: COUNTRY, resultTypeGroups: 'Address' };
  function autocomplete(query) {
    var base = { query: query, top: 5, bbox: SEARCH_BBOX };
    return azure('/geocode:autocomplete', Object.assign({}, base, autoParams)).catch(function (err) {
      // If Azure rejects the optional filters, drop them for the rest of the session and retry once.
      if (err && err.status === 400 && Object.keys(autoParams).length) {
        console.warn('[Rapid Squares] Autocomplete rejected optional filters; retrying without them.', err.detail);
        autoParams = {};
        return azure('/geocode:autocomplete', base);
      }
      throw err;
    }).then(function (data) { return (data.features || []).map(toPlace).filter(function (p) { return p.label; }); });
  }

  // ---------- Status + errors ----------
  function say(msg, isError) {
    status.textContent = msg;
    status.classList.toggle('error', !!isError);
  }
  function explain(err) {
    err = err || {};
    var info = (err.code && String(err.code).indexOf(String(err.status)) === 0) ? err.code : [err.status, err.code].filter(Boolean).join(' ');
    if (err.kind === 'auth') {
      return 'Azure Maps rejected the key (' + info + '). Check that azureMapsKey in config.js is the full Primary Key from your Azure Maps account, with no extra spaces.' + (err.detail ? ' Azure said: “' + err.detail + '”' : '');
    }
    if (err.kind === 'http') {
      if (err.status === 429) return 'Azure Maps is limiting requests right now (429). Wait a moment and try again.';
      return 'Azure Maps returned an error (' + info + ')' + (err.detail ? ': “' + err.detail + '”' : '.') ;
    }
    if (location.protocol === 'file:') {
      return 'The page was opened as a file, so the browser blocked the request. Start the site with start-windows.bat and try again.';
    }
    return 'Your browser couldn’t get a response from Azure Maps. If your Azure Maps account has CORS rules, add ' + location.origin + ' to them. Ad blockers or a work network can also block atlas.microsoft.com.';
  }
  function needKey() {
    if (KEY) return false;
    say('Add your Azure Maps key to config.js to look up addresses.', true);
    return true;
  }

  // ---------- Suggestions (accessible combobox) ----------
  function renderSuggestions(items) {
    suggestions = items; active = -1;
    list.innerHTML = '';
    items.forEach(function (p, i) {
      var li = document.createElement('li');
      li.id = 'sugg-' + i; li.setAttribute('role', 'option'); li.setAttribute('aria-selected', 'false');
      var b = document.createElement('b'); b.textContent = p.line1;
      var s = document.createElement('span'); s.textContent = p.line2;
      li.appendChild(b); li.appendChild(s);
      li.addEventListener('mousedown', function (e) { e.preventDefault(); choose(p); });
      list.appendChild(li);
    });
    var open = items.length > 0;
    list.classList.toggle('hidden', !open);
    input.setAttribute('aria-expanded', open ? 'true' : 'false');
    input.removeAttribute('aria-activedescendant');
  }
  function closeSuggestions() { renderSuggestions([]); }
  function highlight(i) {
    var items = list.querySelectorAll('li');
    if (!items.length) return;
    active = (i + items.length) % items.length;
    items.forEach(function (li, j) { li.setAttribute('aria-selected', j === active ? 'true' : 'false'); });
    input.setAttribute('aria-activedescendant', items[active].id);
    items[active].scrollIntoView({ block: 'nearest' });
  }

  input.addEventListener('input', function () {
    clearTimeout(debounce);
    var q = input.value.trim();
    if (q.length < 3) { closeSuggestions(); say('Type at least 3 characters to see suggestions.'); return; }
    if (!KEY) { closeSuggestions(); needKey(); return; }
    debounce = setTimeout(function () {
      var id = ++reqId;
      autocomplete(q).then(function (items) {
        if (id !== reqId) return;               // a newer keystroke won
        renderSuggestions(items);
        say(items.length ? items.length + ' suggestion' + (items.length > 1 ? 's' : '') + '. Use the arrow keys to choose.' : 'No matches yet — keep typing or press Look up.');
      }).catch(function (err) { if (id === reqId) { closeSuggestions(); say(explain(err), true); } });
    }, 250);
  });
  input.addEventListener('keydown', function (e) {
    var open = !list.classList.contains('hidden');
    if (e.key === 'ArrowDown' && open) { e.preventDefault(); highlight(active + 1); }
    else if (e.key === 'ArrowUp' && open) { e.preventDefault(); highlight(active - 1); }
    else if (e.key === 'Escape') { closeSuggestions(); }
    else if (e.key === 'Enter' && open && active >= 0) { e.preventDefault(); choose(suggestions[active]); }
  });
  var blurTimer = null;
  input.addEventListener('blur', function (e) {
    // Moving to the Look up button or into the list isn't "leaving" the search box.
    var to = e.relatedTarget;
    if (to && (form.contains(to) || list.contains(to))) return;
    blurTimer = setTimeout(closeSuggestions, 120);
  });

  // Stop any pending/in-flight suggestion request so it can't overwrite results.
  function cancelSuggestions() { clearTimeout(debounce); clearTimeout(blurTimer); reqId++; }

  form.addEventListener('submit', function (e) {
    e.preventDefault();
    cancelSuggestions();
    var q = input.value.trim();
    if (!q) { say('Enter an address to look up.', true); input.focus(); return; }
    if (needKey()) return;
    closeSuggestions();
    say('Looking up “' + q + '”…');
    geocode(q, 5).then(function (places) {
      if (!places.length) { say('No address found for “' + q + '”. Check the spelling or add the city and state.', true); return; }
      if (places.length > 1 && places[0].confidence !== 'High') {
        clearTimeout(blurTimer);
        renderSuggestions(places);
        input.focus();
        say('Several matches — pick the right one.');
        return;
      }
      show(places[0]);
    }).catch(function (err) { say(explain(err), true); });
  });

  // ---------- Choosing a place ----------
  function choose(p) {
    cancelSuggestions();
    closeSuggestions();
    input.value = p.label;
    if (p.lat != null) { show(p); return; }
    // Autocomplete results don't always include coordinates — geocode the full address.
    say('Finding the roof for ' + p.label + '…');
    geocode(p.label, 1).then(function (places) {
      if (!places.length) { say('Couldn’t place that address on the map.', true); return; }
      places[0].line1 = p.line1; places[0].line2 = p.line2;
      show(places[0]);
    }).catch(function (err) { say(explain(err), true); });
  }

  function show(p) {
    selected = p;
    $('sel-empty').classList.add('hidden');
    $('sel-details').classList.remove('hidden');
    $('sel-line1').textContent = p.line1 || p.label;
    $('sel-line2').textContent = p.line2 || '';
    $('sel-lat').textContent = p.lat.toFixed(6);
    $('sel-lon').textContent = p.lon.toFixed(6);
    $('sel-conf').textContent = p.confidence ? p.confidence + ' confidence' : '—';
    $('order-msg').classList.add('hidden');
    say('Showing aerial view of ' + p.label + '.');
    showOnMap(p).catch(function () { say('Found the address, but the aerial view couldn’t load.', true); });
  }

  // ---------- Azure Maps Web SDK ----------
  function loadSdk() {
    if (window.atlas) return Promise.resolve(window.atlas);
    if (sdkPromise) return sdkPromise;
    sdkPromise = new Promise(function (resolve, reject) {
      var css = document.createElement('link'); css.rel = 'stylesheet'; css.href = SDK_CSS; document.head.appendChild(css);
      var js = document.createElement('script'); js.src = SDK_JS;
      js.onload = function () { window.atlas ? resolve(window.atlas) : reject(new Error('sdk')); };
      js.onerror = function () { sdkPromise = null; reject(new Error('sdk')); };
      document.head.appendChild(js);
    });
    return sdkPromise;
  }

  function showOnMap(p) {
    return loadSdk().then(function (atlas) {
      mapEmpty.classList.add('hidden');
      var pos = [p.lon, p.lat];
      if (!map) {
        map = new atlas.Map(mapEl, {
          center: pos, zoom: ZOOM, style: 'satellite', language: 'en-US', view: 'Auto',
          showFeedbackLink: false,
          authOptions: { authType: 'subscriptionKey', subscriptionKey: KEY }
        });
        map.events.add('ready', function () {
          map.controls.add([
            new atlas.control.ZoomControl(),
            new atlas.control.StyleControl({ mapStyles: ['satellite', 'satellite_road_labels', 'road'] })
          ], { position: 'top-right' });
          marker = new atlas.HtmlMarker({ position: pos, color: '#B03A0A' });
          map.markers.add(marker);
        });
      } else {
        map.setCamera({ center: pos, zoom: ZOOM, type: 'fly', duration: 900 });
        if (marker) marker.setOptions({ position: pos });
      }
    });
  }

  $('recenter-btn').addEventListener('click', function () {
    if (map && selected) map.setCamera({ center: [selected.lon, selected.lat], zoom: ZOOM, type: 'ease', duration: 500 });
  });
  // ---------- Ordering: pick a report type in a pop-up, then place the order ----------
  var dlg = $('order-dialog'), catalog = null, preselect = null;
  function money(c) { return '$' + (c / 100).toFixed(2); }
  // What this company pays for a product right now (server re-checks everything).
  function priceFor(p) {
    if (!catalog) return 0;
    if (p.id === 'premium_residential' && catalog.free_reports_remaining > 0) return 0;
    return catalog.subscribed ? p.subscriber_price_cents : p.price_cents;
  }
  function loadCatalog() {
    if (catalog) return Promise.resolve(catalog);
    return RS.api.get(RS.guest ? '/api/public/products' : '/api/products').then(function (r) { catalog = r; return r; });
  }
  function el(tag, cls, text) { var n = document.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = text; return n; }

  // Extra details shown in each report's drop-down (Certified has none until it's available).
  var DETAILS = {
    premium_residential: ['Full report with PDF and full sketch', 'Delivery in under 2 hours'],
    commercial: []
  };
  function renderOptions() {
    var box = $('od-options'); box.innerHTML = '';
    var firstOpen = null;
    catalog.products.forEach(function (p) {
      var card = el('div', 'opt-card' + (p.available ? '' : ' off'));
      var row = el('label', 'opt');
      var input = document.createElement('input');
      input.type = 'radio'; input.name = 'report_type'; input.value = p.id; input.disabled = !p.available;
      if (p.available && !firstOpen) firstOpen = input;
      var main = el('span', 'opt-main'), top = el('span', 'opt-top'), name = el('b', null, p.label);
      var free = p.id === 'premium_residential' && catalog.free_reports_remaining > 0 && p.available;
      if (!p.available) name.appendChild(el('span', 'opt-tag', 'Coming soon'));
      else if (free) name.appendChild(el('span', 'opt-tag free', catalog.free_reports_remaining + ' free left'));
      var price = el('span', 'opt-price');
      var now = el('span', 'opt-now');
      if (free) { now.appendChild(el('s', null, money(catalog.subscribed ? p.subscriber_price_cents : p.price_cents))); now.appendChild(document.createTextNode('Free')); }
      else now.textContent = money(priceFor(p));
      price.appendChild(now);
      // Subscribers see only their price; everyone else also sees what a subscription would cost.
      if (!catalog.subscribed) price.appendChild(el('span', 'opt-sub', money(p.subscriber_price_cents) + ' with subscription'));
      top.appendChild(name); top.appendChild(price);
      main.appendChild(top);
      if (!p.available) main.appendChild(el('span', 'hint', 'Not available to order yet'));
      else if (p.id === 'premium_residential') main.appendChild(el('span', 'hint', 'Delivered in under 2 hours'));
      row.appendChild(input); row.appendChild(main);
      card.appendChild(row);

      if (p.available && DETAILS[p.id]) {
        var id = 'opt-more-' + p.id;
        var btn = el('button', 'opt-more');
        btn.type = 'button'; btn.setAttribute('aria-expanded', 'false'); btn.setAttribute('aria-controls', id);
        btn.innerHTML = '<span>More info</span><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 9l6 6 6-6"/></svg>';
        var panel = el('div', 'opt-details'); panel.id = id; panel.hidden = true;
        var ul = el('ul');
        DETAILS[p.id].forEach(function (t) { ul.appendChild(el('li', null, t)); });
        if (ul.children.length) panel.appendChild(ul);
        else panel.appendChild(el('p', 'hint', 'More details coming soon.'));
        btn.addEventListener('click', function () {
          var open = btn.getAttribute('aria-expanded') !== 'true';
          btn.setAttribute('aria-expanded', open ? 'true' : 'false');
          btn.firstChild.textContent = open ? 'Less info' : 'More info';
          panel.hidden = !open;
        });
        card.appendChild(btn); card.appendChild(panel);
      }
      box.appendChild(card);
    });
    if (firstOpen) {
      var want = preselect && preselect.report_type;
      var pref = (want && box.querySelector('input[value="' + want + '"]:not([disabled])')) || box.querySelector('input[value="premium_residential"]:not([disabled])');
      (pref || firstOpen).checked = true;
    }
    if (catalog.signup_free_reports != null) $('od-free-n').textContent = catalog.signup_free_reports;
    $('od-esx-price').textContent = money(catalog.esx_price_cents);
    updateTotal();
    if (preselect && preselect.esx && !$('od-esx').disabled) { $('od-esx').checked = true; updateTotal(); }
    preselect = null;
  }
  function current() {
    var r = dlg.querySelector('input[name="report_type"]:checked');
    return r && catalog ? catalog.products.filter(function (p) { return p.id === r.value; })[0] : null;
  }
  function updateTotal() {
    var p = current(), esx = $('od-esx'), row = $('od-esx-row');
    var allowed = !!(p && p.esx_addon_allowed);
    esx.disabled = !allowed; if (!allowed) esx.checked = false;
    row.classList.toggle('off', !allowed);
    var usesFree = !!(p && p.id === 'premium_residential' && catalog.free_reports_remaining > 0);
    var total = !p || usesFree ? 0 : priceFor(p) + (esx.checked ? catalog.esx_price_cents : 0);
    $('od-total').textContent = p ? money(total) : '—';
    $('od-submit').disabled = !p;
    var note = '';
    if (usesFree) note = 'Uses 1 of your free reports' + (esx.checked ? ', ESX file included.' : '.');
    else if (p && total > 0) note = RS.guest ? 'You’ll pay when you place the order.' : 'Charged to the card on file when you place the order.';
    $('od-note').textContent = note;
  }
  function closeDialog() { if (dlg.open) dlg.close(); }

  $('order-btn').addEventListener('click', function () {
    if (!selected) return;
    if (!window.RS || !RS.api) { var m0 = $('order-msg'); m0.textContent = 'Ordering isn’t available on this page.'; m0.classList.remove('hidden'); return; }
    $('od-address').textContent = selected.label;
    $('od-error').classList.add('hidden');
    if (!preselect) $('od-esx').checked = false;
    $('od-guest').classList.toggle('hidden', !RS.guest);
    $('od-submit').textContent = RS.guest ? 'Place guest order' : 'Place order';
    dlg.showModal();
    loadCatalog().then(renderOptions).catch(function (err) {
      $('od-options').innerHTML = '';
      $('od-error').textContent = (err && err.message) || 'Couldn’t load the report types. Try again.';
      $('od-error').classList.remove('hidden');
    });
  });
  $('od-options').addEventListener('change', updateTotal);
  $('od-esx').addEventListener('change', updateTotal);
  $('od-close').addEventListener('click', closeDialog);
  $('od-cancel').addEventListener('click', closeDialog);
  dlg.addEventListener('click', function (e) { if (e.target === dlg) closeDialog(); }); // click on the dimmed backdrop

  $('order-form').addEventListener('submit', function (e) {
    e.preventDefault();
    var p = current(); if (!p || !selected) return;
    var btn = $('od-submit'), err = $('od-error'), place = selected, esx = $('od-esx').checked;
    if (RS.guest) { placeGuestOrder(p, esx); return; }
    btn.disabled = true; btn.setAttribute('aria-busy', 'true'); err.classList.add('hidden');
    RS.api.post('/api/orders', { address: place.label, lat: place.lat, lon: place.lon, report_type: p.id, esx: esx })
      .then(function (r) {
        if (r.checkout_url) { location.href = r.checkout_url; return; }
        catalog = null; // free-report count may have changed
        closeDialog();
        var o = r.order, m = $('order-msg');
        var paid = r.used_free_report ? 'Used 1 free report.' : (r.charged_cents ? money(r.charged_cents) + ' charged to the card on file.' : '');
        m.classList.remove('hidden', 'error');
        m.innerHTML = '';
        m.appendChild(document.createTextNode('Ordered ' + o.report_number + ' · ' + o.product_label + (o.esx_purchased ? ' + ESX' : '') + ' for ' + place.label + '. ' + paid + ' '));
        var a = document.createElement('a'); a.href = 'orders.html'; a.textContent = 'Track it in Order history';
        m.appendChild(a);
      })
      .catch(function (x) {
        err.textContent = (x && x.message) || 'The order didn’t go through. Try again.';
        err.classList.remove('hidden');
      })
      .then(function () { btn.disabled = false; btn.setAttribute('aria-busy', 'false'); });
  });

  // ---------- visitors without an account ----------
  function placeGuestOrder(p, esx) {
    var btn = $('od-submit'), err = $('od-error'), place = selected;
    var name = $('og-name').value.trim(), email = $('og-email').value.trim();
    if (!name) { err.textContent = 'Enter your name.'; err.classList.remove('hidden'); $('og-name').focus(); return; }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { err.textContent = 'Enter the email address where we should send the report.'; err.classList.remove('hidden'); $('og-email').focus(); return; }
    btn.disabled = true; btn.setAttribute('aria-busy', 'true'); err.classList.add('hidden');
    RS.api.post('/api/guest-orders', { address: place.label, lat: place.lat, lon: place.lon, report_type: p.id, esx: esx, name: name, email: email, phone: $('og-phone').value.trim() })
      .then(function (r) {
        if (r.checkout_url) { location.href = r.checkout_url; return; }
        closeDialog();
        var o = r.order, m = $('order-msg');
        m.classList.remove('hidden', 'error');
        m.innerHTML = '';
        m.appendChild(document.createTextNode('Order ' + o.report_number + ' received · ' + o.product_label + (o.esx_purchased ? ' + ESX' : '') + ' for ' + place.label + ' · ' + money(o.price_cents) + '. We’ll email the report to ' + r.email + '. '));
        var a = document.createElement('a'); a.href = 'signin.html?step=signup&next=new-sketch.html'; a.textContent = 'Create a free account to track orders';
        m.appendChild(a);
      })
      .catch(function (x) { err.textContent = (x && x.message) || 'The order didn’t go through. Try again.'; err.classList.remove('hidden'); })
      .then(function () { btn.disabled = false; btn.setAttribute('aria-busy', 'false'); });
  }

  // "Sign in" / "Create a free account" from the pop-up: remember the order, then come back to it.
  var PENDING = 'rs.pendingOrder';
  function savePending() {
    var p = current();
    try { localStorage.setItem(PENDING, JSON.stringify({ place: selected, report_type: p ? p.id : null, esx: $('od-esx').checked, at: Date.now() })); } catch (_) { /* storage blocked */ }
  }
  $('od-signin').addEventListener('click', function (e) { e.preventDefault(); savePending(); location.href = 'signin.html?next=' + encodeURIComponent('new-sketch.html?resume=1'); });
  $('od-signup').addEventListener('click', function (e) { e.preventDefault(); savePending(); location.href = 'signin.html?step=signup&next=' + encodeURIComponent('new-sketch.html?resume=1'); });

  function resumePending() {
    var saved = null;
    try { saved = JSON.parse(localStorage.getItem(PENDING)); localStorage.removeItem(PENDING); } catch (_) { /* nothing saved */ }
    if (!saved || !saved.place || Date.now() - saved.at > 2 * 3600 * 1000) return;
    input.value = saved.place.label;
    show(saved.place);
    preselect = saved;
    $('od-esx').checked = false;
    $('order-btn').click();
  }
  if (/[?&]resume=1/.test(location.search) && !RS.guest) document.addEventListener('rs:ready', resumePending, { once: true });

  // Prefill from ?address=… (e.g. links from other pages)
  var pre = new URLSearchParams(location.search).get('address');
  if (pre) { input.value = pre; if (KEY) form.requestSubmit(); }
})();
