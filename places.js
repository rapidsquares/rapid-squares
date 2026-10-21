// Address suggestions as you type, for every address box on the site (RS.places), from Google Places
// API (New). The key is GOOGLE_MAPS_KEY on the server (or googleMapsKey in config.js on sample data).
// The map and aerial view are Azure Maps (order-form.js).
//
//   RS.places.suggest(text, { near: [lon, lat] })  → Promise of [{ label, line1, line2, placeId }]
//   RS.places.details(suggestion)                  → Promise of a place: { label, line1, line2, lat, lon, parts, confidence }
(function () {
  'use strict';
  var cfg = window.RS_CONFIG || {}, rt = window.RS_RUNTIME || {};
  var GOOGLE = (rt.googleMapsKey || cfg.googleMapsKey || '').trim();
  var COUNTRY = (cfg.countryRegion || 'US').toUpperCase();
  window.RS = window.RS || {};

  function fail(kind, status, message) { var e = new Error(message || kind); e.kind = kind; e.status = status; return e; }

  // ---------- Google Places API (New) ----------
  // One session token from the first keystroke to the pick, so Google bills the search as one lookup.
  var session = null;
  function token() {
    if (!session) session = window.crypto && crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2);
    return session;
  }
  function google(path, init) {
    return fetch('https://places.googleapis.com/v1/' + path, init).catch(function () {
      throw fail('network', 0, 'Couldn’t reach Google for address suggestions.');
    }).then(function (res) {
      return res.json().catch(function () { return {}; }).then(function (data) {
        if (res.ok) return data;
        var msg = (data.error && data.error.message) || '';
        console.error('[Rapid Squares] Google Places error', res.status, msg);
        throw fail(res.status === 403 || res.status === 401 ? 'auth' : 'http', res.status, msg);
      });
    });
  }
  function googleSuggest(q, near) {
    var body = { input: q, sessionToken: token(), includedRegionCodes: [COUNTRY.toLowerCase()], includedPrimaryTypes: ['street_address', 'premise', 'subpremise'] };
    if (near) body.locationBias = { circle: { center: { latitude: near[1], longitude: near[0] }, radius: 50000 } };
    return google('places:autocomplete', {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Goog-Api-Key': GOOGLE }, body: JSON.stringify(body)
    }).then(function (d) {
      return (d.suggestions || []).map(function (s) {
        var p = s.placePrediction || {}, f = p.structuredFormat || {};
        return { label: (p.text && p.text.text) || '', line1: (f.mainText && f.mainText.text) || '', line2: (f.secondaryText && f.secondaryText.text) || '', placeId: p.placeId };
      }).filter(function (x) { return x.placeId && x.label; });
    });
  }
  function googleDetails(s) {
    var url = 'places/' + encodeURIComponent(s.placeId) + (session ? '?sessionToken=' + encodeURIComponent(session) : '');
    session = null; // the pick ends the session
    return google(url, { headers: { 'X-Goog-Api-Key': GOOGLE, 'X-Goog-FieldMask': 'formattedAddress,location,addressComponents' } }).then(function (d) {
      if (!d.location) return null;
      var by = {};
      (d.addressComponents || []).forEach(function (c) { (c.types || []).forEach(function (t) { if (!by[t]) by[t] = c; }); });
      var short = function (t) { return (by[t] && by[t].shortText) || ''; }, long = function (t) { return (by[t] && by[t].longText) || ''; };
      var street = [short('street_number'), short('route')].filter(Boolean).join(' ');
      var label = (d.formattedAddress || s.label).replace(/, USA$/, '');
      return {
        label: label, line1: street || s.line1 || label, line2: label.replace(street, '').replace(/^[,\s]+/, ''),
        lat: d.location.latitude, lon: d.location.longitude, confidence: 'High',
        // The address pieces RoofQuery needs to place an order.
        parts: { street: street, city: long('locality') || long('postal_town') || long('sublocality'), state: short('administrative_area_level_1'), postalCode: short('postal_code'), country: short('country') }
      };
    });
  }

  RS.places = {
    available: !!GOOGLE,
    suggest: function (q, opts) { return GOOGLE ? googleSuggest(q, opts && opts.near) : Promise.resolve([]); },
    details: function (s) { return GOOGLE && s && s.placeId ? googleDetails(s) : Promise.resolve(null); }
  };
})();
