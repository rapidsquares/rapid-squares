// Landing page search: address suggestions as you type (places.js). Picking one (or pressing
// "Look up roof") opens the order page with that address looked up.
(function () {
  'use strict';
  var form = document.querySelector('.lp-search'), input = document.getElementById('lp-addr'), list = document.getElementById('lp-sugg');
  // Without a key the box still works as a plain search.
  if (!form || !input || !list || !window.RS || !RS.places || !RS.places.available) return;

  var items = [], active = -1, timer = null, reqId = 0;
  function render(next) {
    items = next; active = -1; list.innerHTML = '';
    items.forEach(function (p, i) {
      var li = document.createElement('li');
      li.id = 'lp-sugg-' + i; li.setAttribute('role', 'option'); li.setAttribute('aria-selected', 'false');
      var b = document.createElement('b'); b.textContent = p.line1;
      var s = document.createElement('span'); s.textContent = p.line2;
      li.appendChild(b); li.appendChild(s);
      li.addEventListener('mousedown', function (e) { e.preventDefault(); go(p); });
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
  // Open the order page with this address looked up (a Google suggestion also passes its place id).
  function go(p) {
    input.value = p.label; render([]);
    location.href = 'order.html?address=' + encodeURIComponent(p.label) + (p.placeId ? '&place=' + encodeURIComponent(p.placeId) : '');
  }

  input.addEventListener('input', function () {
    clearTimeout(timer);
    var q = input.value.trim();
    if (q.length < 3) { reqId++; render([]); return; }
    timer = setTimeout(function () {
      var id = ++reqId;
      RS.places.suggest(q).then(function (next) {
        if (id !== reqId) return; // a newer keystroke won
        render(next);
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
    else if (e.key === 'Enter' && open && active >= 0) { e.preventDefault(); go(items[active]); }
  });
  input.addEventListener('blur', function () { setTimeout(function () { render([]); }, 150); });
})();
