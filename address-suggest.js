// Address suggestions (places.js) for ordinary form fields: add data-address-suggest to an input.
// Picking a suggestion fills in the full address; the field still saves the way it always did.
(function () {
  'use strict';
  if (!window.RS || !RS.places || !RS.places.available) return; // without a key the fields are plain text boxes

  function attach(input, n) {
    // The list sits right under the field, like the order form's address search.
    var box = document.createElement('div'); box.className = 'combo combo-plain';
    input.parentNode.insertBefore(box, input); box.appendChild(input);
    var list = document.createElement('ul'); list.className = 'suggestions hidden'; list.id = 'addr-sugg-' + n;
    list.setAttribute('role', 'listbox'); list.setAttribute('aria-label', 'Address suggestions');
    box.appendChild(list);
    input.setAttribute('role', 'combobox'); input.setAttribute('aria-autocomplete', 'list');
    input.setAttribute('aria-expanded', 'false'); input.setAttribute('aria-controls', list.id); input.setAttribute('autocomplete', 'off');

    var items = [], active = -1, timer = null, reqId = 0, picking = false;
    function render(next) {
      items = next; active = -1; list.innerHTML = '';
      items.forEach(function (p, i) {
        var li = document.createElement('li');
        li.id = list.id + '-' + i; li.setAttribute('role', 'option'); li.setAttribute('aria-selected', 'false');
        var b = document.createElement('b'); b.textContent = p.line1;
        var s = document.createElement('span'); s.textContent = p.line2;
        li.appendChild(b); li.appendChild(s);
        li.addEventListener('mousedown', function (e) { e.preventDefault(); pick(p.label); });
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
      input.setAttribute('aria-activedescendant', list.id + '-' + active);
      list.children[active].scrollIntoView({ block: 'nearest' });
    }
    function pick(address) {
      reqId++; clearTimeout(timer);
      input.value = address; render([]);
      // Let the page react as if it was typed (live previews, unsaved-changes checks), without searching again.
      picking = true; input.dispatchEvent(new Event('input', { bubbles: true })); picking = false;
      input.dispatchEvent(new Event('change', { bubbles: true }));
    }
    input.addEventListener('input', function () {
      if (picking) return;
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
    input.addEventListener('keydown', function (e) {
      var open = !list.classList.contains('hidden');
      if (e.key === 'ArrowDown' && open) { e.preventDefault(); highlight(active + 1); }
      else if (e.key === 'ArrowUp' && open) { e.preventDefault(); highlight(active - 1); }
      else if (e.key === 'Escape' && open) { e.preventDefault(); render([]); }
      else if (e.key === 'Enter' && open && active >= 0) { e.preventDefault(); pick(items[active].label); }
    });
    input.addEventListener('blur', function () { setTimeout(function () { render([]); }, 150); });
  }
  Array.prototype.forEach.call(document.querySelectorAll('input[data-address-suggest]'), attach);
})();
