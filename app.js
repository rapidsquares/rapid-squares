// Rapid Squares — page behavior.
// Every page loads the signed-in user (GET /api/me) first, then its own data through RS.api.
// In sample-data mode the answers come from mock-api.js; later from the real Node.js backend.
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

  function replaceCompanyName(name) {
    var walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    var nodes = [];
    while (walker.nextNode()) if (walker.currentNode.nodeValue.indexOf('[Company Name]') !== -1) nodes.push(walker.currentNode);
    nodes.forEach(function (n) { n.nodeValue = n.nodeValue.split('[Company Name]').join(name); });
  }

  // ---------- navigation by permission ----------
  var NEEDS = { 'new-sketch.html': 'orders.create', 'report-settings.html': 'branding.edit', 'team.html': 'users.manage' };
  var PAGE_NEEDS = { 'new-sketch': ['orders.create', 'Order reports'], 'report-settings': ['branding.edit', 'Edit report settings'], 'team': ['users.manage', 'Manage team'] };
  function setupNav() {
    document.querySelectorAll('.topnav a, .tabbar a, a.btn-primary').forEach(function (a) {
      var perm = NEEDS[a.getAttribute('href')];
      if (perm && !can(perm)) a.classList.add('hidden');
    });
  }
  function guardPage() {
    var need = PAGE_NEEDS[page];
    if (!need || can(need[0])) return true;
    var main = document.querySelector('main');
    main.innerHTML = '';
    main.appendChild(el('section', { class: 'card no-access' }, [
      el('h1', { text: 'You don’t have access to this page', style: 'font-size: 26px;' }),
      el('p', { class: 'lede', text: 'This page needs the “' + need[1] + '” permission. Ask your company admin to turn it on for you.' }),
      el('div', { class: 'actions' }, [el('a', { href: 'orders.html', class: 'btn btn-primary', text: 'Go to Order history' })])
    ]));
    return false;
  }

  // ---------- sample-data switcher (only when running on sample data) ----------
  function setupSampleSwitcher() {
    if (!api || api.mode !== 'sample' || !RS.mock) return;
    var users = RS.mock.users(), current = RS.mock.currentUserId();
    var LABEL = { admin: 'Admin', manager: 'Manager', estimator: 'Estimator', viewer: 'Viewer', custom: 'Custom' };
    var select = el('select', { id: 'demo-user', onchange: function () { RS.mock.switchUser(select.value); location.reload(); } },
      users.map(function (u) {
        return el('option', { value: u.id, selected: u.id === current, text: u.name + ' · ' + (u.role === 'owner' ? 'Owner' : (LABEL[u.preset] || 'Custom')) });
      }));
    var details = el('details', { class: 'demo' }, [
      el('summary', { text: 'Sample data' }),
      el('div', { class: 'demo-panel' }, [
        el('p', { text: 'This site is running on sample data saved in this browser. Nothing is sent anywhere.' }),
        el('div', { class: 'fld' }, [el('label', { for: 'demo-user', text: 'View the site as' }), select]),
        el('button', { type: 'button', class: 'btn', id: 'demo-reset', text: 'Reset sample data', onclick: function () {
          if (window.confirm('Reset all sample data back to the start? Your changes in this browser will be lost.')) { RS.mock.reset(); location.reload(); }
        } })
      ])
    ]);
    document.querySelector('.topbar').appendChild(details);
  }

  // ---------- Order history ----------
  var STATUS = {
    pending: ['ordered', 'Ordered'], awaiting_payment: ['ordered', 'Awaiting payment'], in_progress: ['processing', 'Processing'],
    needs_info: ['needs', 'Needs info'], delivered: ['ready', 'Ready'], failed: ['failed', 'Failed'], cancelled: ['cancelled', 'Cancelled']
  };
  function initReports() {
    var FILTERS = { all: '', ready: 'delivered', processing: 'in_progress', ordered: 'pending,awaiting_payment', needs: 'needs_info' };
    var state = { filter: 'all', q: '', page: 1, esxPrice: 500, canBuyEsx: false }, timer = null, refresh = null;
    var tbody = $('report-rows'), tabs = document.querySelectorAll('.tab');

    tabs.forEach(function (t) {
      t.addEventListener('click', function () {
        state.filter = t.getAttribute('data-filter'); state.page = 1;
        tabs.forEach(function (x) { x.setAttribute('aria-selected', x === t ? 'true' : 'false'); });
        load();
      });
    });
    $('q').addEventListener('input', function () {
      clearTimeout(timer);
      timer = setTimeout(function () { state.q = $('q').value.trim(); state.page = 1; load(); }, 250);
    });
    $('prev-page').addEventListener('click', function () { state.page--; load(); });
    $('next-page').addEventListener('click', function () { state.page++; load(); });

    function load() {
      var qs = new URLSearchParams({ page: state.page, page_size: 10 });
      if (FILTERS[state.filter]) qs.set('status', FILTERS[state.filter]);
      if (state.q) qs.set('q', state.q);
      return api.get('/api/orders?' + qs.toString()).then(render).catch(showError);
    }

    function render(data) {
      if (data.esx_price_cents != null) state.esxPrice = data.esx_price_cents;
      state.canBuyEsx = !!data.can_buy_esx;
      var c = data.counts || {};
      var n = { all: c.all || 0, ready: c.delivered || 0, processing: c.in_progress || 0, ordered: (c.pending || 0) + (c.awaiting_payment || 0), needs: c.needs_info || 0 };
      tabs.forEach(function (t) { t.querySelector('.count').textContent = n[t.getAttribute('data-filter')]; });
      $('scope-note').classList.toggle('hidden', data.scope !== 'mine');

      tbody.innerHTML = '';
      data.orders.forEach(function (o) { tbody.appendChild(orderRow(o)); });
      labelTables(tbody.closest('table').parentNode);

      var empty = $('no-results');
      empty.classList.toggle('hidden', data.total !== 0);
      if (data.total === 0) {
        empty.innerHTML = '';
        if (state.q || state.filter !== 'all') empty.textContent = 'No reports match.';
        else {
          empty.appendChild(document.createTextNode('No reports yet. '));
          if (can('orders.create')) empty.appendChild(el('a', { href: 'new-sketch.html', text: 'Order your first report' }));
        }
      }
      var from = data.total ? (data.page - 1) * data.page_size + 1 : 0, to = Math.min(data.total, data.page * data.page_size);
      $('showing').textContent = data.total ? 'Showing ' + from + '–' + to + ' of ' + data.total + ' reports' : '';
      $('prev-page').disabled = data.page <= 1;
      $('next-page').disabled = to >= data.total;

      // Sample orders move along on their own; check again while any are in progress.
      clearTimeout(refresh);
      if (data.orders.some(function (o) { return o.status === 'pending' || o.status === 'in_progress'; })) refresh = setTimeout(load, 10000);
    }

    // Buy the ESX file after the fact: charged to the saved card (or Stripe's page), then it downloads.
    function buyEsx(o, btn) {
      if (!window.confirm('Buy the Xactimate (ESX) file for ' + o.report_number + ' for ' + money(state.esxPrice) + '? It\u2019s charged to the card on file and downloads right away.')) return;
      btn.disabled = true;
      api.post('/api/orders/' + o.id + '/buy-esx', {}).then(function (r) {
        if (r.checkout_url) { location.href = r.checkout_url; return; }
        toast('ESX file added to ' + o.report_number + (r.url ? '. Downloading now.' : '.'));
        if (r.url) location.href = r.url;
        load();
      }).catch(function (e) { btn.disabled = false; showError(e); });
    }
    // The server hands back a short-lived link; opening it starts the download.
    function download(id, kind) {
      api.get('/api/orders/' + id + '/' + kind).then(function (r) { if (r && r.url) location.href = r.url; }).catch(showError);
    }
    function orderRow(o) {
      var addr = splitAddress(o.address), s = STATUS[o.status] || ['cancelled', o.status];
      var detail = o.total_squares != null ? o.total_squares + ' squares · ' + o.predominant_pitch + ' pitch' : '';
      var actions = el('td', {});
      if (o.status === 'delivered') {
        if (can('orders.download')) {
          actions.appendChild(el('button', { type: 'button', class: 'linkbtn', text: 'Download PDF', onclick: function () { download(o.id, 'pdf'); } }));
          if (o.esx_purchased) actions.appendChild(el('button', { type: 'button', class: 'linkbtn', text: 'ESX file', onclick: function () { download(o.id, 'esx'); } }));
        }
        if (o.esx_available && state.canBuyEsx && can('orders.create')) actions.appendChild(el('button', { type: 'button', class: 'linkbtn', text: 'Buy ESX · ' + money(state.esxPrice), onclick: function (e) { buyEsx(o, e.currentTarget); } }));
      } else if (o.status === 'needs_info') {
        if (can('orders.create')) actions.appendChild(el('button', { type: 'button', class: 'linkbtn', text: 'Add details', onclick: function () { api.post('/api/orders/' + o.id + '/details', {}).catch(showError); } }));
      } else if (o.eta) {
        actions.appendChild(el('span', { class: 'hint', text: 'Ready by ' + fmtTime(o.eta) }));
      } else if (o.status === 'failed') {
        actions.appendChild(el('span', { class: 'hint', text: (o.status_detail || 'Couldn’t be measured') + (o.refunded ? ' · Refunded' : '') }));
      }
      return el('tr', { 'data-status': o.status, 'data-id': o.id }, [
        el('td', { class: 'mono', style: 'font-size: 13px;', text: o.report_number }),
        el('td', { class: 'lead' }, [el('b', { text: addr[0] }), el('br'), el('span', { class: 'hint', text: addr[1] })]),
        el('td', {}, [el('span', {}, [o.product_label + (o.esx_purchased ? ' + ESX' : ''), detail ? el('br') : null, detail ? el('span', { class: 'hint', text: detail }) : null])]),
        el('td', {}, [el('span', {}, [fmtDate(o.created_at), el('br'), el('span', { class: 'hint', text: 'by ' + o.ordered_by_name })])]),
        el('td', {}, [el('span', { class: 'pill ' + s[0], text: s[1] })]),
        actions
      ]);
    }
    load();
    // Free trial prompt for companies that haven't used theirs (people who can manage billing only).
    if (can('billing.manage')) api.get('/api/products').then(function (pr) {
      if (pr.trial_eligible && pr.trial_days && !pr.subscribed) { $('tb-days').textContent = pr.trial_days; $('trial-banner').classList.remove('hidden'); }
    }).catch(function () { /* the banner is optional */ });
    setupQuickOrder(function () { state.page = 1; load(); });
    var back = new URLSearchParams(location.search);
    if (back.get('paid')) { toast('Payment received for ' + back.get('paid') + '. Your order is placed.'); setTimeout(load, 2500); }
    else if (back.get('esx')) { toast('ESX file bought for ' + back.get('esx') + '. Use “ESX file” to download it.'); setTimeout(load, 2500); }
    else if (back.get('unpaid') && back.get('for') === 'esx') toast('Payment wasn\u2019t finished, so the ESX file for ' + back.get('unpaid') + ' wasn\u2019t bought.', { error: true });
    else if (back.get('unpaid')) toast('Payment wasn\u2019t finished, so ' + back.get('unpaid') + ' wasn\u2019t placed. Order again when you\u2019re ready.', { error: true });
    if (back.get('paid') || back.get('unpaid') || back.get('esx')) history.replaceState(null, '', location.pathname);
  }

  // "Order new report" opens the Place order page inside a pop-up instead of leaving Order history.
  function setupQuickOrder(onOrdered) {
    var btn = document.querySelector('.page-head a[href="new-sketch.html"]');
    if (!btn) return;
    var dlg = null;
    function open() {
      if (!dlg) {
        var frame = el('iframe', { src: 'new-sketch.html?embed=1', title: 'Order a new report', class: 'qo-frame' });
        dlg = el('dialog', { class: 'modal qo', 'aria-label': 'Order a new report' }, [
          el('div', { class: 'qo-head' }, [
            el('h2', { text: 'Order a new report' }),
            el('button', { type: 'button', class: 'modal-x', 'aria-label': 'Close', onclick: function () { dlg.close(); } }, [])
          ]),
          frame
        ]);
        dlg.querySelector('.modal-x').innerHTML = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>';
        dlg.addEventListener('click', function (e) { if (e.target === dlg) dlg.close(); });
        document.body.appendChild(dlg);
      } else {
        dlg.querySelector('iframe').src = 'new-sketch.html?embed=1'; // fresh start each time
      }
      dlg.showModal();
    }
    btn.addEventListener('click', function (e) {
      if (e.ctrlKey || e.metaKey || e.shiftKey || !window.HTMLDialogElement) return; // new tab / old browser: go to the page
      e.preventDefault(); open();
    });
    window.addEventListener('message', function (e) {
      if (e.origin !== location.origin || !e.data || e.data.type !== 'rs:ordered') return;
      if (dlg && dlg.open) dlg.close();
      toast('Ordered ' + e.data.report_number + ' · ' + e.data.label + '.');
      onOrdered();
    });
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
  function initAccount() {
    var me = ME.user;
    function fill(u) {
      var parts = (u.full_name || '').split(' ');
      $('fn').value = parts.shift() || ''; $('ln').value = parts.join(' ');
      $('ti').value = u.job_title || ''; $('em').value = u.email || ''; $('em').disabled = true;
      $('ph').value = u.phone || ''; $('op').value = u.office_phone || '';
      if (u.preferred_contact) $('ct').value = u.preferred_contact;
      if (u.timezone) $('tz').value = u.timezone;
      if (u.avatar_url) { $('avatar-img').src = u.avatar_url; $('avatar-img').classList.remove('hidden'); $('avatar-empty').classList.add('hidden'); }
    }
    fill(me);
    $('org').value = ME.company.name;
    $('em').setAttribute('title', 'Your sign-in email. It can be changed from the sign-in settings.');

    $('acct-cancel').addEventListener('click', function () { fill(me); toast('Changes discarded.'); });
    $('acct-save').addEventListener('click', function () {
      var btn = this, name = ($('fn').value.trim() + ' ' + $('ln').value.trim()).trim();
      busy(btn, true);
      api.patch('/api/me', { full_name: name, job_title: $('ti').value.trim(), phone: $('ph').value.trim(), office_phone: $('op').value.trim(), preferred_contact: $('ct').value, timezone: $('tz').value })
        .then(function (r) { me = r.user; ME.user = r.user; toast('Your profile is saved.'); }).catch(showError).then(function () { busy(btn, false); });
    });
    $('avatar-input').addEventListener('change', function (e) {
      var f = e.target.files && e.target.files[0];
      e.target.value = '';
      if (!f) return;
      api.upload('/api/me/avatar', f).then(function (r) {
        me.avatar_url = r.avatar_url; $('avatar-img').src = r.avatar_url; $('avatar-img').classList.remove('hidden'); $('avatar-empty').classList.add('hidden');
        toast('Profile photo updated.');
      }).catch(showError);
    });
    $('sign-out').addEventListener('click', function () {
      if (api.mode === 'sample') { toast('On sample data there\u2019s no real sign-in. Use the Sample data button to switch people.'); return; }
      toast('Signing out\u2026');
      RS.auth.signOut().then(function () { location.href = 'signin.html'; });
    });

    var links = document.querySelectorAll('.sidenav a');
    links.forEach(function (a) { a.addEventListener('click', function () { links.forEach(function (x) { x.classList.toggle('current', x === a); }); }); });

    if (!can('billing.manage')) { $('billing').classList.add('hidden'); $('nav-billing').classList.add('hidden'); return; }
    function goTo(path, body) {
      return api.post(path, body || {}).then(function (r) { if (r.url) location.href = r.url; else toast(r.message || 'That isn\u2019t available yet.'); }).catch(showError);
    }
    function loadBilling() {
      return api.get('/api/billing').then(function (b) {
        var s = b.subscription || {}, plans = b.plans || { monthly_cents: 10000, yearly_cents: 100000 };
        var actions = $('bill-plan-actions'); actions.innerHTML = '';
        var perMo = function (c) { return money(c).replace('.00', ''); };
        if (s.status === 'active' && s.trial_ends_at) {
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
          actions.appendChild(el('button', { type: 'button', class: 'btn', text: lead + 'Monthly \u00b7 ' + perMo(plans.monthly_cents) + '/mo' + (trial ? ' after' : ''), onclick: function () { goTo('/api/billing/subscribe', { plan: 'monthly' }); } }));
          actions.appendChild(el('button', { type: 'button', class: 'btn btn-dark', text: lead + 'Yearly \u00b7 ' + perMo(plans.yearly_cents) + '/yr' + (trial ? ' after' : ''), onclick: function () { goTo('/api/billing/subscribe', { plan: 'yearly' }); } }));
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

  // ---------- visitors without an account (Place order page only) ----------
  function isGuest() {
    if (page !== 'new-sketch' || !api) return false;
    if (api.mode === 'live') return !(RS.auth && RS.auth.signedIn());
    return new URLSearchParams(location.search).has('guest'); // sample data: ?guest shows the visitor view
  }
  function setupGuest() {
    document.body.classList.add('guest');
    RS.guest = true;
    var next = encodeURIComponent('new-sketch.html');
    var nav = document.querySelector('.topnav');
    if (nav) {
      nav.innerHTML = '';
      nav.appendChild(el('a', { href: 'index.html#how', text: 'How it works' }));
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
  if (page === 'new-sketch' && /[?&]embed=1/.test(location.search)) { document.body.classList.add('embed'); RS.embed = true; }
  labelTables();
  if (!api) return;
  if (isGuest()) { setupGuest(); document.dispatchEvent(new CustomEvent('rs:ready', { detail: null })); return; }
  if (!RS.embed) setupSampleSwitcher();
  if (api.mode === 'live' && !(RS.auth && RS.auth.signedIn())) { RS.auth.toSignIn(); return; }
  api.get('/api/me').then(function (me) {
    ME = me;
    RS.me = me;
    replaceCompanyName(me.company.name);
    setupNav();
    if (!guardPage()) return;
    if (page === 'reports') initReports();
    else if (page === 'report-settings') initReportSettings();
    else if (page === 'team') initTeam();
    else if (page === 'account') initAccount();
    document.dispatchEvent(new CustomEvent('rs:ready', { detail: me }));
  }).catch(showError);
})();
