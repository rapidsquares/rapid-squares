// Rapid Squares — order a report, step by step: address and report type → confirm the roof → review and place.
//
// Address: type an address → suggestions from Google Places (places.js) → pick one for its exact
// location (Enter without picking takes the best match).
// Roof: satellite imagery from the Azure Maps Web SDK v3 (atlas.min.js), with a pin that can be
// dragged onto the right roof.
(function () {
  var cfg = window.RS_CONFIG || {};
  // The map key comes from the server's AZURE_MAPS_KEY setting when it has one, otherwise from config.js.
  var rt = window.RS_RUNTIME || {};
  var KEY = (rt.azureMapsKey || cfg.azureMapsKey || '').trim();
  var ZOOM = cfg.propertyZoom || 19;
  var SDK_CSS = 'https://atlas.microsoft.com/sdk/javascript/mapcontrol/3/atlas.min.css';
  var SDK_JS = 'https://atlas.microsoft.com/sdk/javascript/mapcontrol/3/atlas.min.js';

  var $ = function (id) { return document.getElementById(id); };
  var form = $('lookup-form'), input = $('addr'), list = $('suggestions'), status = $('lookup-status');
  var mapEl = $('map'), mapEmpty = $('map-empty');
  var step = 'report';
  var selected = null, suggestions = [], active = -1, debounce = null, reqId = 0;
  var map = null, marker = null, sdkPromise = null;

  if (!KEY || !RS.places.available) {
    var missing = $('key-missing');
    missing.querySelector('span').innerHTML = !RS.places.available
      ? '<b>Address search isn\u2019t connected yet.</b> Set <code>GOOGLE_MAPS_KEY</code> on the server (or <code>googleMapsKey</code> in <code>config.js</code>) for address suggestions.'
      : '<b>The aerial map isn\u2019t connected yet.</b> Set <code>AZURE_MAPS_KEY</code> on the server (or <code>azureMapsKey</code> in <code>config.js</code>) to show the roof from above.';
    missing.classList.remove('hidden');
  }
  if (location.protocol === 'file:') {
    var warn = $('key-missing');
    warn.querySelector('span').innerHTML = '<b>Open the site with start-windows.bat.</b> This page was opened directly as a file, and browsers block map lookups from files.';
    warn.classList.remove('hidden');
  }

  // Where to rank suggestions around ([lon, lat]): the device's location when the browser has already
  // been allowed to share it, otherwise the company's most recent order. Without either, the whole country.
  var near = null, nearFromDevice = false;
  function findNear() {
    try {
      if (navigator.permissions && navigator.geolocation) navigator.permissions.query({ name: 'geolocation' }).then(function (p) {
        if (p.state === 'granted') navigator.geolocation.getCurrentPosition(function (pos) { near = [pos.coords.longitude, pos.coords.latitude]; nearFromDevice = true; }, function () {}, { maximumAge: 3600000, timeout: 8000 });
      }).catch(function () {});
    } catch (_) { /* not supported */ }
    if (window.RS && RS.api && !RS.guest) RS.api.get('/api/orders?page=1&page_size=1').then(function (r) {
      var o = r && r.orders && r.orders[0];
      if (!nearFromDevice && o && o.lat != null && o.lon != null) near = [o.lon, o.lat];
    }).catch(function () { /* fall back to the whole country */ });
  }
  if (window.RS && RS.me) findNear(); else document.addEventListener('rs:ready', findNear, { once: true });

  // ---------- Status + errors ----------
  function say(msg, isError) {
    status.textContent = msg;
    status.classList.toggle('error', !!isError);
  }
  function needKey() {
    if (RS.places.available) return false;
    say('Address search needs the Google key (GOOGLE_MAPS_KEY).', true);
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
    if (!RS.places.available) { closeSuggestions(); needKey(); return; }
    debounce = setTimeout(function () {
      var id = ++reqId;
      // Suggestions come from Google Places when it's set up, otherwise Azure (places.js).
      RS.places.suggest(q, { near: near }).then(function (items) {
        if (id !== reqId) return;               // a newer keystroke won
        renderSuggestions(items);
        say(items.length ? items.length + ' suggestion' + (items.length > 1 ? 's' : '') + '. Pick one, or use the arrow keys.' : 'No matches yet. Keep typing, or press Enter to search.');
      }).catch(function (err) { if (id === reqId) { closeSuggestions(); say(suggestError(err), true); } });
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
    // Enter without picking: take Google's best match for what was typed.
    say('Looking up \u201c' + q + '\u201d\u2026');
    RS.places.suggest(q, { near: near }).then(function (items) {
      if (!items.length) { say('No address found for \u201c' + q + '\u201d. Check the spelling or add the city and state.', true); return; }
      choose(items[0]);
    }).catch(function (err) { say(suggestError(err), true); });
  });

  function suggestError(err) {
    if (err && err.kind === 'auth') return 'Google rejected the address-suggestion key' + (err.message ? ': \u201c' + err.message + '\u201d' : '.') + ' Check GOOGLE_MAPS_KEY and the key\u2019s website restrictions in Google Cloud.';
    return (err && err.message) || 'Address suggestions aren\u2019t working right now. Type the full address and press Enter.';
  }

  // ---------- Choosing a place ----------
  function choose(p) {
    cancelSuggestions();
    closeSuggestions();
    input.value = p.label;
    say('Finding ' + p.label + '\u2026');
    // Google suggestions carry an id: one more call gives the exact location and address parts.
    RS.places.details(p).then(function (place) {
      if (!place) { say('Couldn\u2019t find that address on the map. Try another suggestion.', true); return; }
      input.value = place.label; show(place);
    }).catch(function (err) { say(suggestError(err), true); });
  }

  function show(p) {
    selected = p;
    p.found = { lat: p.lat, lon: p.lon }; // where the address lookup put it; the pin can be moved from here
    input.value = p.label;
    say(''); // the address in the box is the confirmation
    if (marker) marker.setOptions({ position: [p.lon, p.lat] });
    if (map) map.setCamera({ center: [p.lon, p.lat], zoom: ZOOM });
    showPin();
    refresh();
    if (step === 'report') nextBtn.focus(); // both chosen: Continue is next
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

  // The map is made the first time the roof step opens (it needs to be visible to size itself).
  function showOnMap(p) {
    if (!KEY) { mapEmpty.querySelector('b').textContent = 'The aerial view needs an Azure Maps key in config.js.'; return Promise.resolve(); }
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
          // The pin marks the roof to measure. Drag it, or click the roof, if the address lands in the wrong spot.
          marker = new atlas.HtmlMarker({ position: [selected.lon, selected.lat], color: '#B03A0A', draggable: true });
          map.markers.add(marker);
          map.events.add('dragend', marker, function () { var c = marker.getOptions().position; movePin(c[1], c[0]); });
          map.events.add('click', function (e) { if (e.position) { marker.setOptions({ position: e.position }); movePin(e.position[1], e.position[0]); } });
        });
      } else {
        map.resize();
        map.setCamera({ center: pos, zoom: ZOOM });
        if (marker) marker.setOptions({ position: pos });
      }
    }).catch(function () { mapEmpty.classList.remove('hidden'); mapEmpty.querySelector('b').textContent = 'The aerial view couldn’t load. You can still continue.'; });
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
  }
  function moved() { var p = selected; return !!(p && p.found && (p.lat !== p.found.lat || p.lon !== p.found.lon)); }
  function showPin() {
    var p = selected; if (!p) return;
    var far = moved() ? metersBetween(p.found, p) : 0;
    $('pin-moved').classList.toggle('hidden', !moved());
    $('pin-reset').classList.toggle('hidden', !moved());
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
  });

  // ---------- Steps ----------
  var STEPS = ['report', 'location', 'review'];
  var TITLES = { report: 'New order', location: 'Confirm the roof', review: 'Review and place order', done: 'Order placed' };
  var wiz = $('wiz'), nextBtn = $('wiz-next'), backBtn = $('wiz-back');
  function goTo(to) {
    if ((to === 'location' || to === 'review') && !(current() && selected)) to = 'report';
    step = to;
    wiz.querySelectorAll('[data-panel]').forEach(function (p) { p.classList.toggle('hidden', p.getAttribute('data-panel') !== to); });
    var at = STEPS.indexOf(to);
    wiz.querySelectorAll('.wiz-steps li').forEach(function (li, i) {
      li.classList.toggle('done', to === 'done' || i < at);
      if (i === at) li.setAttribute('aria-current', 'step'); else li.removeAttribute('aria-current');
    });
    var storm = isStorm();
    $('wiz-title').textContent = to === 'location' && storm ? 'Confirm the property' : TITLES[to];
    wiz.querySelector('.wiz-foot').classList.toggle('hidden', to === 'done');
    if (to === 'report' && !catalog) loadCatalog().then(renderOptions).catch(catalogFailed);
    if (to === 'location') { $('loc-what').textContent = storm ? 'property' : 'roof'; showOnMap(selected); }
    if (to === 'review') fillReview();
    wiz.querySelector('.wiz-body').scrollTop = 0;
    refresh();
  }
  // Footer buttons follow the step: what "Continue" says, and whether it can be pressed yet.
  function refresh() {
    backBtn.classList.toggle('invisible', step === 'report');
    var p = current();
    if (step === 'report') { nextBtn.textContent = !selected ? 'Pick the address' : !p ? 'Choose a report' : 'Continue'; nextBtn.disabled = !p || !selected; }
    else if (step === 'location') { nextBtn.textContent = isStorm() ? 'This is the property' : 'This is the roof'; nextBtn.disabled = false; }
    else if (step === 'review') {
      var t = total();
      nextBtn.textContent = RS.guest ? (t ? 'Pay ' + money(t) : 'Place guest order') : (t ? 'Place order · ' + money(t) : 'Place order');
      nextBtn.disabled = !p || busyNow;
    }
  }
  nextBtn.addEventListener('click', function () {
    if (step === 'report') goTo('location');
    else if (step === 'location') goTo('review');
    else if (step === 'review') placeOrder();
  });
  backBtn.addEventListener('click', function () { var i = STEPS.indexOf(step); if (i > 0) goTo(STEPS[i - 1]); });
  wiz.querySelectorAll('[data-goto]').forEach(function (b) { b.addEventListener('click', function () { goTo(b.getAttribute('data-goto')); }); });
  // Inside the pop-up on Home, the close button and Escape close the pop-up.
  function closePopup() { if (window.parent !== window) window.parent.postMessage({ type: 'rs:close' }, location.origin); }
  if (RS.embed) {
    $('wiz-close').classList.remove('hidden');
    $('wiz-close').addEventListener('click', closePopup);
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && list.classList.contains('hidden')) closePopup(); });
  }

  // ---------- Report types ----------
  var catalog = null, preselect = null, busyNow = false;
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
  function catalogFailed(err) {
    $('od-options').innerHTML = '';
    var e = el('p', 'form-error', (err && err.message) || 'Couldn’t load the report types. Try again.');
    $('od-options').appendChild(e);
  }
  function el(tag, cls, text) { var n = document.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = text; return n; }

  // One line under each report's name.
  var BLURB = {
    storm_report: 'Hail, wind and tornado history for the last 5 years. 5 PDFs, ready in seconds.',
    certified_residential: 'Certified roof squares and pitch. About 30 minutes.',
    premium_residential: 'Full measurement report with the roof sketch. Under 2 hours.',
    commercial: 'Every building on the property measured.'
  };
  var ORDER = ['storm_report', 'certified_residential', 'premium_residential', 'commercial'];
  function renderOptions() {
    var box = $('od-options'), had = current(); box.innerHTML = '';
    // Ones that can be ordered first; "Coming soon" ones last.
    var list = catalog.products.slice().sort(function (a, b) { return (b.available - a.available) || (ORDER.indexOf(a.id) - ORDER.indexOf(b.id)); });
    list.forEach(function (p) {
      var card = el('label', 'opt-card opt' + (p.available ? '' : ' off'));
      var radio = document.createElement('input');
      radio.type = 'radio'; radio.name = 'report_type'; radio.value = p.id; radio.disabled = !p.available;
      var main = el('span', 'opt-main'), top = el('span', 'opt-top'), name = el('b', null, p.label);
      var free = p.id === 'premium_residential' && catalog.free_reports_remaining > 0 && p.available;
      if (!p.available) name.appendChild(el('span', 'opt-tag', 'Coming soon'));
      else if (free) name.appendChild(el('span', 'opt-tag free', catalog.free_reports_remaining + ' free left'));
      var price = el('span', 'opt-price'), now = el('span', 'opt-now');
      if (free) { now.appendChild(el('s', null, money(catalog.subscribed ? p.subscriber_price_cents : p.price_cents))); now.appendChild(document.createTextNode('Free')); }
      else now.textContent = money(priceFor(p));
      price.appendChild(now);
      // Subscribers see only their price; everyone else also sees what a subscription would cost.
      if (!catalog.subscribed && !free) price.appendChild(el('span', 'opt-sub', money(p.subscriber_price_cents) + ' with subscription'));
      top.appendChild(name); top.appendChild(price);
      main.appendChild(top);
      main.appendChild(el('span', 'hint', p.available ? (BLURB[p.id] || '') : 'Not available to order yet'));
      card.appendChild(radio); card.appendChild(main);
      box.appendChild(card);
    });
    var want = (preselect && preselect.report_type) || (had && had.id);
    var pick = want && box.querySelector('input[value="' + want + '"]:not([disabled])');
    if (pick) pick.checked = true;
    // Free trial: shown to visitors (as a reason to sign up) and to companies that haven't used theirs.
    var days = catalog.trial_days || 0;
    $('od-trial-n').textContent = days; $('od-trial-days').textContent = days;
    $('od-trial-clause').classList.toggle('hidden', !days);
    $('od-trial').classList.toggle('hidden', !(days && catalog.trial_eligible && !catalog.subscribed && !RS.guest));
    $('od-esx-price').textContent = money(catalog.esx_price_cents);
    if (preselect && preselect.esx) $('od-esx').checked = true;
    preselect = null;
    updateEsx();
  }
  function current() {
    var r = wiz.querySelector('input[name="report_type"]:checked');
    return r && catalog ? catalog.products.filter(function (p) { return p.id === r.value; })[0] : null;
  }
  function isStorm() { var p = current(); return !!(p && p.id === 'storm_report'); }
  function updateEsx() {
    var p = current(), esx = $('od-esx'), allowed = !!(p && p.esx_addon_allowed);
    esx.disabled = !allowed; if (!allowed) esx.checked = false;
    $('od-esx-row').classList.toggle('hidden', !allowed);
    updateScope();
    refresh();
  }
  // What to measure (roof reports only). Each report type has its own starting choice until one is picked.
  var SCOPE_LABEL = { primary_only: 'Main building only', primary_and_garage: 'Main building + detached garage', all_structures: 'Every building on the property' };
  var scopePicked = false, scopeFor = null;
  function scopeDefault(p) { return p.id === 'commercial' ? 'all_structures' : 'primary_and_garage'; }
  function updateScope() {
    var p = current(), roof = !!(p && p.id !== 'storm_report');
    $('scope-opts').classList.toggle('hidden', !roof);
    if (!roof || (scopePicked && scopeFor)) { scopeFor = p && p.id; return; }
    var r = wiz.querySelector('input[name="scope"][value="' + scopeDefault(p) + '"]');
    if (r) r.checked = true;
    scopeFor = p.id;
  }
  function scope() { var p = current(), r = wiz.querySelector('input[name="scope"]:checked'); return p && p.id !== 'storm_report' && r ? r.value : null; }
  wiz.querySelectorAll('input[name="scope"]').forEach(function (r) { r.addEventListener('change', function () { scopePicked = true; }); });
  function usesFree() { var p = current(); return !!(p && p.id === 'premium_residential' && catalog.free_reports_remaining > 0); }
  function total() {
    var p = current();
    return !p || usesFree() ? 0 : priceFor(p) + ($('od-esx').checked ? catalog.esx_price_cents : 0);
  }
  $('od-options').addEventListener('change', updateEsx);
  $('od-esx').addEventListener('change', refresh);

  // ---------- Review ----------
  function fillReview() {
    var p = current(), t = total();
    $('rv-line1').textContent = selected.line1 || selected.label;
    $('rv-line2').textContent = selected.line2 || '';
    $('rv-pin').classList.toggle('hidden', !moved());
    $('rv-report').textContent = p.label + ($('od-esx').checked ? ' + ESX file' : '');
    $('rv-report-hint').textContent = BLURB[p.id] || '';
    $('rv-scope-row').classList.toggle('hidden', !scope());
    $('rv-scope').textContent = SCOPE_LABEL[scope()] || '';
    $('od-guest').classList.toggle('hidden', !RS.guest);
    // Job details: printed on roof reports; for a Storm Report they fill in the PDF details.
    // Notes for the measuring team are only for roof reports; a Storm Report has no measuring.
    var storm = isStorm();
    $('job-hint').textContent = storm ? 'Printed on the storm PDFs. You can change them when you download each PDF.'
      : 'Added to the report and the ESX file. The claim number also names the ESX file.';
    $('notes-group').classList.toggle('hidden', storm);
    $('od-total').textContent = money(t);
    var note = '';
    if (usesFree()) note = 'Uses 1 of your free reports' + ($('od-esx').checked ? ', ESX file included.' : '.');
    else if (t > 0) note = RS.guest ? 'You’ll pay on Stripe’s secure page next.' : (catalog.has_card === false ? 'You’ll add your card on Stripe’s secure page; it’s saved for next time.' : 'Charged to the card on file when you place the order.');
    $('od-note').textContent = note;
    $('od-error').classList.add('hidden');
  }
  function showError(msg, field) {
    var err = $('od-error'); err.textContent = msg; err.classList.remove('hidden');
    if (field) $(field).focus(); else err.scrollIntoView({ block: 'nearest' });
  }

  // ---------- Placing the order ----------
  function placeOrder() {
    var p = current(); if (!p || !selected || busyNow) return;
    if (!window.RS || !RS.api) { showError('Ordering isn’t available on this page.'); return; }
    var place = selected, esx = $('od-esx').checked;
    var body = { address: place.label, parts: place.parts, lat: place.lat, lon: place.lon, report_type: p.id, esx: esx, scope: scope() || undefined,
      job: { claim: $('jb-claim').value.trim(), client_name: $('jb-name').value.trim(), client_email: $('jb-email').value.trim(), client_phone: $('jb-phone').value.trim(), notes: isStorm() ? '' : $('jb-notes').value.trim() } };
    if (body.job.client_email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(body.job.client_email)) { showError('Check the client email, or leave it blank.', 'jb-email'); return; }
    if (RS.guest) {
      body.name = $('og-name').value.trim(); body.email = $('og-email').value.trim(); body.phone = $('og-phone').value.trim();
      if (!body.name) { showError('Enter your name.', 'og-name'); return; }
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(body.email)) { showError('Enter the email address where we should send the report.', 'og-email'); return; }
    }
    busyNow = true; nextBtn.setAttribute('aria-busy', 'true'); $('od-error').classList.add('hidden'); refresh();
    nextBtn.textContent = isStorm() ? 'Getting the storm history…' : 'Placing order…';
    RS.api.post(RS.guest ? '/api/guest-orders' : '/api/orders', body)
      .then(function (r) {
        if (r.checkout_url) { goToPayment(r.checkout_url); return; }
        catalog = null; // free-report count may have changed
        var o = r.order, label = o.product_label + (o.esx_purchased ? ' + ESX' : '');
        if (RS.embed && window.parent !== window) { window.parent.postMessage({ type: 'rs:ordered', report_number: o.report_number, label: label + ' for ' + place.label, ready: o.status === 'delivered' }, location.origin); }
        done(o, r, label, place);
      })
      .catch(function (x) { showError((x && x.message) || 'The order didn’t go through. Try again.'); })
      .then(function () { busyNow = false; nextBtn.setAttribute('aria-busy', 'false'); refresh(); });
  }
  function done(o, r, label, place) {
    var ready = o.status === 'delivered';
    $('done-title').textContent = ready ? 'Your storm report is ready' : RS.guest ? 'Order received' : 'Order placed';
    var paid = r.used_free_report ? ' Used 1 free report.' : (r.charged_cents ? ' ' + money(r.charged_cents) + ' charged to the card on file.' : '');
    $('done-text').textContent = o.report_number + ' · ' + label + ' for ' + place.label + '.' + (RS.guest ? ' We’ll email the report to ' + r.email + '.' : paid);
    var acts = $('done-actions'); acts.innerHTML = '';
    function link(text, href, cls) { var a = el('a', 'btn' + (cls ? ' ' + cls : ''), text); a.href = href; a.target = '_top'; acts.appendChild(a); }
    if (RS.guest) link('Create a free account to track orders', 'signin.html?step=signup&next=orders.html', 'btn-primary');
    else if (ready) link('View storm report', 'storm-report.html?id=' + encodeURIComponent(o.id), 'btn-primary');
    else if (RS.embed) { var close = el('button', 'btn btn-primary', 'Done'); close.type = 'button'; close.addEventListener('click', closePopup); acts.appendChild(close); }
    else link('Track it on Home', 'orders.html', 'btn-primary');
    var again = el('button', 'btn', 'Order another'); again.type = 'button';
    again.addEventListener('click', function () { location.replace(location.pathname + (RS.embed ? '?embed=1' : '')); });
    acts.appendChild(again);
    goTo('done');
  }

  // Stripe's payment page can't open inside the Home order pop-up, so leave the whole page.
  function goToPayment(url) {
    nextBtn.textContent = 'Opening secure payment…';
    try { (RS.embed && window.top !== window ? window.top : window).location.href = url; } catch (_) { location.href = url; }
  }
  // Back from Stripe after a guest payment.
  (function () {
    var q = new URLSearchParams(location.search);
    if (!q.get('paid') && !q.get('unpaid')) return;
    var text = q.get('paid') ? 'Payment received for ' + q.get('paid') + '. We’ll email your report when it’s ready.' : 'Payment wasn’t finished, so ' + q.get('unpaid') + ' wasn’t placed.';
    if (RS.ui) RS.ui.toast(text, { error: !!q.get('unpaid') }); else say(text, !!q.get('unpaid'));
    history.replaceState(null, '', location.pathname);
  })();

  // "Sign in" / "Create a free account" from the review step: remember the order, then come back to it.
  var PENDING = 'rs.pendingOrder';
  function savePending() {
    var p = current();
    try { localStorage.setItem(PENDING, JSON.stringify({ place: selected, report_type: p ? p.id : null, esx: $('od-esx').checked, at: Date.now() })); } catch (_) { /* storage blocked */ }
  }
  $('od-signin').addEventListener('click', function (e) { e.preventDefault(); savePending(); location.href = 'signin.html?next=' + encodeURIComponent('order.html?resume=1'); });
  $('od-signup').addEventListener('click', function (e) { e.preventDefault(); savePending(); location.href = 'signin.html?step=signup&next=' + encodeURIComponent('order.html?resume=1'); });

  function resumePending() {
    var saved = null;
    try { saved = JSON.parse(localStorage.getItem(PENDING)); localStorage.removeItem(PENDING); } catch (_) { /* nothing saved */ }
    if (!saved || !saved.place || Date.now() - saved.at > 2 * 3600 * 1000) return;
    input.value = saved.place.label;
    preselect = saved;
    step = 'resume'; // don't auto-advance from show()
    show(saved.place);
    loadCatalog().then(function () { renderOptions(); goTo(current() ? 'review' : 'report'); }).catch(function () { goTo('report'); });
  }
  if (/[?&]resume=1/.test(location.search) && !RS.guest) document.addEventListener('rs:ready', resumePending, { once: true });

  goTo('report');
  // Prefill from the landing page search: ?address=… (and &place=… when a Google suggestion was picked)
  var qs = new URLSearchParams(location.search), pre = qs.get('address'), preId = qs.get('place');
  if (pre && preId) { input.value = pre; choose({ label: pre, placeId: preId }); }
  else if (pre) { input.value = pre; if (RS.places.available) form.requestSubmit(); }
})();
