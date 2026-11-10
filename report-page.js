// The public report pages and the Pricing page: live report and plan prices from
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
    // Subscription plans (the Pricing page)
    var pl = r.plans, whole = function (c) { return '$' + Math.round(c / 100).toLocaleString('en-US'); };
    if (pl && pl.monthly_cents && pl.yearly_cents) {
      document.querySelectorAll('[data-plan="monthly"]').forEach(function (n) { n.textContent = whole(pl.monthly_cents); });
      document.querySelectorAll('[data-plan="yearly"]').forEach(function (n) { n.textContent = whole(pl.yearly_cents); });
      var save = pl.monthly_cents * 12 - pl.yearly_cents;
      document.querySelectorAll('[data-plan-save]').forEach(function (n) { if (save > 0) n.textContent = 'Save ' + whole(save); else n.classList.add('hidden'); });
    }
    if (r.trial_days) document.querySelectorAll('[data-trial-days]').forEach(function (n) { n.textContent = r.trial_days; });
    var free = r.signup_free_reports || 0;
    document.querySelectorAll('[data-free-n]').forEach(function (n) { n.textContent = free; });
    document.querySelectorAll('[data-free-offer]').forEach(function (n) { n.classList.toggle('hidden', !free); });
  }).catch(function () { /* the prices in the page stay */ });
})();
