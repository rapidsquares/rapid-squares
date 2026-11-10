// The public report pages (Premium Residential, Rapid Squares, Commercial, Storm Report): live prices from
// the price list (the numbers in the page are the fallback), "My account" for signed-in visitors, and the
// free-reports offer when there is one.
(function () {
  'use strict';
  var year = document.getElementById('lp-year');
  if (year) year.textContent = new Date().getFullYear();
  if (!window.RS || !RS.api) return;
  var signedIn = RS.api.mode === 'sample' || (RS.auth && RS.auth.signedIn());
  var acct = document.getElementById('lp-account');
  if (signedIn && acct) { acct.textContent = 'My account'; acct.href = 'orders.html'; }
  RS.api.get('/api/public/products').then(function (r) {
    var money = function (c) { return c ? '$' + (c / 100).toFixed(2).replace(/\.00$/, '') : 'Free'; };
    var byId = {};
    (r.products || []).forEach(function (p) { byId[p.id] = p; });
    document.querySelectorAll('[data-price]').forEach(function (n) {
      var id = n.getAttribute('data-price');
      if (id === 'esx') { if (r.esx_price_cents != null) n.textContent = money(r.esx_price_cents); return; }
      var p = byId[id];
      if (p) n.textContent = money(n.hasAttribute('data-sub') ? p.subscriber_price_cents : p.price_cents);
    });
    var free = r.signup_free_reports || 0;
    document.querySelectorAll('[data-free-n]').forEach(function (n) { n.textContent = free; });
    document.querySelectorAll('[data-free-offer]').forEach(function (n) { n.classList.toggle('hidden', !free); });
  }).catch(function () { /* the prices in the page stay */ });
})();
