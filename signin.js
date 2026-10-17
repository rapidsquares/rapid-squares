// Rapid Squares — sign-in page: sign in, create an account, reset password,
// set up a new company, or accept a team invite (signin.html?invite=…).
(function () {
  var q = new URLSearchParams(location.search);
  var inviteToken = q.get('invite') || '';
  var nextRaw = q.get('next') || '';
  var next = /^[a-z0-9-]+\.html(\?[^#]*)?$/i.test(nextRaw) ? nextRaw : 'index.html';
  var invite = null;

  function $(s) { return document.querySelector(s); }
  function view(name) {
    document.querySelectorAll('[data-view]').forEach(function (v) { v.classList.toggle('hidden', v.getAttribute('data-view') !== name); });
    var form = $('[data-view="' + name + '"]');
    var first = form && form.querySelector('input:not([readonly])');
    if (first && !first.value) first.focus();
  }
  function errorIn(form, msg) { var e = form.querySelector('.form-error'); e.textContent = msg || ''; e.classList.toggle('hidden', !msg); }
  function busy(form, on) { var b = form.querySelector('button[type="submit"]'); b.disabled = on; b.setAttribute('aria-busy', on ? 'true' : 'false'); }
  function problem(msg) { $('#problem-text').textContent = msg; view('problem'); }
  function submit(name, fn) {
    var form = $('[data-view="' + name + '"]');
    form.addEventListener('submit', function (e) {
      e.preventDefault(); errorIn(form, '');
      busy(form, true);
      Promise.resolve().then(function () { return fn(form); })
        .catch(function (err) { errorIn(form, err.message); })
        .then(function () { busy(form, false); });
    });
  }
  function need(v, msg) { if (!String(v || '').trim()) throw new Error(msg); return String(v).trim(); }

  if (!RS.auth) { view('sample'); return; }

  document.addEventListener('click', function (e) {
    var go = e.target.closest('[data-go]');
    if (go) { view(go.getAttribute('data-go')); return; }
    if (e.target.closest('[data-signout]')) RS.auth.signOut().then(function () { view('signin'); });
  });

  // After signing in: accept the invite, or set up a company, or go to the app.
  function afterSignIn() {
    if (inviteToken) {
      if (!invite) { problem('This invite link isn’t valid anymore. Ask your company admin for a new one.'); return; }
      var me = RS.auth.user() || {};
      if (me.email && me.email.toLowerCase() !== invite.email.toLowerCase()) {
        problem('This invite was sent to ' + invite.email + ', but you’re signed in as ' + me.email + '. Sign out and sign in (or create an account) with ' + invite.email + '.');
        return;
      }
      $('#accept-h').textContent = 'Join ' + (invite.company_name || 'your team');
      if (invite.full_name && !$('#ac-name').value) $('#ac-name').value = invite.full_name;
      view('accept');
      return;
    }
    RS.api.get('/api/me').then(function () { location.replace(next); }, function (err) {
      if (err.code === 'needs_company') view('company');
      else if (err.status === 401) { RS.auth.signOut(); view('signin'); }
      else problem(err.message);
    });
  }

  submit('signin', function (f) {
    var email = need($('#si-email').value, 'Enter your email.');
    var pass = need($('#si-pass').value, 'Enter your password.');
    return RS.auth.signIn(email, pass).then(afterSignIn);
  });
  submit('signup', function () {
    var email = need($('#su-email').value, 'Enter your email.');
    var pass = $('#su-pass').value;
    if (pass.length < 8) throw new Error('Choose a password with at least 8 characters.');
    return RS.auth.signUp(email, pass, inviteToken ? 'invite=' + encodeURIComponent(inviteToken) : '').then(function (r) {
      if (r.session) { afterSignIn(); return; }
      $('#confirm-text').textContent = 'We sent a link to ' + email + '. Open it on this device to finish setting up.';
      view('confirm');
    });
  });
  submit('reset', function (f) {
    var email = need($('#rs-email').value, 'Enter your email.');
    return RS.auth.sendReset(email).then(function () {
      var ok = f.querySelector('.form-ok');
      ok.textContent = 'If there’s an account for ' + email + ', a reset link is on its way.';
      ok.classList.remove('hidden');
    });
  });
  submit('newpass', function () {
    var pass = $('#np-pass').value;
    if (pass.length < 8) throw new Error('Choose a password with at least 8 characters.');
    return RS.auth.setPassword(pass).then(afterSignIn);
  });
  submit('company', function () {
    var company = need($('#co-name').value, 'Enter your company name.');
    var you = need($('#co-you').value, 'Enter your name.');
    return RS.api.post('/api/onboarding', { company_name: company, full_name: you }).then(function () { location.replace('index.html'); });
  });
  submit('accept', function () {
    var name = need($('#ac-name').value, 'Enter your name.');
    return RS.api.post('/api/invites/accept', { token: inviteToken, full_name: name }).then(function () { location.replace('index.html'); });
  });

  // ---------- start ----------
  var ready = Promise.resolve();
  if (inviteToken) {
    ready = RS.api.get('/api/invites/preview?token=' + encodeURIComponent(inviteToken)).then(function (inv) {
      invite = inv;
      var b = $('#invite-banner');
      b.textContent = 'You’re invited to join ' + (inv.company_name || 'a company') + ' on Rapid Squares. Sign in or create an account with ' + inv.email + '.';
      b.classList.remove('hidden');
      ['#si-email', '#su-email'].forEach(function (id) { $(id).value = inv.email; });
    }, function (err) { problem(err.message); throw err; });
  }
  ready.then(function () {
    if (RS.auth.linkType === 'recovery') { view('newpass'); return; }
    if (RS.auth.signedIn()) { afterSignIn(); return; }
    view(inviteToken ? 'signup' : (q.get('step') === 'signup' ? 'signup' : 'signin'));
  }, function () { /* problem view already shown */ });
})();
