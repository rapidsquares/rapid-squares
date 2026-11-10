// The header "Reports" menu on the public pages: closes on a click outside it, on Escape, or when a link is picked.
(function () {
  'use strict';
  var menus = document.querySelectorAll('details.lp-menu');
  if (!menus.length) return;
  function closeAll(except) { menus.forEach(function (m) { if (m !== except) m.open = false; }); }
  document.addEventListener('click', function (e) {
    var inside = e.target.closest && e.target.closest('details.lp-menu');
    closeAll(inside);
    if (inside && e.target.closest('a')) inside.open = false;
  });
  document.addEventListener('keydown', function (e) {
    if (e.key !== 'Escape') return;
    var open = document.querySelector('details.lp-menu[open]');
    if (open) { open.open = false; open.querySelector('summary').focus(); }
  });
})();
