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
      confidence: f.properties && f.properties.confidence,
      // Address pieces RoofQuery needs to place the order.
      parts: {
        street: a.addressLine || '',
        city: a.locality || '',
        state: (a.adminDistricts && a.adminDistricts[0] && (a.adminDistricts[0].shortName || a.adminDistricts[0].name)) || '',
        postalCode: a.postalCode || '',
        country: (a.countryRegion && a.countryRegion.ISO) || ''
      }
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
    }, 200);
  });
  // Typed before this script was ready (slow first load)? Show suggestions for it now.
  if (input.value.trim().length >= 3 && document.activeElement === input && !new URLSearchParams(location.search).get('address')) input.dispatchEvent(new Event('input'));
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
    p.found = { lat: p.lat, lon: p.lon }; // where the address lookup put it; the pin can be moved from here
    $('sel-empty').classList.add('hidden');
    $('sel-details').classList.remove('hidden');
    $('order-bar').classList.remove('hidden');
    $('ob-line1').textContent = p.line1 || p.label;
    $('ob-line2').textContent = p.line2 || '';
    $('sel-line1').textContent = p.line1 || p.label;
    $('sel-line2').textContent = p.line2 || '';
    $('sel-lat').textContent = p.lat.toFixed(6);
    $('sel-lon').textContent = p.lon.toFixed(6);
    $('sel-conf').textContent = p.confidence ? p.confidence + ' confidence' : '—';
    showPin();
    iqReset();
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
      $('pin-tip').classList.remove('hidden');
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
          // The pin marks the roof to measure. Drag it, or click the roof, if the address lands in the wrong spot.
          marker = new atlas.HtmlMarker({ position: [selected.lon, selected.lat], color: '#B03A0A', draggable: true });
          map.markers.add(marker);
          map.events.add('dragend', marker, function () { var c = marker.getOptions().position; movePin(c[1], c[0]); });
          map.events.add('click', function (e) { if (e.position) { marker.setOptions({ position: e.position }); movePin(e.position[1], e.position[0]); } });
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

  // ---------- The pin: the report is ordered for wherever it sits ----------
  function metersBetween(a, b) {
    var R = 6371000, r = Math.PI / 180, dLat = (b.lat - a.lat) * r, dLon = (b.lon - a.lon) * r;
    var h = Math.sin(dLat / 2) * Math.sin(dLat / 2) + Math.cos(a.lat * r) * Math.cos(b.lat * r) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
    return 2 * R * Math.asin(Math.sqrt(h));
  }
  function movePin(lat, lon) {
    if (!selected) return;
    selected.lat = Math.round(lat * 1e7) / 1e7; selected.lon = Math.round(lon * 1e7) / 1e7;
    showPin();
    iqStale();
    say('Pin moved. The report will be ordered for the roof under the pin.');
  }
  function showPin() {
    var p = selected; if (!p) return;
    $('sel-lat').textContent = p.lat.toFixed(6);
    $('sel-lon').textContent = p.lon.toFixed(6);
    var moved = p.found && (p.lat !== p.found.lat || p.lon !== p.found.lon);
    var far = moved ? metersBetween(p.found, p) : 0;
    $('pin-moved').classList.toggle('hidden', !moved);
    $('pin-reset').classList.toggle('hidden', !moved);
    $('ob-pin').classList.toggle('hidden', !moved);
    var warn = $('pin-warn');
    warn.classList.toggle('hidden', far <= 150);
    if (far > 150) warn.textContent = 'The pin is ' + (far >= 1000 ? (far / 1609.34).toFixed(1) + ' mi' : Math.round(far * 3.281) + ' ft') + ' from the address. Make sure it’s on the right roof.';
  }
  $('pin-reset').addEventListener('click', function () {
    if (!selected || !selected.found) return;
    selected.lat = selected.found.lat; selected.lon = selected.found.lon;
    if (marker) marker.setOptions({ position: [selected.lon, selected.lat] });
    if (map) map.setCamera({ center: [selected.lon, selected.lat], type: 'ease', duration: 400 });
    showPin();
    iqStale();
    say('Pin back on the address.');
  });
  // ---------- Ordering: pick a report type in a pop-up, then place the order ----------
  var dlg = $('order-dialog'), catalog = null, preselect = null;
  function money(c) { return '$' + (c / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }
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
    // Free trial: shown to visitors (as a reason to sign up) and to companies that haven't used theirs.
    var days = catalog.trial_days || 0;
    $('od-trial-n').textContent = days; $('od-trial-days').textContent = days;
    $('od-trial-clause').classList.toggle('hidden', !days);
    $('od-trial').classList.toggle('hidden', !(days && catalog.trial_eligible && !catalog.subscribed && !RS.guest));
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
    else if (p && total > 0) note = RS.guest ? 'You’ll pay on Stripe’s secure page when you place the order.' : (catalog.has_card === false ? 'You’ll add your card on Stripe’s secure page; it’s saved for next time.' : 'Charged to the card on file when you place the order.');
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
    RS.api.post('/api/orders', { address: place.label, parts: place.parts, lat: place.lat, lon: place.lon, report_type: p.id, esx: esx })
      .then(function (r) {
        if (r.checkout_url) { goToPayment(r.checkout_url); return; }
        catalog = null; // free-report count may have changed
        closeDialog();
        var o = r.order, m = $('order-msg');
        if (RS.embed && window.parent !== window) { window.parent.postMessage({ type: 'rs:ordered', report_number: o.report_number, label: o.product_label + (o.esx_purchased ? ' + ESX' : '') + ' for ' + place.label }, location.origin); return; }
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

  // Stripe's payment page can't open inside the Order history pop-up, so leave the whole page.
  function goToPayment(url) {
    var btn = $('od-submit'); btn.textContent = 'Opening secure payment\u2026';
    try { (RS.embed && window.top !== window ? window.top : window).location.href = url; } catch (_) { location.href = url; }
  }
  // Back from Stripe after a guest payment.
  (function () {
    var q = new URLSearchParams(location.search);
    if (!q.get('paid') && !q.get('unpaid')) return;
    var text = q.get('paid') ? 'Payment received for ' + q.get('paid') + '. We\u2019ll email your report when it\u2019s ready.' : 'Payment wasn\u2019t finished, so ' + q.get('unpaid') + ' wasn\u2019t placed.';
    if (RS.ui) RS.ui.toast(text, { error: !!q.get('unpaid') }); else say(text, !!q.get('unpaid'));
    history.replaceState(null, '', location.pathname);
  })();

  // ---------- visitors without an account ----------
  function placeGuestOrder(p, esx) {
    var btn = $('od-submit'), err = $('od-error'), place = selected;
    var name = $('og-name').value.trim(), email = $('og-email').value.trim();
    if (!name) { err.textContent = 'Enter your name.'; err.classList.remove('hidden'); $('og-name').focus(); return; }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { err.textContent = 'Enter the email address where we should send the report.'; err.classList.remove('hidden'); $('og-email').focus(); return; }
    btn.disabled = true; btn.setAttribute('aria-busy', 'true'); err.classList.add('hidden');
    RS.api.post('/api/guest-orders', { address: place.label, parts: place.parts, lat: place.lat, lon: place.lon, report_type: p.id, esx: esx, name: name, email: email, phone: $('og-phone').value.trim() })
      .then(function (r) {
        if (r.checkout_url) { goToPayment(r.checkout_url); return; }
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

  // ---------- Instant Squares (RoofQuery Instant Query): subscribers only ----------
  var iq = { mode: 'off', result: null, at: null, source: null }; // mode: off (guest) · locked · on
  var iqBtn = $('iq-btn'), iqPanel = $('iq-panel');
  function iqInit() {
    if (RS.guest || !RS.api) return;
    loadCatalog().then(function (c) {
      iq.mode = c.subscribed ? 'on' : 'locked';
      iqBtn.classList.remove('hidden');
      iqBtn.classList.toggle('iq-locked', iq.mode === 'locked');
      $('iq-btn-text').textContent = iq.mode === 'on' ? 'Instant Squares' : 'Instant Squares \u00b7 Subscribers';
    }).catch(function () { /* the button simply stays hidden */ });
  }
  if (window.RS && RS.me) iqInit(); else document.addEventListener('rs:ready', iqInit, { once: true });

  function iqEl(tag, cls, text) { var n = document.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = text; return n; }
  function iqReset() { iq.result = null; iqPanel.classList.add('hidden'); iqPanel.innerHTML = ''; iqDraw(null); }
  function iqStale() {
    if (!iq.result || iqPanel.classList.contains('hidden')) return;
    var note = iqPanel.querySelector('.iq-stale');
    if (!note) {
      note = iqEl('p', 'iq-stale'); note.appendChild(document.createTextNode('You moved the pin. '));
      var again = iqEl('button', 'linkbtn', 'Update the estimate'); again.type = 'button'; again.addEventListener('click', iqRun);
      note.appendChild(again); iqPanel.insertBefore(note, iqPanel.children[1] || null);
    }
  }
  function iqUpsell() {
    iqPanel.innerHTML = '';
    var head = iqEl('div', 'iq-head'); var h = iqEl('h2', null, 'Instant Squares'); h.id = 'iq-h'; head.appendChild(h); head.appendChild(iqEl('span', 'iq-tag', 'Subscribers'));
    iqPanel.appendChild(head);
    iqPanel.appendChild(iqEl('p', 'hint', 'See roof area, pitch and 5 years of storm history in seconds, before you order. Included with a subscription.'));
    var foot = iqEl('div', 'iq-foot');
    var days = catalog && catalog.trial_eligible && catalog.trial_days;
    var a = iqEl('a', 'btn btn-primary', days ? 'Start your ' + days + '-day free trial' : 'See subscription plans');
    a.href = 'account.html#billing'; a.target = '_top';
    foot.appendChild(a); iqPanel.appendChild(foot);
    iqPanel.classList.remove('hidden');
  }
  function iqRun() {
    if (!selected) return;
    if (iq.mode === 'locked') { iqUpsell(); return; }
    var at = { lat: selected.lat, lon: selected.lon };
    iqBtn.disabled = true; iqBtn.setAttribute('aria-busy', 'true');
    iqPanel.innerHTML = ''; iqPanel.appendChild(iqEl('p', 'hint', 'Measuring the roofs from above\u2026 this takes a few seconds.'));
    iqPanel.classList.remove('hidden');
    RS.api.post('/api/instant-query', at).then(function (r) {
      if (!selected || selected.lat !== at.lat || selected.lon !== at.lon) return; // the pin moved meanwhile
      iq.result = r; iqRender(r); iqDraw(r);
    }).catch(function (e) {
      if (e && e.code === 'subscribers_only') { iq.mode = 'locked'; iqInit(); iqUpsell(); return; }
      iqPanel.innerHTML = ''; var p = iqEl('p', 'form-error', (e && e.message) || 'Instant Squares didn\u2019t work. Try again.'); iqPanel.appendChild(p);
    }).then(function () { iqBtn.disabled = false; iqBtn.setAttribute('aria-busy', 'false'); });
  }
  iqBtn.addEventListener('click', iqRun);

  function fmtDay(d) { try { return new Date(d + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }); } catch (_) { return d; } }
  var DIST = { at_property: 'at the property', within_1_mi: 'within 1 mile', within_3_mi: 'within 3 miles', within_5_mi: 'within 5 miles' };
  function stat(label, value) { var d = iqEl('div', 'iq-stat'); d.appendChild(iqEl('span', 'hint', label)); d.appendChild(iqEl('b', null, value)); return d; }
  function iqRender(r) {
    iqPanel.innerHTML = '';
    var bs = r.buildings || [], main = bs.filter(function (b) { return b.primary; })[0] || bs[0];
    var head = iqEl('div', 'iq-head'); var h = iqEl('h2', null, 'Instant Squares'); h.id = 'iq-h'; head.appendChild(h);
    if (main && main.confidence) head.appendChild(iqEl('span', 'iq-tag ' + main.confidence, main.confidence.charAt(0).toUpperCase() + main.confidence.slice(1) + ' confidence'));
    if (r.sandbox) head.appendChild(iqEl('span', 'iq-tag', 'Sample data'));
    iqPanel.appendChild(head);
    if (!main) { iqPanel.appendChild(iqEl('p', 'hint', 'No buildings were found at the pin. Move the pin onto the roof and try again.')); return; }
    var stats = iqEl('div', 'iq-stats');
    stats.appendChild(stat('Main roof', main.squares != null ? main.squares.toFixed(1) + ' squares' : '\u2014'));
    stats.appendChild(stat('Pitch', main.pitch || 'Unknown'));
    stats.appendChild(stat('Footprint', main.flat_sqft != null ? Math.round(main.flat_sqft).toLocaleString('en-US') + ' sq ft' : '\u2014'));
    if (bs.length > 1) stats.appendChild(stat('All ' + bs.length + ' buildings', r.total_squares.toFixed(1) + ' squares'));
    iqPanel.appendChild(stats);
    if (main.confidence === 'low') iqPanel.appendChild(iqEl('p', 'hint', 'Low confidence: treat these numbers as a rough guide.'));
    if (bs.length > 1) {
      var ul = iqEl('ul', 'iq-list');
      bs.forEach(function (b, i) {
        var li = iqEl('li');
        li.appendChild(iqEl('span', null, 'Building ' + (i + 1) + (b.primary ? ' (main)' : '')));
        li.appendChild(iqEl('span', 'hint', [b.squares != null ? b.squares.toFixed(1) + ' squares' : null, b.pitch, b.confidence ? b.confidence + ' confidence' : null].filter(Boolean).join(' \u00b7 ')));
        ul.appendChild(li);
      });
      iqPanel.appendChild(ul);
    }
    // Storm history
    var s = r.storm || {}, box = iqEl('div', 'iq-storm'), h3 = iqEl('h3', null, 'Storm history \u00b7 last ' + ((s.period && s.period.years) || 5) + ' years');
    if (s.damage_chance) h3.appendChild(iqEl('span', 'iq-tag ' + (s.damage_chance === 'high' ? 'low' : s.damage_chance === 'medium' ? 'medium' : 'high'), s.damage_chance.charAt(0).toUpperCase() + s.damage_chance.slice(1) + ' damage chance'));
    box.appendChild(h3);
    if (s.status === 'none') box.appendChild(iqEl('p', 'hint', 'No storms recorded within 5 miles in the last 5 years.'));
    else if (s.status !== 'ok') box.appendChild(iqEl('p', 'hint', 'Storm history isn\u2019t available right now.'));
    else {
      var lines = iqEl('ul');
      var hl = s.hail && s.hail.largest;
      if (hl) lines.appendChild(iqEl('li', null, 'Largest hail: ' + hl.size_in + '\u2033' + (hl.size_name ? ' (' + hl.size_name + ')' : '') + ' on ' + fmtDay(hl.date) + ', ' + (DIST[hl.distance] || hl.distance)));
      if (s.hail && s.hail.days_near) lines.appendChild(iqEl('li', null, 'Hail days at or within 1 mile: ' + s.hail.days_near));
      var w = s.wind && s.wind.strongest;
      if (w) lines.appendChild(iqEl('li', null, 'Strongest wind: ' + w.mph + ' mph on ' + fmtDay(w.date) + ', ' + w.distance_mi + ' mi away'));
      if (s.tornado) lines.appendChild(iqEl('li', null, 'Closest tornado: ' + (s.tornado.ef_scale ? s.tornado.ef_scale + ', ' : '') + s.tornado.closest_mi + ' mi away on ' + fmtDay(s.tornado.date)));
      if (!lines.children.length) lines.appendChild(iqEl('li', null, 'Nothing significant recorded nearby.'));
      box.appendChild(lines);
    }
    iqPanel.appendChild(box);
    var foot = iqEl('div', 'iq-foot');
    foot.appendChild(iqEl('p', 'hint', 'An estimate from aerial outlines, not a measured report. Order a report for exact measurements, the full sketch and the ESX file.'));
    var go = iqEl('button', 'btn btn-primary', 'Order full report'); go.type = 'button';
    go.addEventListener('click', function () { $('order-btn').click(); });
    foot.appendChild(go); iqPanel.appendChild(foot);
  }
  // Building outlines on the map (main roof in orange). Skipped quietly if the map isn't up.
  function iqDraw(r) {
    try {
      if (!map || !window.atlas || !atlas.source) return;
      if (!iq.source) {
        iq.source = new atlas.source.DataSource(); map.sources.add(iq.source);
        var col = ['case', ['get', 'primary'], '#F08A4B', '#FFFFFF'];
        map.layers.add([new atlas.layer.PolygonLayer(iq.source, null, { fillColor: col, fillOpacity: 0.22 }), new atlas.layer.LineLayer(iq.source, null, { strokeColor: col, strokeWidth: 2 })]);
      }
      iq.source.clear();
      if (!r) return;
      (r.buildings || []).forEach(function (b) {
        if (!b.polygon || b.polygon.length < 3) return;
        var ring = b.polygon.map(function (p) { return [p.lng, p.lat]; }); ring.push(ring[0]);
        iq.source.add(new atlas.data.Feature(new atlas.data.Polygon([ring]), { primary: !!b.primary }));
      });
    } catch (e) { console.warn('[Rapid Squares] Couldn\u2019t draw the building outlines.', e); }
  }

  // Prefill from ?address=… (e.g. links from other pages)
  var pre = new URLSearchParams(location.search).get('address');
  if (pre) { input.value = pre; if (KEY) form.requestSubmit(); }
})();
