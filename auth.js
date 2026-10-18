// Rapid Squares — sign-in (Supabase Auth). Only active in live mode, when the Node.js backend
// serves the site. Uses Supabase's public sign-in endpoints with the PUBLIC key; the browser
// never talks to the database directly — data goes through the backend (api.js).
(function () {
  window.RS = window.RS || {};
  var rt = window.RS_RUNTIME;
  if (!rt || rt.mode !== 'live') return;

  var URL_ = String(rt.supabaseUrl || '').replace(/\/+$/, '');
  var KEY = rt.supabasePublishableKey;
  var STORE = 'rs.session';
  var refreshing = null;

  function load() { try { return JSON.parse(localStorage.getItem(STORE)) || null; } catch (_) { return null; } }
  function save(s) { try { if (s) localStorage.setItem(STORE, JSON.stringify(s)); else localStorage.removeItem(STORE); } catch (_) { /* storage blocked */ } }
  function fromAuth(body) {
    if (!body || !body.access_token) return null;
    var exp = body.expires_at || (Math.floor(Date.now() / 1000) + (Number(body.expires_in) || 3600));
    var user = body.user || {};
    return { access_token: body.access_token, refresh_token: body.refresh_token, expires_at: exp, user: { id: user.id, email: user.email } };
  }

  // Friendly versions of Supabase's sign-in errors.
  function friendly(status, body) {
    var code = (body && (body.error_code || body.code || body.error)) || '';
    var msg = (body && (body.msg || body.message || body.error_description)) || '';
    if (code === 'invalid_credentials' || /invalid login/i.test(msg)) return 'That email and password don’t match. Try again or reset your password.';
    if (code === 'email_not_confirmed' || /not confirmed/i.test(msg)) return 'Confirm your email first: open the link we sent you, then sign in.';
    if (code === 'user_already_exists' || /already registered/i.test(msg)) return 'There’s already an account with that email. Sign in instead.';
    if (code === 'weak_password' || /password should/i.test(msg)) return 'Choose a stronger password: at least 8 characters.';
    if (code === 'over_email_send_rate_limit' || /email rate limit/i.test(msg)) return 'We’ve sent too many sign-up or reset emails in the last hour. Try again later.';
    if (status === 429) return 'Too many tries. Wait a few minutes and try again.';
    if (/email.*invalid|invalid.*email/i.test(msg)) return 'Enter a valid email address.';
    return msg || 'Sign-in didn’t work. Try again.';
  }
  function call(path, body, token) {
    var headers = { 'apikey': KEY, 'Content-Type': 'application/json' };
    if (token) headers.Authorization = 'Bearer ' + token;
    return fetch(URL_ + '/auth/v1' + path, { method: path === '/user' ? 'PUT' : 'POST', headers: headers, body: JSON.stringify(body || {}) })
      .catch(function () { throw new Error('Can’t reach the sign-in service. Check your connection and try again.'); })
      .then(function (res) {
        return res.text().then(function (t) {
          var data = null; try { data = t ? JSON.parse(t) : null; } catch (_) { /* not JSON */ }
          if (!res.ok) { var e = new Error(friendly(res.status, data)); e.status = res.status; throw e; }
          return data;
        });
      });
  }

  function refresh(s) {
    if (refreshing) return refreshing;
    refreshing = call('/token?grant_type=refresh_token', { refresh_token: s.refresh_token })
      .then(function (body) { var n = fromAuth(body); save(n); return n; })
      .catch(function (e) { if (e.status >= 400 && e.status < 500) save(null); throw e; })
      .then(function (n) { refreshing = null; return n; }, function (e) { refreshing = null; throw e; });
    return refreshing;
  }

  // Sign-up confirmation and password-reset links land on the site with the session in the URL hash.
  function takeSessionFromUrl() {
    var h = location.hash.replace(/^#/, '');
    if (!/access_token=/.test(h)) return null;
    var p = new URLSearchParams(h);
    var s = fromAuth({ access_token: p.get('access_token'), refresh_token: p.get('refresh_token'), expires_in: p.get('expires_in'), expires_at: Number(p.get('expires_at')) || undefined });
    if (s) {
      try { var claims = JSON.parse(atob(s.access_token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/'))); s.user = { id: claims.sub, email: claims.email }; } catch (_) { /* keep going */ }
      save(s);
    }
    history.replaceState(null, '', location.pathname + location.search);
    return p.get('type');
  }
  var urlType = takeSessionFromUrl();

  function here() { return (location.pathname.split('/').pop() || 'orders.html') + location.search; }

  RS.auth = {
    linkType: urlType,  // 'signup', 'recovery', 'invite' … when the page was opened from an email link
    signedIn: function () { return !!load(); },
    user: function () { var s = load(); return s ? s.user : null; },
    getToken: function () {
      var s = load();
      if (!s) return null;
      if (s.expires_at - 60 > Date.now() / 1000) return s.access_token;
      return refresh(s).then(function (n) { return n && n.access_token; }, function () { return null; });
    },
    signIn: function (email, password) {
      return call('/token?grant_type=password', { email: email, password: password }).then(function (b) { var s = fromAuth(b); save(s); return s; });
    },
    // Returns { session } when the account is ready, or { confirm: true } when Supabase emailed a confirmation link.
    signUp: function (email, password, next) {
      var redirect = location.origin + '/signin.html' + (next ? '?' + next : '');
      return call('/signup?redirect_to=' + encodeURIComponent(redirect), { email: email, password: password }).then(function (b) {
        var s = fromAuth(b); save(s);
        return s ? { session: s } : { confirm: true };
      });
    },
    sendReset: function (email) {
      return call('/recover?redirect_to=' + encodeURIComponent(location.origin + '/signin.html'), { email: email });
    },
    setPassword: function (password) {
      return Promise.resolve(RS.auth.getToken()).then(function (t) {
        if (!t) throw new Error('That reset link has expired. Request a new one.');
        return call('/user', { password: password }, t);
      });
    },
    signOut: function () {
      var s = load(); save(null);
      if (!s) return Promise.resolve();
      return call('/logout', {}, s.access_token).catch(function () { /* already signed out */ });
    },
    toSignIn: function () { location.href = 'signin.html?next=' + encodeURIComponent(here()); },
    // api.js calls this on every failed backend request.
    onApiError: function (status, code) {
      if (/signin\.html/.test(location.pathname)) return;  // the sign-in page handles its own errors
      if (status === 401) { save(null); RS.auth.toSignIn(); }
      else if (status === 409 && code === 'needs_company') location.href = 'signin.html?step=company';
    }
  };
})();
