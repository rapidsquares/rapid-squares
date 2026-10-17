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
  function money(cents) { return '$' + (cents / 100).toFixed(2); }
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
      el('div', { class: 'actions' }, [el('a', { href: 'index.html', class: 'btn btn-primary', text: 'Go to Order history' })])
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
    var state = { filter: 'all', q: '', page: 1 }, timer = null, refresh = null;
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

    function orderRow(o) {
      var addr = splitAddress(o.address), s = STATUS[o.status] || ['cancelled', o.status];
      var detail = o.total_squares != null ? o.total_squares + ' squares · ' + o.predominant_pitch + ' pitch' : '';
      var actions = el('td', {});
      if (o.status === 'delivered') {
        if (can('orders.download')) {
          actions.appendChild(el('button', { type: 'button', class: 'linkbtn', text: 'Download PDF', onclick: function () { api.get('/api/orders/' + o.id + '/pdf').catch(showError); } }));
          if (o.esx_purchased) actions.appendChild(el('button', { type: 'button', class: 'linkbtn', text: 'ESX file', onclick: function () { api.get('/api/orders/' + o.id + '/esx').catch(showError); } }));
        }
      } else if (o.status === 'needs_info') {
        if (can('orders.create')) actions.appendChild(el('button', { type: 'button', class: 'linkbtn', text: 'Add details', onclick: function () { api.post('/api/orders/' + o.id + '/details', {}).catch(showError); } }));
      } else if (o.eta) {
        actions.appendChild(el('span', { class: 'hint', text: 'Ready by ' + fmtTime(o.eta) }));
      } else if (o.status === 'failed') {
        actions.appendChild(el('span', { class: 'hint', text: 'Couldn’t be measured' }));
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
  }

  // ---------- Report settings ----------
  function initReportSettings() {
    var fields = document.querySelectorAll('[data-field]');
    function showLogo(url) {
      document.querySelectorAll('.logo-img').forEach(function (img) { if (url) { img.src = url; img.classList.remove('hidden'); } else img.classList.add('hidden'); });
      document.querySelectorAll('.logo-empty').forEach(function (n) { n.classList.toggle('hidden', !!url); });
    }
    api.get('/api/company').then(function (r) {
      fields.forEach(function (f) { f.value = r.company[f.getAttribute('data-field')] || ''; });
      showLogo(r.company.logo_url);
    }).catch(showError);

    $('save-company').addEventListener('click', function () {
      var btn = this, body = {};
      fields.forEach(function (f) { body[f.getAttribute('data-field')] = f.value.trim(); });
      busy(btn, true);
      api.patch('/api/company', body).then(function () { toast('Report settings saved.'); }).catch(showError).then(function () { busy(btn, false); });
    });

    $('logo-input').addEventListener('change', function (e) {
      var f = e.target.files && e.target.files[0];
      e.target.value = '';
      if (!f) return;
      api.upload('/api/company/logo', f).then(function (r) { showLogo(r.logo_url); toast('Logo updated.'); }).catch(showError);
    });

    // Roof photos: preview only for now.
    var photos = [], slotLabels = ['Aerial overview', 'Front slope', 'Rear slope', 'Damage close-up'];
    var grid = $('photo-grid'), count = $('photo-count');
    function renderPhotos() {
      grid.innerHTML = '';
      photos.forEach(function (p) { grid.appendChild(el('figure', {}, [el('img', { src: p.url, alt: p.name }), el('figcaption', { text: p.name })])); });
      slotLabels.slice(photos.length).forEach(function (label) { grid.appendChild(el('div', { class: 'thumb-empty', text: label })); });
      count.textContent = photos.length === 1 ? '1 photo' : photos.length + ' photos';
    }
    $('photo-input').addEventListener('change', function (e) {
      Array.prototype.forEach.call(e.target.files || [], function (f) { photos.push({ url: URL.createObjectURL(f), name: f.name }); });
      e.target.value = '';
      renderPhotos();
    });
    renderPhotos();
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
      $('inv-exp-fld').classList.remove('hidden');
      $('inv-note').classList.remove('hidden');
      ['inv-em', 'inv-fn', 'inv-ti'].forEach(function (id) { $(id).value = ''; $(id).disabled = false; });
      $('inv-lim').value = ''; $('inv-exp').value = '7';
      formError(''); setPreset('estimator');
    }
    function startEdit(m) {
      editing = m;
      $('inv-h').textContent = 'Edit ' + m.full_name;
      $('send-label').textContent = 'Save changes';
      $('cancel-edit').classList.remove('hidden');
      $('inv-exp-fld').classList.add('hidden');
      $('inv-note').classList.add('hidden');
      $('inv-em').value = m.email; $('inv-em').disabled = true;
      $('inv-fn').value = m.full_name; $('inv-fn').disabled = true;
      $('inv-ti').value = m.job_title || '';
      $('inv-lim').value = m.monthly_order_limit == null ? '' : String(m.monthly_order_limit);
      if (!Array.prototype.some.call($('inv-lim').options, function (o) { return o.value === $('inv-lim').value; })) {
        $('inv-lim').appendChild(el('option', { value: String(m.monthly_order_limit), text: m.monthly_order_limit + ' reports' }));
        $('inv-lim').value = String(m.monthly_order_limit);
      }
      boxes.forEach(function (box) { box.checked = m.permissions.indexOf(PERM_KEYS[box.getAttribute('data-perm')]) !== -1; });
      setPreset(PRESETS[m.preset] && presetFor(m.permissions) === m.preset ? m.preset : presetFor(m.permissions));
      formError('');
      $('inv-h').scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
    $('cancel-edit').addEventListener('click', resetForm);

    $('send-invites').addEventListener('click', function () {
      var btn = this, perms = chosenPerms(), limit = $('inv-lim').value;
      var common = { preset: preset, permissions: perms, monthly_order_limit: limit ? parseInt(limit, 10) : null, job_title: $('inv-ti').value.trim() };
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
      api.post('/api/invites', Object.assign({ emails: emails, full_name: $('inv-fn').value.trim(), expires_in_days: parseInt($('inv-exp').value, 10) }, common)).then(function (r) {
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
    function orderText(perms, limit) {
      if (perms.indexOf('orders.create') === -1) return '—';
      return limit != null ? 'Yes · ' + limit + '/mo' : 'Yes';
    }
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
        el('td', { text: orderText(m.permissions, m.monthly_order_limit) }),
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
        el('td', { text: orderText(i.permissions, i.monthly_order_limit) }),
        el('td', { text: accessText(i.permissions, false) }),
        el('td', {}, [el('span', { class: 'pill ' + (expired ? 'failed' : 'pending'), text: expired ? 'Expired' : 'Pending' })]),
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
    api.get('/api/billing').then(function (b) {
      var s = b.subscription;
      if (s && s.status === 'active') {
        $('bill-plan').textContent = (s.plan === 'yearly' ? 'Yearly' : 'Monthly') + ' · ' + money(s.price_cents).replace('.00', '') + (s.plan === 'yearly' ? '/year' : '/month');
        $('bill-plan-detail').textContent = 'Subscriber prices on every report · renews ' + fmtDate(s.renews_at);
      } else {
        $('bill-plan').textContent = 'Pay per report';
        $('bill-plan-detail').textContent = 'Subscribe to get lower prices on every report.';
      }
      $('bill-count').textContent = b.reports_this_month;
      $('bill-spend').textContent = money(b.spend_this_month_cents);
      $('bill-free').textContent = b.free_reports_remaining;
      $('bill-card').textContent = b.card ? b.card.brand + ' ending in ' + b.card.last4 : 'No card saved';
      $('bill-card-exp').textContent = b.card ? 'Expires ' + b.card.exp : '';
      $('bem').value = b.billing_email || ''; $('bad').value = b.billing_address || '';
      var tbody = $('invoice-rows');
      tbody.innerHTML = '';
      b.invoices.forEach(function (inv) {
        tbody.appendChild(el('tr', {}, [
          el('td', { style: 'padding-left: 0;', text: fmtDate(inv.date) }),
          el('td', { text: inv.description }),
          el('td', { text: money(inv.amount_cents) }),
          el('td', { style: 'padding-right: 0;' }, [el('button', { type: 'button', class: 'linkbtn', text: 'Receipt', 'data-portal': true })])
        ]));
      });
      labelTables($('billing'));
    }).catch(showError);
    $('billing').addEventListener('click', function (e) {
      var t = e.target.closest('[data-portal]');
      if (!t) return;
      api.post('/api/billing/portal').then(function (r) { if (r.url) location.href = r.url; else toast(r.message); }).catch(showError);
    });
  }

  // ---------- start ----------
  labelTables();
  if (!api) return;
  setupSampleSwitcher();
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

  RS.ui = { toast: toast, showError: showError, el: el, money: money, can: can };
})();
