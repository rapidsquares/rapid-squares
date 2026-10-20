// Landing page search: Azure Maps address suggestions as you type. Picking one (or pressing
// "Look up roof") opens the Place order page with that address looked up.
(function () {
  'use strict';
  var cfg = window.RS_CONFIG || {}, rt = window.RS_RUNTIME || {};
  var KEY = (rt.azureMapsKey || cfg.azureMapsKey || '').trim();
  var COUNTRY = cfg.countryRegion || 'US';
  var BBOX = COUNTRY === 'US' ? '-179.9,18.5,-66.5,71.5' : '-180,-85,180,85';
  var form = document.querySelector('.lp-search'), input = document.getElementById('lp-addr'), list = document.getElementById('lp-sugg');
  if (!form || !input || !list || !KEY) return; // without a key the box still works as a plain search

  var items = [], active = -1, timer = null, reqId = 0, extra = { countryRegion: COUNTRY, resultTypeGroups: 'Address' };
  function fetchSuggestions(q) {
    var params = Object.assign({ 'api-version': '2026-01-01', 'subscription-key': KEY, query: q, top: 5, bbox: BBOX }, extra);
    return fetch('https://atlas.microsoft.com/geocode:autocomplete?' + new URLSearchParams(params)).then(function (r) {
      if (r.status === 400 && Object.keys(extra).length) { extra = {}; return fetchSuggestions(q); } // optional filters rejected
      if (!r.ok) throw new Error('azure ' + r.status);
      return r.json();
    });
  }
  function toItem(f) {
    var a = (f.properties && f.properties.address) || {};
    var line1 = a.addressLine || (f.properties && f.properties.name) || a.formattedAddress || '';
    var label = a.formattedAddress || line1;
    return { label: label, line1: line1, line2: label.replace(line1, '').replace(/^[,\s]+/, '') };
  }
  function render(next) {
    items = next; active = -1; list.innerHTML = '';
    items.forEach(function (p, i) {
      var li = document.createElement('li');
      li.id = 'lp-sugg-' + i; li.setAttribute('role', 'option'); li.setAttribute('aria-selected', 'false');
      var b = document.createElement('b'); b.textContent = p.line1;
      var s = document.createElement('span'); s.textContent = p.line2;
      li.appendChild(b); li.appendChild(s);
      li.addEventListener('mousedown', function (e) { e.preventDefault(); go(p.label); });
      list.appendChild(li);
    });
    list.classList.toggle('hidden', !items.length);
    input.setAttribute('aria-expanded', items.length ? 'true' : 'false');
    input.removeAttribute('aria-activedescendant');
  }
  function highlight(i) {
    if (!items.length) return;
    active = (i + items.length) % items.length;
    Array.prototype.forEach.call(list.children, function (li, j) { li.setAttribute('aria-selected', j === active ? 'true' : 'false'); });
    input.setAttribute('aria-activedescendant', 'lp-sugg-' + active);
    list.children[active].scrollIntoView({ block: 'nearest' });
  }
  function go(address) {
    input.value = address; render([]);
    location.href = 'new-sketch.html?address=' + encodeURIComponent(address);
  }

  input.addEventListener('input', function () {
    clearTimeout(timer);
    var q = input.value.trim();
    if (q.length < 3) { reqId++; render([]); return; }
    timer = setTimeout(function () {
      var id = ++reqId;
      fetchSuggestions(q).then(function (data) {
        if (id !== reqId) return; // a newer keystroke won
        render((data.features || []).map(toItem).filter(function (p) { return p.label; }));
      }).catch(function () { if (id === reqId) render([]); });
    }, 200);
  });
  // Typed before this script was ready (slow first load)? Show suggestions for it now.
  if (input.value.trim().length >= 3 && document.activeElement === input) input.dispatchEvent(new Event('input'));
  input.addEventListener('keydown', function (e) {
    var open = !list.classList.contains('hidden');
    if (e.key === 'ArrowDown' && open) { e.preventDefault(); highlight(active + 1); }
    else if (e.key === 'ArrowUp' && open) { e.preventDefault(); highlight(active - 1); }
    else if (e.key === 'Escape') render([]);
    else if (e.key === 'Enter' && open && active >= 0) { e.preventDefault(); go(items[active].label); }
  });
  input.addEventListener('blur', function () { setTimeout(function () { render([]); }, 150); });
})();
