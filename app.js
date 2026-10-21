// Rapid Squares — page behavior.
// Every page loads the signed-in user (GET /api/me) first, then its own data through RS.api.
// Through the Node.js server the answers come from server/src/routes.js; opened without it, from sample-api.js.
(function () {
  var page = document.body.getAttribute('data-page');
  var api = window.RS && RS.api;
  var ME = null;

  // ---------- small helpers ----------
  function $(id) { return document.getElementById(id); }
  function el(tag, attrs, kids) {
    var n = document.createElement(tag);
    Object.keys(attrs || {}).forEach(function (k) {
      if (k === 'text') n.textContent = attrs[k];
      else if (k === 'class') n.className = attrs[k];
      else if (k.slice(0, 2) === 'on') n.addEventListener(k.slice(2), attrs[k]);
      else if (attrs[k] !== null && attrs[k] !== undefined && attrs[k] !== false) n.setAttribute(k, attrs[k] === true ? '' : attrs[k]);
    });
    (kids || []).forEach(function (c) { if (c != null) n.appendChild(typeof c === 'string' ? document.createTextNode(c) : c); });
    return n;
  }
  function money(cents) { return '$' + (cents / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }
  function fmtDate(iso) { return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }); }
  function fmtTime(iso) {
    var d = new Date(iso), today = new Date();
    var t = d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
    return d.toDateString() === today.toDateString() ? t : fmtDate(iso) + ', ' + t;
  }
  function splitAddress(a) { var i = (a || '').indexOf(','); return i < 0 ? [a || '', ''] : [a.slice(0, i), a.slice(i + 1).trim()]; }
  function initials(name) { return (name || '?').split(/\s+/).filter(Boolean).slice(0, 2).map(function (w) { return w[0].toUpperCase(); }).join('') || '?'; }
  function can(p) { return !!ME && ME.permissions.indexOf(p) !== -1; }
  function busy(btn, on) { if (btn) { btn.setAttribute('aria-busy', on ? 'true' : 'false'); btn.disabled = !!on; } }

  // ---------- Pop-ups: ease in and out; on phones they're bottom sheets you can swipe down to close ----------
  var phone = function () { return window.matchMedia('(max-width: 720px)').matches; };
  var still = function () { return window.matchMedia('(prefers-reduced-motion: reduce)').matches; };
  if (window.HTMLDialogElement && !HTMLDialogElement.prototype._rsClose) {
    // Every way of closing (✕, Cancel, Escape, tapping outside, code) plays the closing animation first.
    var nativeClose = HTMLDialogElement.prototype._rsClose = HTMLDialogElement.prototype.close;
    // While a pop-up is open the page behind it stays put: it can't be scrolled or dragged, even on iPhones
    // (where hiding overflow alone isn't enough). On close it goes back exactly where it was.
    var openCount = 0, savedY = 0;
    function lockPage() {
      if (openCount++ > 0) return;
      savedY = window.scrollY;
      var b = document.body.style;
      b.position = 'fixed'; b.top = -savedY + 'px'; b.left = '0'; b.right = '0'; b.width = '100%';
      document.documentElement.classList.add('modal-open');
    }
    function unlockPage() {
      if (openCount === 0 || --openCount > 0) return;
      var b = document.body.style;
      b.position = ''; b.top = ''; b.left = ''; b.right = ''; b.width = '';
      document.documentElement.classList.remove('modal-open');
      window.scrollTo(0, savedY);
    }
    HTMLDialogElement.prototype.close = function (value) {
      var d = this;
      if (!d.open || !d.classList.contains('modal')) return nativeClose.call(d, value);
      if (still()) { nativeClose.call(d, value); unlockPage(); return; }
      if (d.classList.contains('is-closing')) return;
      d.classList.add('is-closing');
      setTimeout(function () {
        d.classList.remove('is-closing', 'dragging', 'snapping', 'settled'); d.style.transform = ''; d.style.removeProperty('--drag');
        nativeClose.call(d, value);
        unlockPage();
      }, 220);
    };
    // Mark the opening animation as done even if the browser never reports it (a background tab, say).
    var nativeShow = HTMLDialogElement.prototype.showModal;
    HTMLDialogElement.prototype.showModal = function () {
      var d = this; d.classList.remove('settled');
      var wasOpen = d.open;
      nativeShow.call(d);
      if (!d.classList.contains('modal')) return;
      if (!wasOpen) lockPage();
      setTimeout(function () { if (d.open) d.classList.add('settled'); }, 360);
    };
    document.addEventListener('cancel', function (e) { // Escape
      if (e.target.classList && e.target.classList.contains('modal')) { e.preventDefault(); e.target.close(); }
    }, true);
  }
  function sheet(d) {
    if (d._sheet) return;
    d._sheet = true;
    var handle = el('div', { class: 'sheet-handle', 'aria-hidden': 'true' });
    d.insertBefore(handle, d.firstChild);
    // The opening animation plays once; after that, dragging and springing back never replay it.
    d.addEventListener('animationend', function (e) { if (e.target === d && /^rs-(pop|sheet)-in$/.test(e.animationName)) d.classList.add('settled'); });
    var y0 = null, dy = 0, t0 = 0;
    d.addEventListener('touchstart', function (e) {
      if (!phone() || e.touches.length !== 1) return;
      var onHandle = !!e.target.closest('.sheet-handle');
      // Drag from the grab bar, or from anywhere once the sheet is scrolled to the top (not from fields).
      if (!onHandle && (d.scrollTop > 0 || e.target.closest('input, textarea, select, .table-wrap'))) return;
      y0 = e.touches[0].clientY; dy = 0; t0 = Date.now();
    }, { passive: true });
    d.addEventListener('touchmove', function (e) {
      if (y0 == null) return;
      dy = Math.max(0, e.touches[0].clientY - y0);
      if (dy > 4) { d.classList.add('dragging'); d.style.transform = 'translateY(' + dy + 'px)'; if (e.cancelable) e.preventDefault(); }
    }, { passive: false });
    function end() {
      if (y0 == null) return;
      var flick = dy > 40 && dy / Math.max(1, Date.now() - t0) > 0.6;
      y0 = null; d.classList.remove('dragging');
      if (dy > Math.min(140, d.offsetHeight * 0.3) || flick) { d.style.setProperty('--drag', dy + 'px'); d.style.transform = ''; d.close(); }
      else if (dy > 0) { d.classList.add('snapping'); d.style.transform = ''; setTimeout(function () { d.classList.remove('snapping'); }, 220); }
    }
    d.addEventListener('touchend', end);
    d.addEventListener('touchcancel', end);
  }
  // Touching the dimmed area around a pop-up: never scroll the page behind it.
  document.addEventListener('touchmove', function (e) {
    if (!document.documentElement.classList.contains('modal-open')) return;
    var d = e.target.closest && e.target.closest('dialog.modal');
    if (!d && e.cancelable) e.preventDefault();
  }, { passive: false });
  document.querySelectorAll('dialog.modal').forEach(sheet);

  // Notifications. `link` is optional: { href, text }.
  var toastWrap = null;
  function toast(message, opts) {
    opts = opts || {};
    if (!toastWrap) { toastWrap = el('div', { class: 'toast-wrap', 'aria-live': 'polite' }); document.body.appendChild(toastWrap); }
    var t = el('div', { class: 'toast' + (opts.error ? ' error' : ''), role: opts.error ? 'alert' : 'status' }, [
      el('span', {}, [message, opts.link ? ' ' : null, opts.link ? el('a', { href: opts.link.href, text: opts.link.text }) : null]),
      el('button', { type: 'button', 'aria-label': 'Dismiss', text: '×', onclick: function () { t.remove(); } })
    ]);
    toastWrap.appendChild(t);
    setTimeout(function () { t.remove(); }, opts.error ? 9000 : 5000);
  }
  function showError(err) { toast((err && err.message) || 'Something went wrong. Try again.', { error: true }); }

  // Phone layout: copies each column heading onto its cells so tables can stack as labeled cards.
  function labelTables(root) {
    (root || document).querySelectorAll('table.stack').forEach(function (table) {
      var heads = Array.prototype.map.call(table.querySelectorAll('thead th'), function (th) { return th.textContent.trim(); });
      table.querySelectorAll('tbody tr').forEach(function (tr) {
        if (tr.classList.contains('loading-row')) return;
        var cells = tr.querySelectorAll('td');
        if (!tr.querySelector('td.lead') && cells[0]) cells[0].classList.add('lead');
        cells.forEach(function (td, i) { if (heads[i]) td.setAttribute('data-label', heads[i]); });
        var last = cells[cells.length - 1];
        if (last && /action|invoice|receipt/i.test(heads[cells.length - 1] || '')) last.classList.add('row-actions');
      });
    });
  }

  // The company name goes in every .co-name. It's remembered so the next page shows it straight away.
  var CO_KEY = 'rs.companyName';
  function replaceCompanyName(name) {
    if (!name) return;
    document.querySelectorAll('.co-name').forEach(function (n) { n.textContent = name; });
    try { localStorage.setItem(CO_KEY, name); } catch (_) { /* storage blocked */ }
  }
  try { replaceCompanyName(localStorage.getItem(CO_KEY)); } catch (_) { /* storage blocked */ }

  // ---------- navigation by permission ----------
  var NEEDS = { 'order.html': 'orders.create', 'orders.html?order=1': 'orders.create' };
  var PAGE_NEEDS = { order: ['orders.create', 'Order reports'] };
  function setupNav() {
    document.querySelectorAll('.topnav a, .tabbar a, .app-side a, a.btn-primary').forEach(function (a) {
      var perm = NEEDS[a.getAttribute('href')];
      if (perm && !can(perm)) a.classList.add('hidden');
    });
  }
  // Bottom of the sidebar: the signed-in email and Sign out.
  // Remembered like the company name, so it's there straight away on the next page.
  var EMAIL_KEY = 'rs.email';
  function showSignedIn(email) {
    var box = $('side-me'); if (!box || !email) return;
    $('side-email').textContent = email;
    box.classList.remove('hidden');
    try { localStorage.setItem(EMAIL_KEY, email); } catch (_) { /* storage blocked */ }
  }
  function signOut() {
    if (api.mode === 'sample') { toast('On sample data there\u2019s no real sign-in, so there\u2019s nothing to sign out of.'); return; }
    toast('Signing out\u2026');
    try { localStorage.removeItem(CO_KEY); localStorage.removeItem(EMAIL_KEY); } catch (_) { /* storage blocked */ }
    RS.auth.signOut().then(function () { location.href = 'signin.html'; });
  }
  function guardPage() {
    var need = PAGE_NEEDS[page];
    if (!need || can(need[0])) return true;
    var main = document.querySelector('main');
    main.innerHTML = '';
    main.appendChild(el('section', { class: 'card no-access' }, [
      el('h1', { text: 'You don’t have access to this page', style: 'font-size: 26px;' }),
      el('p', { class: 'lede', text: 'This page needs the “' + need[1] + '” permission. Ask your company admin to turn it on for you.' }),
      el('div', { class: 'actions' }, [el('a', { href: 'orders.html', class: 'btn btn-primary', text: 'Go to Home' })])
    ]));
    return false;
  }

  // ---------- Home (reports list + ordering) ----------
  // Labels follow RoofQuery's order lifecycle: Processing → In progress (or On hold) → Completed, or Cancelled.
  var STATUS = {
    awaiting_payment: ['ordered', 'Awaiting payment'], pending: ['ordered', 'Processing'], in_progress: ['processing', 'In progress'],
    needs_info: ['processing', 'In progress'], delivered: ['ready', 'Completed'], failed: ['cancelled', 'Cancelled'], cancelled: ['cancelled', 'Cancelled']
  };
  var RQ_LABEL = { 'on-hold': 'On hold', revisions_requested: 'Revision requested' };
  function initReports() {
    var FILTERS = { all: '', processing: 'pending', in_progress: 'in_progress,needs_info', completed: 'delivered', cancelled: 'failed,cancelled' };
    var state = { filter: 'all', q: '' }, timer = null, refresh = null;
    var tbody = $('report-rows'), tabs = document.querySelectorAll('.tab');
    // Endless list: 20 reports at a time, more as the end of the list comes into view.
    var PAGE = 20, loaded = 0, total = 0, nextPage = 1, busyLoading = false, seq = 0, live = false;

    tabs.forEach(function (t) {
      t.addEventListener('click', function () {
        state.filter = t.getAttribute('data-filter');
        tabs.forEach(function (x) { x.setAttribute('aria-selected', x === t ? 'true' : 'false'); });
        load();
      });
    });
    $('q').addEventListener('input', function () {
      clearTimeout(timer);
      timer = setTimeout(function () { state.q = $('q').value.trim(); load(); }, 250);
    });

    function query(page, size) {
      var qs = new URLSearchParams({ page: page, page_size: size });
      if (FILTERS[state.filter]) qs.set('status', FILTERS[state.filter]);
      if (state.q) qs.set('q', state.q);
      return '/api/orders?' + qs.toString();
    }
    // From the top: a new filter or search, or a refresh that keeps what's already loaded (up to 40).
    function load(keep) {
      var my = ++seq, size = keep ? Math.min(40, Math.max(PAGE, Math.ceil(loaded / PAGE) * PAGE)) : PAGE;
      busyLoading = true;
      return api.get(query(1, size)).then(function (data) {
        if (my !== seq) return;
        busyLoading = false; loaded = 0; nextPage = size / PAGE + 1;
        tbody.innerHTML = '';
        render(data);
      }).catch(function (e) { if (my === seq) { busyLoading = false; showError(e); } });
    }
    function more() {
      if (busyLoading || loaded >= total) return;
      var my = seq; busyLoading = true;
      if ($('list-more')) $('list-more').textContent = 'Loading more reports…';
      api.get(query(nextPage, PAGE)).then(function (data) {
        if (my !== seq) return;
        busyLoading = false; nextPage++;
        clearTimeout(refresh);
        render(data);
      }).catch(function (e) { if (my === seq) { busyLoading = false; if ($('list-more')) $('list-more').textContent = ''; showError(e); } });
    }

    function render(data) {
      var c = data.counts || {};
      var n = { all: c.all || 0, processing: c.pending || 0, in_progress: (c.in_progress || 0) + (c.needs_info || 0), completed: c.delivered || 0, cancelled: (c.failed || 0) + (c.cancelled || 0) };
      tabs.forEach(function (t) { t.querySelector('.count').textContent = n[t.getAttribute('data-filter')]; });
      $('scope-note').classList.toggle('hidden', data.scope !== 'mine');

      data.orders.forEach(function (o) { tbody.appendChild(orderRow(o)); });
      loaded += data.orders.length; total = data.total;
      if (data.orders.some(function (o) { return o.status === 'pending' || o.status === 'in_progress'; })) live = true;

      var empty = $('no-results');
      empty.classList.toggle('hidden', data.total !== 0);
      if (data.total === 0) {
        empty.innerHTML = '';
        if (state.q || state.filter !== 'all') empty.textContent = 'No reports match.';
        else {
          empty.appendChild(document.createTextNode('No reports yet. '));
          if (can('orders.create')) empty.appendChild(el('a', { href: 'order.html', text: 'Order your first report' }));
        }
      }
      if ($('list-more')) $('list-more').textContent = loaded < total ? '' : total > PAGE ? 'That’s all ' + total + ' reports.' : '';
      // Short screens: keep going until the list fills it.
      if (loaded < total && near()) more();

      // Orders in progress move along on their own; check again while any are showing (not once far down the list).
      clearTimeout(refresh);
      if (live && loaded <= 40) refresh = setTimeout(function () { if (loaded <= 40 && !busyLoading) { live = false; load(true); } }, 10000);
    }
    function near() { var m = $('list-more'); return !!m && m.getBoundingClientRect().top < window.innerHeight + 600; }
    // The pinned header sits right under the phone top bar.
    function topbarHeight() {
      var tb = document.querySelector('.topbar');
      document.documentElement.style.setProperty('--topbar-h', (tb && getComputedStyle(tb).position === 'sticky' ? tb.offsetHeight : 0) + 'px');
    }
    topbarHeight(); window.addEventListener('resize', topbarHeight);
    if (!$('list-more')) { /* an older copy of the page: no endless list */ }
    else if ('IntersectionObserver' in window) {
      new IntersectionObserver(function (entries) { if (entries[0].isIntersecting) more(); }, { rootMargin: '600px 0px' }).observe($('list-more'));
    } else window.addEventListener('scroll', function () { if (near()) more(); }, { passive: true });

    function orderRow(o) {
      var addr = splitAddress(o.address), s = STATUS[o.status] || ['cancelled', o.status];
      if (RQ_LABEL[o.rq_status]) s = [s[0], RQ_LABEL[o.rq_status]];
      var storm = o.measurements && o.measurements.storm;
      // Squares and pitch live on the report page; the card says what was ordered and for whom.
      var detail = storm && storm.damage_chance ? storm.damage_chance.charAt(0).toUpperCase() + storm.damage_chance.slice(1) + ' damage chance' + (storm.hail_days != null ? ' · ' + storm.hail_days + ' hail days' : '') : '';
      var job = o.order_details || {};
      var SCOPE_SHORT = { primary_only: 'Main building', primary_and_garage: 'Main building + garage', all_structures: 'Every building' };
      var jobLine = [SCOPE_SHORT[job.scope], job.claim ? 'Claim ' + job.claim : null, job.client_name || job.insured_name].filter(Boolean).join(' · ');
      if (jobLine) detail = detail ? detail + ' · ' + jobLine : jobLine;
      // One card per report: the whole card is a link to the report's own page.
      var href = (o.report_type === 'storm_report' ? 'storm-report.html' : 'report.html') + '?id=' + encodeURIComponent(o.id);
      var when = o.status === 'delivered' ? 'Ready' + (o.completed_at ? ' ' + fmtDate(o.completed_at) : '')
        : o.eta ? 'Ready by ' + fmtTime(o.eta)
        : o.status === 'failed' ? (o.status_detail || 'Couldn\u2019t be measured') + (o.refunded ? ' \u00b7 Refunded' : '')
        : o.status === 'cancelled' ? (o.status_detail || '') : (o.status_detail || '');
      var arrow = el('span', { class: 'oc-go', 'aria-hidden': 'true' });
      arrow.innerHTML = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 6l6 6-6 6"/></svg>';
      return el('a', { class: 'order-card', href: href, 'data-status': o.status, 'data-id': o.id, 'aria-label': o.report_number + ', ' + o.address + ', ' + s[1] + '. Open report' }, [
        el('div', { class: 'oc-place' }, [
          el('span', { class: 'oc-num', text: o.report_number }),
          el('b', { class: 'oc-addr', text: addr[0] }),
          el('span', { class: 'hint', text: addr[1] })
        ]),
        el('div', { class: 'oc-type' }, [
          el('b', { text: o.product_label + (o.esx_purchased ? ' + ESX' : '') }),
          detail ? el('span', { class: 'hint', text: detail }) : null
        ]),
        el('div', { class: 'oc-state' }, [
          el('span', { class: 'pill ' + s[0], text: s[1] }),
          when ? el('span', { class: 'hint', text: when }) : null,
          el('span', { class: 'hint', text: fmtDate(o.created_at) + ' \u00b7 ' + o.ordered_by_name })
        ]),
        el('span', { class: 'oc-open' }, [arrow])
      ]);
    }
    load();
    // Free trial prompt for companies that haven't used theirs (people who can manage billing only).
    if (can('billing.manage')) api.get('/api/products').then(function (pr) {
      if (pr.trial_eligible && pr.trial_days && !pr.subscribed) { $('tb-days').textContent = pr.trial_days; $('trial-banner').classList.remove('hidden'); }
    }).catch(function () { /* the banner is optional */ });
    setupQuickOrder(function () { load(); });
    var back = new URLSearchParams(location.search);
    if (back.get('paid')) { toast('Payment received for ' + back.get('paid') + '. Your order is placed.'); setTimeout(load, 2500); }
    else if (back.get('placed')) toast(back.get('placed') + ' placed' + (back.get('charged') ? ' · ' + money(+back.get('charged')) + ' charged to your card on file.' : back.get('free') ? ' · used 1 free report.' : '.'));
    else if (back.get('esx')) { toast('ESX file bought for ' + back.get('esx') + '. Use “ESX file” to download it.'); setTimeout(load, 2500); }
    else if (back.get('unpaid') && back.get('for') === 'esx') toast('Payment wasn\u2019t finished, so the ESX file for ' + back.get('unpaid') + ' wasn\u2019t bought.', { error: true });
    else if (back.get('unpaid')) toast('Payment wasn\u2019t finished, so ' + back.get('unpaid') + ' wasn\u2019t placed. Order again when you\u2019re ready.', { error: true });
    if (back.get('paid') || back.get('placed') || back.get('unpaid') || back.get('esx')) history.replaceState(null, '', location.pathname);
  }

  // "Order new report" opens the order form in a pop-up on Home. Links to orders.html?order=1
  // (and signed-in visits to order.html, which forward here) open it straight away.
  function setupQuickOrder(onOrdered) {
    var btn = document.querySelector('.page-head a[href="order.html"]');
    if (!btn) return;
    var side = document.querySelector('.app-side a[href="orders.html?order=1"]');
    var dlg = null, first = new URLSearchParams(location.search), src = 'order.html?embed=1';
    if (first.get('order') && can('orders.create')) {
      ['address', 'resume'].forEach(function (k) { if (first.get(k)) src += '&' + k + '=' + encodeURIComponent(first.get(k)); });
      history.replaceState(null, '', location.pathname);
      setTimeout(open);
    }
    // The order form loads in the background so the pop-up opens ready, and is reset after each close.
    function build() {
      if (dlg) return;
      // The order form draws its own header, steps and close button inside the frame.
      var frame = el('iframe', { src: src, title: 'Order a new report', class: 'qo-frame' });
      frame.addEventListener('load', function () { frame.classList.add('ready'); });
      dlg = el('dialog', { class: 'modal qo', 'aria-label': 'Order a new report' }, [frame]);
      sheet(dlg); // grab bar above the order form, so phones can swipe it closed
      dlg.addEventListener('click', function (e) { if (e.target === dlg) close(); });
      dlg.addEventListener('cancel', function () { setTimeout(reset); }); // Escape
      dlg.addEventListener('close', reset); // not every browser sends this, so close() resets too
      document.body.appendChild(dlg);
    }
    var used = false;
    function open() { build(); used = true; dlg.showModal(); }
    function close() { if (dlg && dlg.open) dlg.close(); reset(); }
    // Back to a fresh, ready form for next time.
    function reset() {
      if (!used) return;
      used = false;
      var frame = dlg.querySelector('iframe');
      frame.classList.remove('ready');
      // Same address again doesn't reload a frame, so ask the frame to reload itself.
      try { frame.contentWindow.location.replace('order.html?embed=1'); } catch (_) { frame.src = 'order.html?embed=1'; }
    }
    if (can('orders.create')) setTimeout(build, 300);
    [btn, side].forEach(function (a) {
      if (a) a.addEventListener('click', function (e) {
        if (e.ctrlKey || e.metaKey || e.shiftKey || !window.HTMLDialogElement) return; // new tab / old browser: go to the page
        e.preventDefault(); open();
      });
    });
    window.addEventListener('message', function (e) {
      if (e.origin !== location.origin || !e.data) return;
      if (e.data.type === 'rs:close') { close(); return; }
      if (e.data.type !== 'rs:ordered') return;
      // The pop-up shows its own "order placed" step; the list behind it updates now.
      toast((e.data.ready ? 'Ready: ' : 'Ordered ') + e.data.report_number + ' · ' + e.data.label + '.');
      onOrdered();
    });
  }

  // ---------- Roof report page ----------
  var SCOPE_TEXT = { primary_only: 'Main building only', primary_and_garage: 'Main building + detached garage', all_structures: 'Every building on the property' };
  var DRAWING_LABEL = { lengths: 'Lengths', area: 'Area', pitch: 'Pitch' };
  var WASTE = [0, 5, 7, 10, 12, 15, 19, 24];
  var RAPID_WASTE = [0, 10, 12, 15];
  function initReport() {
    var id = new URLSearchParams(location.search).get('id'), data = null;
    var num = function (v, d) { return v == null ? '—' : Number(v).toLocaleString('en-US', { maximumFractionDigits: d == null ? 1 : d }); };
    var cap = function (t) { return t ? t.charAt(0).toUpperCase() + t.slice(1) : '—'; };
    if (!id) { $('rp-title').textContent = 'No report chosen'; return; }
    function load() {
      return api.get('/api/orders/' + encodeURIComponent(id) + '/report').then(function (r) { data = r; render(r); }).catch(function (e) {
        $('rp-title').textContent = 'This report can’t be shown'; $('rp-sub').textContent = (e && e.message) || ''; $('rp-files').classList.add('hidden');
      });
    }
    load();
    function card(title, kids, extra) { return el('section', { class: 'card' }, [title ? el('div', { class: 'split', style: 'align-items: baseline;' }, [el('h2', { style: 'font-size: 18px;', text: title }), extra || null]) : null].concat(kids)); }
    function stat(label, value, sub) { return el('div', { class: 'iq-stat' }, [el('span', { class: 'hint', text: label }), el('b', { text: value }), sub ? el('span', { class: 'hint', text: sub }) : null]); }
    function table(heads, rows, cls) {
      return el('div', { class: 'table-wrap' }, [el('table', { class: 'stack rp-table ' + (cls || '') }, [
        el('thead', {}, [el('tr', {}, heads.map(function (h) { return el('th', { text: h }); }))]),
        el('tbody', {}, rows.map(function (cells) { return el('tr', {}, cells.map(function (c, i) { return el('td', { class: i === 0 ? 'lead' : '' }, [c]); })); }))
      ])]);
    }
    function render(r) {
      var o = r.order, addr = splitAddress(o.address), main = $('rp-main'), rep = r.report, job = o.order_details || {};
      document.title = o.product_label + ' ' + o.report_number + ' · Rapid Squares';
      $('rp-eyebrow').textContent = o.product_label + ' · ' + o.report_number;
      $('rp-title').textContent = addr[0];
      $('rp-sub').textContent = [addr[1], 'Ordered ' + fmtDate(o.created_at) + ' by ' + o.ordered_by_name].filter(Boolean).join(' · ');
      main.innerHTML = '';
      renderFiles(r);
      if (!rep) {
        var st = STATUS[o.status] || ['cancelled', o.status];
        main.appendChild(card('Status', [
          el('div', { class: 'sr-head' }, [el('span', { class: 'pill ' + st[0], text: RQ_LABEL[o.rq_status] || st[1] })]),
          el('p', { class: 'lede', style: 'margin: 0;', text: o.status === 'failed' || o.status === 'cancelled' ? (o.status_detail || 'This order was cancelled.') + (o.refunded ? ' You’ve been refunded.' : '')
            : o.eta ? 'We’re measuring this roof now. It’s usually ready by ' + fmtTime(o.eta) + ', and we’ll email you when it is.' : (o.status_detail || 'Waiting to be measured.') })
        ]));
        renderJob(main, job);
        if (o.status === 'pending' || o.status === 'in_progress') setTimeout(load, 30000);
        return;
      }
      var s = rep.summary || {};
      if (rep.revision_open) main.appendChild(el('p', { class: 'notice', style: 'margin: 0;', text: 'A correction is in progress. The files below stay available, and we’ll email the corrected report when it’s ready.' }));
      if (rep.kind === 'rapid_squares') { renderRapid(main, rep); renderJob(main, job, rep.scope_label); labelTables(main); return; }
      // Summary
      main.appendChild(card('Summary', [el('div', { class: 'iq-stats' }, [
        stat('Total squares', num(s.squares, 2), s.area_sqft != null ? num(s.area_sqft) + ' sq ft' : null),
        stat('Predominant pitch', s.pitch || '—'),
        stat('Roof faces', num(s.facets, 0)),
        stat('Buildings', num(s.structures, 0)),
        stat('Total edges', s.edges_ft != null ? num(s.edges_ft) + ' ft' : '—'),
        stat('Hips + ridges', s.hips_ridges_ft != null ? num(s.hips_ridges_ft) + ' ft' : '—'),
        stat('Complexity', cap(s.complexity)),
        stat('Est. attic area', s.attic_sqft != null ? num(s.attic_sqft, 0) + ' sq ft' : '—')
      ])], rep.sandbox ? el('span', { class: 'opt-tag', text: 'Sandbox' }) : null));
      // Drawings (from RoofQuery, as pictures)
      if (rep.drawings) main.appendChild(drawings(rep.drawings));
      // Edges
      var edges = (s.edges || []).filter(function (e) { return e.length_ft || e.count; });
      if (edges.length) main.appendChild(card('Edge measurements', [table(['Type', 'Length', 'Count'], edges.map(function (e) { return [e.label, num(e.length_ft) + ' ft', e.count == null ? '—' : String(e.count)]; }))]));
      // Waste factor: squares to order, rounded up to the next third of a square
      if (s.squares) main.appendChild(card('Waste factor', [table(['Waste'].concat(WASTE.map(function (w) { return w + '%'; })),
        [['Squares'].concat(WASTE.map(function (w) { return (Math.ceil(s.squares * (1 + w / 100) * 3 - 1e-9) / 3).toFixed(2); }))], 'waste-table'),
        el('p', { class: 'hint', style: 'margin: 0;', text: 'Squares to order at each waste allowance, rounded up to the next bundle (⅓ square).' })]));
      // Pitch
      if (s.pitches && s.pitches.length) main.appendChild(card('Pitch breakdown', [table(['Pitch', 'Area', 'Share'], s.pitches.map(function (p) { return [p.pitch, num(p.area_sqft) + ' sq ft', p.pct == null ? '—' : p.pct + '%']; }))]));
      // Buildings
      if (rep.buildings && rep.buildings.length > 1) main.appendChild(card('Buildings', [table(['Building', 'Squares', 'Pitch', 'Faces', 'Hips + ridges'], rep.buildings.map(function (b) {
        return ['Building ' + b.index + (b.index === 1 ? ' (largest)' : ''), num(b.squares, 2), b.pitch || '—', num(b.facets, 0), b.hips_ridges_ft != null ? num(b.hips_ridges_ft) + ' ft' : '—'];
      }))]));
      renderJob(main, job, rep.scope_label);
      labelTables(main);
    }
    // Rapid Squares: one estimated pitch per building, and the squares the roof would be at every other pitch.
    function renderRapid(main, rep) {
      var s = rep.summary || {}, bs = rep.buildings || [], many = bs.length > 1;
      main.appendChild(card('Summary', [el('div', { class: 'iq-stats' }, [
        stat('Total squares', num(s.squares, 2), s.area_sqft != null ? num(s.area_sqft) + ' sq ft' : null),
        stat(many ? 'Estimated pitch (largest)' : 'Estimated pitch', s.pitch || '—'),
        stat('Buildings', num(s.structures, 0)),
        stat('Footprint', s.footprint_sqft != null ? num(s.footprint_sqft) + ' sq ft' : '—'),
        stat('Perimeter', s.perimeter_ft != null ? num(s.perimeter_ft) + ' ft' : '—')
      ])], rep.sandbox ? el('span', { class: 'opt-tag', text: 'Sandbox' }) : null));
      main.appendChild(buildingsCard(rep.outline, bs, s));
    }
    // The photo with each building outlined, and the squares to order at every pitch and waste allowance.
    // With more than one building, a selector (All, 1, 2…) switches both: the photo zooms to that building
    // and the table shows its squares, with its own estimated pitch marked.
    var OUTLINE_COLORS = ['#F2622E', '#2F8FE8', '#F5C518', '#3CB371', '#B565F0'];
    function buildingsCard(o, bs, s) {
      var many = bs.length > 1, sel = 'all';
      var sq = function (v) { return v == null ? '—' : Number(v).toFixed(2); };
      var bundle = function (v, w) { return (Math.ceil(v * (1 + w / 100) * 3 - 1e-9) / 3).toFixed(2); };
      var at = function (b, pitch) { var x = b.by_pitch.filter(function (p) { return p.pitch === pitch; })[0]; return x ? x.squares : 0; };
      var pitches = [];
      bs.forEach(function (b) { b.by_pitch.forEach(function (p) { if (pitches.indexOf(p.pitch) < 0) pitches.push(p.pitch); }); });
      pitches.sort(function (a, b) { return parseFloat(a) - parseFloat(b); });
      var color = function (i) { return OUTLINE_COLORS[i % OUTLINE_COLORS.length]; };

      // ---- selector ----
      var tabs = many ? el('div', { class: 'tabs', role: 'tablist', 'aria-label': 'Building' }, ['all'].concat(bs.map(function (b) { return String(b.index); })).map(function (id) {
        var i = bs.findIndex(function (b) { return String(b.index) === id; });
        return el('button', { type: 'button', class: 'tab', role: 'tab', 'data-id': id, onclick: function () { sel = id; show(); } },
          [i >= 0 ? el('i', { class: 'rp-dot', style: 'background:' + color(i) }) : null, id === 'all' ? 'All' : id]);
      })) : null;

      // ---- photo ----
      var NS = 'http://www.w3.org/2000/svg', root = null, groups = {}, msg = null;
      function svg(tag, attrs) { var n = document.createElementNS(NS, tag); Object.keys(attrs).forEach(function (k) { n.setAttribute(k, attrs[k]); }); return n; }
      var ring = function (pts) { return 'M' + pts.map(function (p) { return p[0] + ' ' + p[1]; }).join('L') + 'Z'; };
      if (o) {
        root = svg('svg', { viewBox: '0 0 ' + o.width + ' ' + o.height, class: 'rp-outline', role: 'img', 'aria-label': 'Aerial photo with each building outlined' });
        var photo = svg('image', { href: o.photo_url, x: 0, y: 0, width: o.width, height: o.height, preserveAspectRatio: 'none' });
        msg = el('p', { class: 'hint hidden', style: 'margin: 0;', text: 'The photo couldn’t be loaded right now.' });
        photo.addEventListener('error', function () { msg.classList.remove('hidden'); });
        root.appendChild(photo);
        var w = Math.max(2, o.width / 220);
        o.buildings.forEach(function (b, i) {
          var g = svg('g', { class: 'rp-shape' }), d = b.outlines.concat(b.holes).map(ring).join(''), xs = [], ys = [];
          b.outlines[0].forEach(function (p) { xs.push(p[0]); ys.push(p[1]); });
          g.appendChild(svg('path', { d: d, 'fill-rule': 'evenodd', fill: color(i), 'fill-opacity': 0.18, stroke: '#fff', 'stroke-width': w * 2.2, 'stroke-linejoin': 'round', 'stroke-opacity': 0.85 }));
          g.appendChild(svg('path', { d: d, 'fill-rule': 'evenodd', fill: 'none', stroke: color(i), 'stroke-width': w, 'stroke-linejoin': 'round' }));
          if (many) {
            var cx = xs.reduce(function (a, v) { return a + v; }, 0) / xs.length, cy = ys.reduce(function (a, v) { return a + v; }, 0) / ys.length, r = Math.max(10, o.width / 45);
            g.appendChild(svg('circle', { cx: cx, cy: cy, r: r, fill: color(i), stroke: '#fff', 'stroke-width': w }));
            var t = svg('text', { x: cx, y: cy, 'text-anchor': 'middle', 'dominant-baseline': 'central', 'font-size': r * 1.15, 'font-weight': 700, fill: '#fff' });
            t.textContent = String(b.index || i + 1); g.appendChild(t);
          }
          root.appendChild(g);
          groups[String(b.index)] = { g: g, box: [Math.min.apply(null, xs), Math.min.apply(null, ys), Math.max.apply(null, xs), Math.max.apply(null, ys)] };
        });
      }
      // Zoom to one building: a square around it with room to spare, kept inside the photo.
      function viewFor(id) {
        var x = groups[id];
        if (!x) return '0 0 ' + o.width + ' ' + o.height;
        var side = Math.min(Math.max(o.width, o.height), Math.max(x.box[2] - x.box[0], x.box[3] - x.box[1], o.width / 4) * 2.2);
        var cx = (x.box[0] + x.box[2]) / 2, cy = (x.box[1] + x.box[3]) / 2;
        var left = Math.min(Math.max(0, cx - side / 2), o.width - side), top = Math.min(Math.max(0, cy - side / 2), o.height - side);
        return [left, top, side, side].map(function (v) { return Math.round(v * 10) / 10; }).join(' ');
      }

      // ---- table ----
      var facts = el('p', { class: 'rp-facts' });
      var body = el('tbody');
      var grid = el('table', { class: 'rp-table pitch-waste' }, [
        el('thead', {}, [el('tr', {}, [el('th', { text: 'Pitch' })].concat(RAPID_WASTE.map(function (w) { return el('th', { text: w + '%' }); })))]), body]);
      var hint = el('p', { class: 'hint', style: 'margin: 0;' });
      function row(label, value, on) {
        return el('tr', { class: on ? 'est' : '' }, [el('td', { text: label })].concat(RAPID_WASTE.map(function (w) { return el('td', { text: bundle(value, w) }); })));
      }
      function show() {
        var b = bs.filter(function (x) { return String(x.index) === sel; })[0], one = b || (!many && bs[0]);
        if (tabs) tabs.querySelectorAll('.tab').forEach(function (t) { t.setAttribute('aria-selected', String(t.getAttribute('data-id') === sel)); });
        if (root) {
          root.setAttribute('viewBox', b ? viewFor(sel) : '0 0 ' + o.width + ' ' + o.height);
          Object.keys(groups).forEach(function (id) { groups[id].g.style.opacity = !b || id === sel ? 1 : 0.3; });
        }
        body.innerHTML = '';
        if (one) {
          facts.textContent = [many ? 'Building ' + one.index : null, sq(one.squares) + ' squares', 'est. ' + (one.pitch || '—') + ' pitch',
            one.footprint_sqft != null ? num(one.footprint_sqft, 0) + ' sq ft footprint' : null].filter(Boolean).join(' · ');
          pitches.forEach(function (p) { body.appendChild(row(p === one.pitch ? p + ' ✓' : p, at(one, p), p === one.pitch)); });
          hint.textContent = 'Columns are the waste allowance. ✓ marks the estimated pitch; use another row if you know the pitch. Rounded up to the next bundle (⅓ square).';
        } else {
          facts.textContent = bs.length + ' buildings · ' + sq(s.squares) + ' squares at their estimated pitches';
          // First row: every building at its own estimated pitch. Then all of them at the same pitch.
          body.appendChild(row('Est. ✓', s.squares || bs.reduce(function (t, x) { return t + (x.squares || 0); }, 0), true));
          pitches.forEach(function (p) { body.appendChild(row(p, bs.reduce(function (t, x) { return t + at(x, p); }, 0), false)); });
          hint.textContent = 'All buildings together. Columns are the waste allowance. The first row has each building at its own estimated pitch; the rest have every building at that pitch. Pick a building to see it alone. Rounded up to the next bundle (⅓ square).';
        }
      }
      show();
      return card(many ? 'Buildings' : 'Roof', [tabs, root ? el('div', { class: 'rp-outline-box' }, [root]) : null, msg, facts,
        pitches.length ? el('div', { class: 'table-wrap' }, [grid]) : null, hint]);
    }
    function drawings(d) {
      var state = { target: 'all', type: d.types[0] };
      var img = el('img', { class: 'rp-drawing', alt: '' }), msg = el('p', { class: 'hint hidden', style: 'margin: 0;', text: 'This drawing couldn’t be loaded right now.' });
      var tabs = el('div', { class: 'tabs', role: 'tablist', 'aria-label': 'Drawing' }, d.types.map(function (t) {
        return el('button', { type: 'button', class: 'tab', role: 'tab', 'aria-selected': String(t === state.type), 'data-type': t, text: DRAWING_LABEL[t] || t, onclick: function () { state.type = t; show(); } });
      }));
      var pick = d.targets.length > 2 ? el('select', { 'aria-label': 'Building', onchange: function () { state.target = pick.value; show(); } }, d.targets.map(function (t) { return el('option', { value: t.id, text: t.label }); })) : null;
      function show() {
        tabs.querySelectorAll('.tab').forEach(function (b) { b.setAttribute('aria-selected', String(b.getAttribute('data-type') === state.type)); });
        msg.classList.add('hidden'); img.classList.remove('hidden'); img.classList.add('loading');
        img.alt = (DRAWING_LABEL[state.type] || state.type) + ' drawing';
        img.src = d.urls[state.target + '/' + state.type];
      }
      img.addEventListener('load', function () { img.classList.remove('loading'); });
      img.addEventListener('error', function () { img.classList.add('hidden'); msg.classList.remove('hidden'); });
      show();
      return card('Drawings', [el('div', { class: 'split' }, [tabs, pick ? el('div', { class: 'fld', style: 'min-width: 180px;' }, [pick]) : null]), el('div', { class: 'rp-drawing-box' }, [img, msg]),
        el('p', { class: 'hint', style: 'margin: 0;', text: 'Lengths shows every edge, colored by type, with its true sloped length in feet.' })]);
    }
    function renderJob(main, job, scopeLabel) {
      var rows = [['What was measured', SCOPE_TEXT[job.scope] || scopeLabel], ['Claim number', job.claim], ['Client', job.client_name], ['Client email', job.client_email], ['Client phone', job.client_phone], ['Notes for the measuring team', job.notes]]
        .filter(function (r) { return r[1]; });
      if (!rows.length) return;
      main.appendChild(card('Job details', [el('dl', { class: 'rv' }, rows.map(function (r) { return el('div', {}, [el('dt', { text: r[0] }), el('dd', { text: r[1] }), el('dd', {})]); }))]));
    }
    function renderFiles(r) {
      var o = r.order, box = $('rp-file-list'); box.innerHTML = '';
      function fileBtn(title, sub, onclick) {
        return el('button', { type: 'button', class: 'btn pdf-btn', onclick: onclick }, [el('span', { class: 'pdf-btn-top' }, [el('b', { text: title }), el('span', { class: 'hint', text: sub })])]);
      }
      if (o.status !== 'delivered') { box.appendChild(el('p', { class: 'hint', style: 'margin: 0;', text: 'Files appear here when the report is ready.' })); return; }
      if (!r.can_download) { box.appendChild(el('p', { class: 'hint', style: 'margin: 0;', text: 'Ask your company admin for the “Download reports” permission to download the files.' })); return; }
      box.appendChild(fileBtn('PDF report', 'PDF', function () { download(o.id, 'pdf'); }));
      if (o.esx_purchased) box.appendChild(fileBtn('Xactimate (ESX) file', 'ESX', function () { download(o.id, 'esx'); }));
      else if (o.esx_available && r.can_buy_esx && r.esx_price_cents != null) {
        box.appendChild(el('button', { type: 'button', class: 'btn btn-primary', style: 'width: 100%;', text: 'Add ESX file · ' + money(r.esx_price_cents), onclick: openEsx }));
      } else if (o.esx_available) box.appendChild(el('p', { class: 'hint', style: 'margin: 0;', text: 'The Xactimate (ESX) file can be added once payments are connected.' }));
    }
    function download(oid, kind) { api.get('/api/orders/' + oid + '/' + kind).then(function (r) { if (r && r.url) location.href = r.url; }).catch(showError); }
    // Add the ESX file: a proper pop-up instead of the browser's OK / Cancel box
    function openEsx() {
      $('esx-dlg-sub').textContent = data.order.report_number + ' · ' + data.order.address;
      $('esx-price').textContent = money(data.esx_price_cents);
      $('esx-note').textContent = data.esx_price_cents ? 'Charged to the card on file.' : 'No charge.';
      $('esx-err').classList.add('hidden');
      $('esx-dlg').showModal();
    }
    function closeEsx() { $('esx-dlg').close(); }
    $('esx-cancel').addEventListener('click', closeEsx); $('esx-dlg-x').addEventListener('click', closeEsx);
    $('esx-dlg').addEventListener('click', function (e) { if (e.target === $('esx-dlg')) closeEsx(); });
    $('esx-form').addEventListener('submit', function (e) {
      e.preventDefault();
      var btn = $('esx-go'); busy(btn, true);
      api.post('/api/orders/' + data.order.id + '/buy-esx', {}).then(function (r) {
        if (r.checkout_url) { location.href = r.checkout_url; return; }
        closeEsx();
        toast('ESX file added. It’s downloading now, and we’ve emailed it to you too.');
        if (r.url) location.href = r.url;
        load();
      }).catch(function (x) { $('esx-err').textContent = (x && x.message) || 'The ESX file couldn’t be added. Try again.'; $('esx-err').classList.remove('hidden'); })
        .then(function () { busy(btn, false); });
    });
  }

  // ---------- Storm report page ----------
  var PDF_INFO = {
    weather_history: 'Everything: map, summary, hail and wind tables and every storm day.',
    hail_verification: 'For adjusters: hail at the property and within 1, 3 and 5 miles, by date.',
    wind_verification: 'Wind within 1, 3 and 5 miles, weather stations, warnings and tornadoes.',
    date_of_loss: 'One date by distance, with the map. Needs a date of loss.',
    homeowner: 'A plain-English page for the homeowner, with the damage chance and map.'
  };
  var WHERE = { at_property: 'at the property', within_1_mi: 'within 1 mile', within_3_mi: 'within 3 miles', within_5_mi: 'within 5 miles' };
  function initStorm() {
    var id = new URLSearchParams(location.search).get('id');
    var cap = function (t) { return t ? t.charAt(0).toUpperCase() + t.slice(1) : ''; };
    var day = function (d) { return d ? new Date(d + 'T12:00:00').toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }) : '—'; };
    var inch = function (v) { return v == null ? '—' : v + '″'; };
    var mph = function (v) { return v == null ? '—' : v + ' mph'; };
    var data = null, tpl = null;
    if (!id) { $('sr-title').textContent = 'No storm report chosen'; return; }
    api.get('/api/orders/' + encodeURIComponent(id) + '/storm').then(function (r) { data = r; render(r); }).catch(function (e) {
      $('sr-title').textContent = 'This storm report can’t be shown';
      $('sr-sub').textContent = (e && e.message) || '';
      $('sr-pdf-card').classList.add('hidden');
    });

    function card(title, kids, cls) { return el('section', { class: 'card ' + (cls || '') }, [title ? el('h2', { style: 'font-size: 18px;', text: title }) : null].concat(kids)); }
    function stat(label, value, sub) { return el('div', { class: 'iq-stat' }, [el('span', { class: 'hint', text: label }), el('b', { text: value }), sub ? el('span', { class: 'hint', text: sub }) : null]); }
    function table(heads, rows) {
      return el('div', { class: 'table-wrap' }, [el('table', { class: 'stack sr-table' }, [
        el('thead', {}, [el('tr', {}, heads.map(function (h) { return el('th', { text: h }); }))]),
        el('tbody', {}, rows.map(function (cells) { return el('tr', {}, cells.map(function (c, i) { return el('td', { class: i === 0 ? 'lead' : '' }, [c]); })); }))
      ])]);
    }
    function chance(level) { return level ? el('span', { class: 'dmg dmg-' + level, text: cap(level) }) : document.createTextNode('—'); }

    function render(r) {
      var o = r.order, s = r.storm || {}, addr = splitAddress(o.address), main = $('sr-main');
      document.title = 'Storm Report ' + o.report_number + ' · Rapid Squares';
      $('sr-eyebrow').textContent = 'Storm report · ' + o.report_number;
      $('sr-title').textContent = addr[0];
      $('sr-sub').textContent = [addr[1], 'Ordered ' + fmtDate(o.created_at) + ' by ' + o.ordered_by_name].filter(Boolean).join(' · ');
      main.innerHTML = '';
      var years = (s.period && s.period.years) || 5;
      // Headline and damage chance
      main.appendChild(card(null, [
        el('div', { class: 'sr-head' }, [el('span', { class: 'hint', text: 'Damage chance' }), chance(s.damage_chance)]),
        el('p', { class: 'sr-headline', text: s.headline || (s.nothing_found ? 'No storms were recorded within 5 miles in the last ' + years + ' years.' : 'Storm history for the last ' + years + ' years.') }),
        s.damage_reason ? el('p', { class: 'hint', style: 'margin: 0;', text: s.damage_reason }) : null,
        el('p', { class: 'hint', style: 'margin: 0;', text: 'Based on weather data near the property. An inspection confirms damage.' })
      ], 'sr-summary'));
      // Numbers
      var lh = s.largest_hail, sw = s.strongest_wind, ct = s.closest_tornado;
      main.appendChild(card('Last ' + years + ' years within 5 miles', [el('div', { class: 'iq-stats' }, [
        stat('Storm days', s.storm_days != null ? String(s.storm_days) : '—'),
        stat('Hail days', s.hail_days != null ? String(s.hail_days) : '—', s.hail_days_near != null ? s.hail_days_near + ' within 1 mile' : null),
        stat('Wind days', s.wind_days != null ? String(s.wind_days) : '—'),
        stat('Tornado days', s.tornado_days != null ? String(s.tornado_days) : '—'),
        stat('Largest hail', lh ? inch(lh.sizeIn) : '—', lh ? [lh.sizeName, day(lh.date), WHERE[lh.where] || lh.where].filter(Boolean).join(' · ') : null),
        stat('Strongest wind', sw ? mph(sw.mph) : '—', sw ? [day(sw.date), sw.distanceMi != null ? sw.distanceMi + ' mi away' : null].filter(Boolean).join(' · ') : null),
        stat('Closest tornado', ct ? ct.distanceMi + ' mi' : '—', ct ? [ct.efScale, day(ct.date)].filter(Boolean).join(' · ') : null)
      ])]));
      if (r.map_url) main.appendChild(card('Storm map', [el('img', { class: 'sr-map', src: r.map_url, alt: 'Map of storms around the property' })]));
      if (s.hail && s.hail.length) main.appendChild(card('Hail', [table(['Date', 'At property', 'Within 1 mi', 'Within 3 mi', 'Within 5 mi', 'Damage chance'],
        s.hail.map(function (e) { return [day(e.date), inch(e.atPropertyIn), inch(e.within1MiIn), inch(e.within3MiIn), inch(e.within5MiIn), chance(e.damageChance)]; }))]));
      if (s.wind && s.wind.length) main.appendChild(card('Wind', [table(['Date', 'Within 1 mi', 'Within 3 mi', 'Within 5 mi', 'Tornado', 'Damage chance'],
        s.wind.map(function (e) { return [day(e.date), mph(e.within1MiMph), mph(e.within3MiMph), mph(e.within5MiMph), e.tornado ? [e.tornado.efScale, e.tornado.distanceMi + ' mi'].filter(Boolean).join(', ') : '—', chance(e.damageChance)]; }))]));
      if (s.days && s.days.length) main.appendChild(card('Every storm day', [el('ul', { class: 'sr-days' }, s.days.map(function (e) {
        return el('li', {}, [el('div', {}, [el('b', { text: day(e.date) }), el('span', { class: 'sr-haz' }, (e.hazards || []).map(function (h) { return el('span', { class: 'opt-tag', text: cap(h) }); }))]), el('span', { class: 'hint', text: e.evidence || '' })]);
      }))]));
      labelTables(main);
      // PDFs
      var box = $('sr-pdfs'); box.innerHTML = '';
      if (!r.can_download) { box.appendChild(el('p', { class: 'hint', text: 'Ask your company admin for the “Download reports” permission to download the PDFs.' })); return; }
      (o.documents || []).forEach(function (d) {
        box.appendChild(el('button', { type: 'button', class: 'btn pdf-btn', onclick: function (e) { pick(d, e.currentTarget); } }, [
          el('span', { class: 'pdf-btn-top' }, [el('b', { text: d.title }), el('span', { class: 'hint', text: 'PDF' })]),
          el('span', { class: 'hint', text: PDF_INFO[d.template] || '' })
        ]));
      });
    }

    // Each PDF asks for this download's details first (filled in from last time).
    function fetchPdf(template, body, btn) {
      busy(btn, true);
      return api.post('/api/orders/' + encodeURIComponent(id) + '/storm/' + template, body || {})
        .then(function (r) { if (r && r.url) location.href = r.url; return true; })
        .finally(function () { busy(btn, false); });
    }
    function pick(d, btn) {
      tpl = d;
      var det = data.details || {}, needs = !!d.needs_date_of_loss;
      $('sr-dlg-h').textContent = d.title;
      // What prints where (checked against RoofQuery's PDFs): the Homeowner summary has no claim number,
      // and shows the name as "Prepared for".
      var home = d.template === 'homeowner';
      $('sr-dlg-sub').textContent = needs ? 'Enter the date of loss for this PDF.' : home ? 'A page for the homeowner. The name prints as \u201cPrepared for\u201d.' : 'Anything you add is printed on the PDF.';
      $('sr-claim-fld').classList.toggle('hidden', home); // kept as it was: the claim number isn't on this PDF
      $('sr-insured-l').textContent = home ? 'Homeowner name' : 'Insured name';
      $('sr-dol-opt').classList.toggle('hidden', needs);
      $('sr-dol').required = needs;
      $('sr-dol').max = new Date().toISOString().slice(0, 10);
      $('sr-dol').value = det.date_of_loss || ''; $('sr-claim').value = det.claim || ''; $('sr-insured').value = det.insured_name || ''; $('sr-notes').value = det.notes || '';
      $('sr-err').classList.add('hidden');
      $('sr-dlg').showModal();
      (needs && !$('sr-dol').value ? $('sr-dol') : $('sr-go')).focus();
    }
    $('sr-form').addEventListener('submit', function (e) {
      e.preventDefault();
      var body = { date_of_loss: $('sr-dol').value, claim: $('sr-claim').value.trim(), insured_name: $('sr-insured').value.trim(), notes: $('sr-notes').value.trim() };
      if (tpl.needs_date_of_loss && !body.date_of_loss) { $('sr-err').textContent = 'Enter the date of loss.'; $('sr-err').classList.remove('hidden'); $('sr-dol').focus(); return; }
      data.details = body; // filled in next time
      fetchPdf(tpl.template, body, $('sr-go')).then(function () { $('sr-dlg').close(); }).catch(function (x) {
        $('sr-err').textContent = (x && x.message) || 'The PDF couldn’t be downloaded. Try again.'; $('sr-err').classList.remove('hidden');
      });
    });
    function closeDlg() { $('sr-dlg').close(); }
    $('sr-cancel').addEventListener('click', closeDlg); $('sr-dlg-x').addEventListener('click', closeDlg);
    $('sr-dlg').addEventListener('click', function (e) { if (e.target === $('sr-dlg')) closeDlg(); });
  }

  // ---------- Report settings ----------
  function initReportSettings() {
    var fields = document.querySelectorAll('[data-field]');
    function showLogo(url) {
      document.querySelectorAll('.logo-img').forEach(function (img) { if (url) { img.src = url; img.classList.remove('hidden'); } else img.classList.add('hidden'); });
      document.querySelectorAll('.logo-empty').forEach(function (n) { n.classList.toggle('hidden', !!url); });
      $('logo-remove').classList.toggle('hidden', !url);
    }
    $('logo-remove').addEventListener('click', function () {
      if (!window.confirm('Remove your logo? It will no longer appear on your reports.')) return;
      var btn = this; busy(btn, true);
      api.del('/api/company/logo').then(function () { showLogo(null); toast('Logo removed.'); }).catch(showError).then(function () { busy(btn, false); });
    });
    // Brand color + header text color: picker, hex box and buttons stay in step; the preview shows the PDF header.
    var DEFAULT_COLOR = '#B03A0A';
    var picker = $('bc-picker'), hex = $('bc-hex'), band = $('rp-band'), tPicker = $('tc-picker'), tHex = $('tc-hex');
    var col = { bc: '', tc: '' };
    function normHex(v) {
      v = String(v || '').trim().toUpperCase(); if (v && v[0] !== '#') v = '#' + v;
      if (/^#[0-9A-F]{3}$/.test(v)) v = '#' + v[1] + v[1] + v[2] + v[2] + v[3] + v[3];
      return /^#[0-9A-F]{6}$/.test(v) ? v : null;
    }
    function lum(c) {
      var n = parseInt(c.slice(1), 16), ch = [n >> 16 & 255, n >> 8 & 255, n & 255].map(function (x) { x /= 255; return x <= 0.03928 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4); });
      return 0.2126 * ch[0] + 0.7152 * ch[1] + 0.0722 * ch[2];
    }
    function contrast(a, b) { var x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); }
    var DEFAULT_TEXT = '#FFFFFF';
    function showColors(from) {
      var bg = col.bc || DEFAULT_COLOR, fg = col.tc || DEFAULT_TEXT;
      band.style.background = bg; band.style.color = fg;
      if (from !== 'picker') picker.value = bg.toLowerCase();
      if (from !== 'hex') hex.value = col.bc;
      if (from !== 'tpicker') tPicker.value = fg.toLowerCase();
      if (from !== 'thex') tHex.value = col.tc;
      hex.setAttribute('aria-invalid', 'false'); tHex.setAttribute('aria-invalid', 'false');
      document.querySelectorAll('.swatch').forEach(function (b) { b.setAttribute('aria-pressed', String(b.getAttribute('data-color') === bg)); });
      var tcKey = col.tc === DEFAULT_TEXT ? '' : col.tc; // White is the default, saved as empty
      document.querySelectorAll('.seg-btn').forEach(function (b) { b.setAttribute('aria-checked', String(b.getAttribute('data-tc') === tcKey)); });
      var warn = $('tc-warn'), ratio = contrast(bg, fg);
      warn.classList.toggle('hidden', ratio >= 3);
      if (ratio < 3) warn.textContent = 'This text may be hard to read on your brand color.';
    }
    function hexInput(input, key, from) {
      input.addEventListener('input', function () {
        var c = normHex(input.value);
        if (c) { col[key] = c; showColors(from); }
        else if (!input.value.trim()) { col[key] = ''; showColors(from); }
        else input.setAttribute('aria-invalid', 'true');
      });
      input.addEventListener('blur', function () { var c = normHex(input.value); if (c) input.value = c; });
    }
    hexInput(hex, 'bc', 'hex'); hexInput(tHex, 'tc', 'thex');
    picker.addEventListener('input', function () { col.bc = normHex(picker.value) || col.bc; showColors('picker'); });
    tPicker.addEventListener('input', function () { col.tc = normHex(tPicker.value) || col.tc; showColors('tpicker'); });
    document.querySelectorAll('.swatch').forEach(function (b) { b.addEventListener('click', function () { col.bc = b.getAttribute('data-color'); showColors(); }); });
    document.querySelectorAll('.seg-btn').forEach(function (b) { b.addEventListener('click', function () { col.tc = b.getAttribute('data-tc'); showColors(); }); });
    $('bc-reset').addEventListener('click', function () { col.bc = ''; showColors(); });
    function showPreviewText() {
      var v = function (k) { var f = document.querySelector('[data-field="' + k + '"]'); return f ? f.value.trim() : ''; };
      $('rp-name').textContent = v('name') || 'Your company';
      $('rp-contact').textContent = [v('phone'), v('email')].filter(Boolean).join(' · ') || 'Phone · Email';
    }
    fields.forEach(function (f) { f.addEventListener('input', showPreviewText); });

    api.get('/api/company').then(function (r) {
      fields.forEach(function (f) { f.value = r.company[f.getAttribute('data-field')] || ''; });
      showLogo(r.company.logo_url);
      col.bc = normHex(r.company.brand_color) || ''; col.tc = normHex(r.company.brand_text_color) || ''; showColors();
      showPreviewText();
    }).catch(showError);

    $('save-company').addEventListener('click', function () {
      var btn = this, body = {};
      fields.forEach(function (f) { body[f.getAttribute('data-field')] = f.value.trim(); });
      if (body.brand_color && !normHex(body.brand_color)) { showError({ message: 'Enter the brand color as a hex code like #0F7A4D, or pick one.' }); hex.focus(); return; }
      if (body.brand_text_color && !normHex(body.brand_text_color)) { showError({ message: 'Enter the header text color as a hex code like #FFFFFF, or choose White or Black.' }); tHex.focus(); return; }
      body.brand_color = normHex(body.brand_color) || ''; body.brand_text_color = normHex(body.brand_text_color) || '';
      busy(btn, true);
      api.patch('/api/company', body).then(function () { toast('Report settings saved.'); }).catch(showError).then(function () { busy(btn, false); });
    });

    $('logo-input').addEventListener('change', function (e) {
      var f = e.target.files && e.target.files[0];
      e.target.value = '';
      if (!f) return;
      api.upload('/api/company/logo', f).then(function (r) { showLogo(r.logo_url); toast('Logo updated.'); }).catch(showError);
    });
  }

  // ---------- Team & invites ----------
  var PERM_KEYS = { order: 'orders.create', viewAll: 'orders.view_all', download: 'orders.download', branding: 'branding.edit', billing: 'billing.manage', team: 'users.manage' };
  var PRESETS = {
    admin: ['orders.create', 'orders.view_all', 'orders.download', 'branding.edit', 'billing.manage', 'users.manage'],
    manager: ['orders.create', 'orders.view_all', 'orders.download', 'branding.edit'],
    estimator: ['orders.create', 'orders.download'],
    viewer: ['orders.download']
  };
  var PRESET_LABEL = { admin: 'Admin', manager: 'Manager', estimator: 'Estimator', viewer: 'Viewer', custom: 'Custom' };

  function initTeam() {
    var roleBtns = document.querySelectorAll('.role'), boxes = document.querySelectorAll('[data-perm]');
    var preset = 'estimator', editing = null, members = [];

    function setPreset(p) {
      preset = p;
      roleBtns.forEach(function (b) { b.setAttribute('aria-pressed', b.getAttribute('data-role') === p ? 'true' : 'false'); });
      if (PRESETS[p]) {
        boxes.forEach(function (box) { box.checked = PRESETS[p].indexOf(PERM_KEYS[box.getAttribute('data-perm')]) !== -1; });
        $('role-note').textContent = 'Pick a role to fill in permissions, then adjust any box below.';
      } else {
        $('role-note').textContent = 'Custom permissions — you changed the role defaults.';
      }
    }
    function chosenPerms() {
      var out = [];
      boxes.forEach(function (box) { if (box.checked) out.push(PERM_KEYS[box.getAttribute('data-perm')]); });
      return out;
    }
    function presetFor(perms) {
      var key = perms.slice().sort().join(',');
      return Object.keys(PRESETS).filter(function (k) { return PRESETS[k].slice().sort().join(',') === key; })[0] || 'custom';
    }
    roleBtns.forEach(function (b) { b.addEventListener('click', function () { setPreset(b.getAttribute('data-role')); }); });
    boxes.forEach(function (box) { box.addEventListener('change', function () { setPreset(presetFor(chosenPerms())); }); });

    function formError(msg) { var e = $('inv-error'); e.textContent = msg || ''; e.classList.toggle('hidden', !msg); }
    $('inv-em').addEventListener('input', function () { formError(''); });

    function resetForm() {
      editing = null;
      $('inv-h').textContent = 'Invite employees';
      $('send-label').textContent = 'Send invites';
      $('cancel-edit').classList.add('hidden');
      $('inv-note').classList.remove('hidden');
      ['inv-em', 'inv-fn', 'inv-ti'].forEach(function (id) { $(id).value = ''; $(id).disabled = false; });
      formError(''); setPreset('estimator');
    }
    function startEdit(m) {
      editing = m;
      $('inv-h').textContent = 'Edit ' + m.full_name;
      $('send-label').textContent = 'Save changes';
      $('cancel-edit').classList.remove('hidden');
      $('inv-note').classList.add('hidden');
      $('inv-em').value = m.email; $('inv-em').disabled = true;
      $('inv-fn').value = m.full_name; $('inv-fn').disabled = true;
      $('inv-ti').value = m.job_title || '';
      boxes.forEach(function (box) { box.checked = m.permissions.indexOf(PERM_KEYS[box.getAttribute('data-perm')]) !== -1; });
      setPreset(PRESETS[m.preset] && presetFor(m.permissions) === m.preset ? m.preset : presetFor(m.permissions));
      formError('');
      $('inv-h').scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
    $('cancel-edit').addEventListener('click', resetForm);

    $('send-invites').addEventListener('click', function () {
      var btn = this, perms = chosenPerms();
      var common = { preset: preset, permissions: perms, job_title: $('inv-ti').value.trim() };
      if (editing) {
        busy(btn, true);
        api.patch('/api/team/' + editing.id, common).then(function () {
          toast('Saved changes for ' + editing.full_name + '.'); resetForm(); loadTeam();
        }).catch(function (e) { formError(e.message); }).then(function () { busy(btn, false); });
        return;
      }
      var emails = $('inv-em').value.split(/[,;\s]+/).map(function (s) { return s.trim(); }).filter(Boolean);
      if (!emails.length) { formError('Enter at least one email address.'); $('inv-em').focus(); return; }
      busy(btn, true);
      api.post('/api/invites', Object.assign({ emails: emails, full_name: $('inv-fn').value.trim() }, common)).then(function (r) {
        var unsent = r.invites.filter(function (i) { return i.invite_url && i.email_sent === false; });
        if (unsent.length) { showInviteLinks(unsent); toast(unsent.length === 1 ? 'Invite created. Email isn\u2019t connected yet, so share the link below.' : unsent.length + ' invites created. Share the links below.'); }
        else toast(r.invites.length === 1 ? 'Invite sent to ' + r.invites[0].email + '.' : r.invites.length + ' invites sent.');
        resetForm(); loadTeam();
      }).catch(function (e) { formError(e.message); }).then(function () { busy(btn, false); });
    });

    // Until SendGrid is connected, invite emails aren't sent: show the links so they can be shared by hand.
    function showInviteLinks(list) {
      var box = $('invite-links');
      if (!box) {
        box = el('div', { id: 'invite-links', class: 'invite-links', 'aria-live': 'polite' });
        $('send-invites').closest('section').appendChild(box);
      }
      box.innerHTML = '';
      box.appendChild(el('h3', { text: 'Invite links to share' }));
      box.appendChild(el('p', { class: 'hint', text: 'Email isn\u2019t connected yet, so these weren\u2019t emailed. Send each person their own link. Each link works once, for that email address only.' }));
      list.forEach(function (i) {
        var input = el('input', { type: 'text', readonly: true, value: i.invite_url, 'aria-label': 'Invite link for ' + i.email });
        box.appendChild(el('div', { class: 'fld' }, [
          el('label', { text: i.email }),
          el('div', { class: 'link-row' }, [input,
            el('button', { type: 'button', class: 'btn', text: 'Copy', onclick: function () {
              input.select();
              (navigator.clipboard ? navigator.clipboard.writeText(i.invite_url) : Promise.reject()).then(function () { toast('Link copied.'); }, function () { document.execCommand('copy'); toast('Link copied.'); });
            } })])
        ]));
      });
      box.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }

    function accessText(perms, isOwner) {
      if (isOwner) return 'All';
      var parts = [];
      if (perms.indexOf('branding.edit') !== -1) parts.push('Report settings');
      if (perms.indexOf('billing.manage') !== -1) parts.push('Billing');
      if (perms.indexOf('users.manage') !== -1) parts.push('Team');
      return parts.length ? parts.join(', ') : '—';
    }
    function orderText(perms) { return perms.indexOf('orders.create') === -1 ? '—' : 'Yes'; }
    function avatar(name, url) {
      return url ? el('img', { class: 'avatar', src: url, alt: '' }) : el('span', { class: 'avatar', text: name ? initials(name) : '?' });
    }

    function memberRow(m) {
      var isOwner = m.role === 'owner', isMe = m.id === ME.user.id;
      var actions = el('td', {});
      if (isOwner || isMe) actions.appendChild(el('span', { class: 'hint', text: isMe ? 'You' : 'Owner' }));
      else {
        actions.appendChild(el('button', { type: 'button', class: 'linkbtn', text: 'Edit permissions', onclick: function () { startEdit(m); } }));
        actions.appendChild(el('button', { type: 'button', class: 'linkbtn danger', text: 'Remove', onclick: function () {
          if (!window.confirm('Remove ' + m.full_name + ' from the team? They’ll lose access right away.')) return;
          api.del('/api/team/' + m.id).then(function () { toast(m.full_name + ' was removed from the team.'); if (editing && editing.id === m.id) resetForm(); loadTeam(); }).catch(showError);
        } }));
      }
      return el('tr', { 'data-member': m.id }, [
        el('td', {}, [el('div', { class: 'member' }, [avatar(m.full_name, m.avatar_url), el('span', {}, [el('b', { text: m.full_name }), el('br'), el('span', { class: 'hint', text: m.email })])])]),
        el('td', { text: isOwner ? 'Owner' : (PRESET_LABEL[m.preset] || 'Custom') }),
        el('td', { text: orderText(m.permissions) }),
        el('td', { text: accessText(m.permissions, isOwner) }),
        el('td', {}, [el('span', { class: 'pill active', text: 'Active' })]),
        actions
      ]);
    }
    function inviteRow(i) {
      var expired = i.status === 'expired';
      return el('tr', { 'data-invite': i.id }, [
        el('td', {}, [el('div', { class: 'member' }, [avatar(null), el('span', {}, [el('b', { text: i.full_name || 'Invite sent' }), el('br'), el('span', { class: 'hint', text: i.email })])])]),
        el('td', { text: PRESET_LABEL[i.preset] || 'Custom' }),
        el('td', { text: orderText(i.permissions) }),
        el('td', { text: accessText(i.permissions, false) }),
        el('td', {}, [el('span', { class: 'pill ' + (expired ? 'failed' : 'pending'), text: expired ? 'Expired' : 'Pending' }), expired ? null : el('span', { class: 'hint inv-expires', text: 'Expires ' + fmtDate(i.expires_at) })]),
        el('td', {}, [
          el('button', { type: 'button', class: 'linkbtn', text: 'Resend', onclick: function () {
            api.post('/api/invites/' + i.id + '/resend').then(function (r) {
              if (r.invite && r.invite.invite_url && r.invite.email_sent === false) { showInviteLinks([r.invite]); toast('New link made for ' + i.email + '. Share it below.'); }
              else toast('Invite resent to ' + i.email + '.');
              loadTeam();
            }).catch(showError);
          } }),
          el('button', { type: 'button', class: 'linkbtn danger', text: 'Revoke', onclick: function () {
            if (!window.confirm('Revoke the invite for ' + i.email + '?')) return;
            api.del('/api/invites/' + i.id).then(function () { toast('Invite for ' + i.email + ' revoked.'); loadTeam(); }).catch(showError);
          } })
        ])
      ]);
    }
    function loadTeam() {
      return api.get('/api/team').then(function (r) {
        members = r.members;
        var tbody = $('member-rows');
        tbody.innerHTML = '';
        r.members.forEach(function (m) { tbody.appendChild(memberRow(m)); });
        r.invites.forEach(function (i) { tbody.appendChild(inviteRow(i)); });
        labelTables(tbody.closest('.table-wrap'));
        var people = r.counts.members, pend = r.counts.pending_invites;
        $('team-counts').textContent = people + (people === 1 ? ' person' : ' people') + ' · ' + pend + ' pending';
        $('team-size').textContent = people + (people === 1 ? ' member' : ' members');
        $('team-pending').textContent = pend ? pend + (pend === 1 ? ' invite pending' : ' invites pending') : 'No pending invites';
      }).catch(showError);
    }
    resetForm();
    loadTeam();
  }

  // ---------- Account ----------
  // Account page: each item in the side list shows its own section (#profile, #billing, #team, …).
  var ACCT_NEEDS = { billing: 'billing.manage', 'report-settings': 'branding.edit', team: 'users.manage' };
  // ok: which sections this person may open. Before we know (page still loading), any section shows.
  function showAccountTab(ok) {
    var links = document.querySelectorAll('[data-side]');
    var want = location.hash.slice(1), tab = (ok ? ok[want] : document.querySelector('[data-panel="' + want + '"]')) ? want : 'profile';
    links.forEach(function (a) {
      var on = a.getAttribute('data-side') === tab;
      a.classList.toggle('current', on);
    });
    document.querySelectorAll('[data-panel]').forEach(function (p) { p.classList.toggle('hidden', p.getAttribute('data-panel') !== tab); });
    $('acct-save-bar').classList.toggle('hidden', tab !== 'profile');
    $('acct-signout').classList.toggle('hidden', tab !== 'profile');
    window.scrollTo(0, 0);
  }
  function setupAccountTabs() {
    var ok = {};
    document.querySelectorAll('[data-side]').forEach(function (a) {
      var key = a.getAttribute('data-side'), need = ACCT_NEEDS[key];
      ok[key] = !need || can(need);
      if (!ok[key]) a.classList.add('hidden');
    });
    window.removeEventListener('hashchange', earlyTab);
    window.addEventListener('hashchange', function () { showAccountTab(ok); });
    showAccountTab(ok);
  }
  function earlyTab() { showAccountTab(null); }

  function initAccount() {
    var me = ME.user;
    function fill(u) {
      var parts = (u.full_name || '').split(' ');
      $('fn').value = parts.shift() || ''; $('ln').value = parts.join(' ');
      $('ti').value = u.job_title || ''; $('em').value = u.email || ''; $('em').disabled = true;
      if (u.timezone) $('tz').value = u.timezone;
    }
    fill(me);
    $('org').value = ME.company.name;
    // People who edit the company see its name under Company & branding; everyone else sees it here, locked.
    if (can('branding.edit')) $('org-card').classList.add('hidden');
    $('em').setAttribute('title', 'Your sign-in email. It can be changed from the sign-in settings.');

    $('acct-cancel').addEventListener('click', function () { fill(me); toast('Changes discarded.'); });
    $('acct-save').addEventListener('click', function () {
      var btn = this, name = ($('fn').value.trim() + ' ' + $('ln').value.trim()).trim();
      busy(btn, true);
      api.patch('/api/me', { full_name: name, job_title: $('ti').value.trim(), timezone: $('tz').value })
        .then(function (r) { me = r.user; ME.user = r.user; toast('Your profile is saved.'); }).catch(showError).then(function () { busy(btn, false); });
    });
    $('sign-out').addEventListener('click', signOut);

    if (!can('billing.manage')) { $('billing').classList.add('hidden'); $('nav-billing').classList.add('hidden'); return; }
    function goTo(path, body) {
      return api.post(path, body || {}).then(function (r) { if (r.url) location.href = r.url; else toast(r.message || 'That isn\u2019t available yet.'); }).catch(showError);
    }
    function loadBilling() {
      return api.get('/api/billing').then(function (b) {
        var s = b.subscription || {}, plans = b.plans || { monthly_cents: 10000, yearly_cents: 100000 };
        var actions = $('bill-plan-actions'); actions.innerHTML = '';
        var perMo = function (c) { return money(c).replace('.00', ''); };
        if (b.free_account) {
          $('bill-plan').textContent = 'Free account';
          $('bill-plan-detail').textContent = 'Every report and add-on is free, with subscriber features included. Nothing is charged.';
        } else if (s.status === 'active' && s.trial_ends_at) {
          $('bill-plan').textContent = 'Free trial';
          $('bill-plan-detail').textContent = 'Subscriber prices on every report \u00b7 ' + (s.cancel_at_period_end ? 'ends ' + fmtDate(s.trial_ends_at) + ', no charge' : 'ends ' + fmtDate(s.trial_ends_at) + ', then ' + perMo(s.price_cents) + (s.plan === 'yearly' ? '/year' : '/month'));
          actions.appendChild(el('button', { type: 'button', class: 'btn', text: 'Manage subscription', onclick: function () { goTo('/api/billing/portal'); } }));
        } else if (s.status === 'active') {
          $('bill-plan').textContent = (s.plan === 'yearly' ? 'Yearly' : 'Monthly') + ' \u00b7 ' + money(s.price_cents).replace('.00', '') + (s.plan === 'yearly' ? '/year' : '/month');
          $('bill-plan-detail').textContent = 'Subscriber prices on every report \u00b7 ' + (s.cancel_at_period_end ? 'ends ' : 'renews ') + fmtDate(s.renews_at);
          actions.appendChild(el('button', { type: 'button', class: 'btn', text: 'Manage subscription', onclick: function () { goTo('/api/billing/portal'); } }));
        } else {
          var trial = b.trial_eligible && b.trial_days;
          $('bill-plan').textContent = trial ? 'Try it free for ' + b.trial_days + ' days' : 'Pay per report';
          $('bill-plan-detail').textContent = s.status === 'past_due' ? 'Your last subscription payment failed. Update your card on the billing page.'
            : trial ? 'Subscriber prices on every report, no subscription charge for ' + b.trial_days + ' days. Your plan starts after the trial unless you cancel.'
            : 'Subscribe to get lower prices on every report.';
          var lead = trial ? 'Start free trial \u00b7 ' : '';
          // With a card already saved, confirm here and start on that card; otherwise Stripe's page asks for one.
          var start = function (plan) { if (b.card) openSub(b, plan, plans); else goTo('/api/billing/subscribe', { plan: plan }); };
          actions.appendChild(el('button', { type: 'button', class: 'btn', text: lead + 'Monthly \u00b7 ' + perMo(plans.monthly_cents) + '/mo' + (trial ? ' after' : ''), onclick: function () { start('monthly'); } }));
          actions.appendChild(el('button', { type: 'button', class: 'btn btn-dark', text: lead + 'Yearly \u00b7 ' + perMo(plans.yearly_cents) + '/yr' + (trial ? ' after' : ''), onclick: function () { start('yearly'); } }));
        }
        $('bill-count').textContent = b.reports_this_month;
        $('bill-spend').textContent = money(b.spend_this_month_cents);
        $('bill-free').textContent = b.free_reports_remaining;
        $('bill-free').parentNode.classList.toggle('hidden', !b.free_reports_remaining); // only while some are left
        $('bill-card').textContent = b.card ? b.card.brand + ' ending in ' + b.card.last4 : 'No card saved';
        $('bill-card-exp').textContent = b.card ? 'Expires ' + b.card.exp : 'Add a card to order paid reports without re-entering it.';
        $('bill-card-btn').textContent = b.card ? 'Update card' : 'Add a card';
        $('bem').value = b.billing_email || ''; $('bad').value = b.billing_address || '';
        var tbody = $('invoice-rows');
        tbody.innerHTML = '';
        if (!b.invoices.length) tbody.appendChild(el('tr', {}, [el('td', { colspan: '4', class: 'hint', style: 'padding-left: 0;', text: 'No charges yet.' })]));
        b.invoices.forEach(function (inv) {
          tbody.appendChild(el('tr', {}, [
            el('td', { style: 'padding-left: 0;', text: fmtDate(inv.date) }),
            el('td', { text: inv.description }),
            el('td', { text: money(inv.amount_cents) }),
            el('td', { style: 'padding-right: 0;' }, [inv.receipt_url
              ? el('a', { href: inv.receipt_url, target: '_blank', rel: 'noopener', class: 'linkbtn', text: 'Receipt' })
              : el('button', { type: 'button', class: 'linkbtn', text: 'Receipt', 'data-portal': true })])
          ]));
        });
        labelTables($('billing'));
      }).catch(showError);
    }
    // Start a plan on the saved card: say what happens and what it costs, then start it with no Stripe page.
    var subPlan = null;
    function openSub(b, plan, plans) {
      var trial = b.trial_eligible && b.trial_days, cents = plan === 'yearly' ? plans.yearly_cents : plans.monthly_cents, per = plan === 'yearly' ? '/year' : '/month';
      var card = b.card.brand + ' ending in ' + b.card.last4, then = new Date(Date.now() + (trial || 0) * 86400000);
      subPlan = plan;
      $('sub-dlg-h').textContent = trial ? 'Start your free trial' : 'Start your subscription';
      $('sub-dlg-sub').textContent = (plan === 'yearly' ? 'Yearly' : 'Monthly') + ' plan \u00b7 ' + money(cents) + per;
      $('sub-dlg-text').textContent = trial
        ? 'Subscriber prices on every report, free for ' + b.trial_days + ' days. Then ' + money(cents) + per + ' on your ' + card + ', starting ' + fmtDate(then.toISOString()) + '.'
        : 'Subscriber prices on every report, ' + money(cents) + per + ' on your ' + card + '.';
      $('sub-total').textContent = money(trial ? 0 : cents);
      $('sub-note').textContent = trial ? 'Cancel any time before ' + fmtDate(then.toISOString()) + ' and you won\u2019t be charged.' : 'Renews automatically. Cancel any time.';
      $('sub-go').textContent = trial ? 'Start free trial' : 'Subscribe \u00b7 ' + money(cents);
      $('sub-err').classList.add('hidden');
      $('sub-dlg').showModal();
    }
    function closeSub() { $('sub-dlg').close(); }
    $('sub-cancel').addEventListener('click', closeSub); $('sub-dlg-x').addEventListener('click', closeSub);
    $('sub-form').addEventListener('submit', function (e) {
      e.preventDefault();
      var btn = $('sub-go'); busy(btn, true);
      api.post('/api/billing/subscribe', { plan: subPlan, use_saved_card: true }).then(function (r) {
        if (r.url) { location.href = r.url; return; } // the bank wants to confirm: Stripe's page
        closeSub();
        toast(r.trial_days ? 'Free trial started. Subscriber prices apply to your next order.' : 'Subscription started. Subscriber prices apply to your next order.');
        loadBilling();
      }).catch(function (x) { $('sub-err').textContent = (x && x.message) || 'That didn\u2019t work. Try again.'; $('sub-err').classList.remove('hidden'); })
        .then(function () { busy(btn, false); });
    });
    loadBilling();
    $('bill-card-btn').addEventListener('click', function () { goTo('/api/billing/card'); });
    $('billing').addEventListener('click', function (e) {
      if (e.target.closest('[data-portal]')) goTo('/api/billing/portal');
    });
    // Back from a Stripe page: Stripe tells our server a moment later, so refresh shortly after.
    var back = new URLSearchParams(location.search);
    if (back.has('card') || back.has('subscribed') || back.has('trial')) {
      toast(back.has('card') ? 'Card saved. It can take a few seconds to show here.' : back.has('trial') ? 'Free trial started. Subscriber prices apply to your next order.' : 'Subscription started. Subscriber prices apply to your next order.');
      setTimeout(loadBilling, 2500); setTimeout(loadBilling, 7000);
      history.replaceState(null, '', location.pathname + location.hash);
    }
  }

  // ---------- visitors without an account (order page only) ----------
  function isGuest() {
    if (page !== 'order' || !api) return false;
    if (api.mode === 'live') return !(RS.auth && RS.auth.signedIn());
    return new URLSearchParams(location.search).has('guest'); // sample data: ?guest shows the visitor view
  }
  function setupGuest() {
    document.body.classList.add('guest');
    RS.guest = true;
    var next = encodeURIComponent('order.html');
    var nav = document.querySelector('.topnav');
    if (nav) {
      nav.innerHTML = '';
      nav.appendChild(el('a', { href: 'index.html#reports', text: 'Our reports' }));
      nav.appendChild(el('a', { href: 'signin.html?next=' + next, text: 'Sign in' }));
      nav.appendChild(el('a', { href: 'signin.html?step=signup&next=' + next, class: 'nav-cta', text: 'Create free account' }));
    }
    var bar = document.querySelector('.tabbar');
    if (bar) bar.remove();
    var brand = document.querySelector('.topbar .brand');
    if (brand && brand.tagName !== 'A') {
      var link = el('a', { href: 'index.html', class: 'brand', 'aria-label': 'Rapid Squares home' });
      while (brand.firstChild) link.appendChild(brand.firstChild);
      brand.replaceWith(link);
    }
  }

  RS.ui = { toast: toast, showError: showError, el: el, money: money, can: can };

  // ---------- start ----------
  if (page === 'order' && /[?&]embed=1/.test(location.search)) { document.documentElement.classList.add('embed'); document.body.classList.add('embed'); RS.embed = true; }
  labelTables();
  // Show what we already know before the server answers, so pages don't pop in.
  if ($('side-signout')) $('side-signout').addEventListener('click', signOut);
  try { showSignedIn(localStorage.getItem(EMAIL_KEY)); } catch (_) { /* storage blocked */ }
  if (page === 'account') { earlyTab(); window.addEventListener('hashchange', earlyTab); }
  if (!api) return;
  if (isGuest()) { setupGuest(); document.dispatchEvent(new CustomEvent('rs:ready', { detail: null })); return; }
  if (api.mode === 'live' && !(RS.auth && RS.auth.signedIn())) { RS.auth.toSignIn(); return; }
  if (page === 'order' && !RS.embed) {
    // Signed-in people order from Home now; this page is only for visitors without an account.
    var fwd = new URLSearchParams(location.search), to = 'orders.html?order=1';
    ['address', 'resume'].forEach(function (k) { if (fwd.get(k)) to += '&' + k + '=' + encodeURIComponent(fwd.get(k)); });
    location.replace(to);
    return;
  }
  api.get('/api/me').then(function (me) {
    ME = me;
    RS.me = me;
    replaceCompanyName(me.company.name);
    setupNav();
    showSignedIn(me.user.email);
    if (!guardPage()) return;
    if (page === 'reports') initReports();
    else if (page === 'storm-report') initStorm();
    else if (page === 'report') initReport();
    else if (page === 'account') {
      if (can('branding.edit')) initReportSettings();
      if (can('users.manage')) initTeam();
      initAccount();
      setupAccountTabs();
    }
    document.dispatchEvent(new CustomEvent('rs:ready', { detail: me }));
  }).catch(showError);
})();
