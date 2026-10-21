// Rapid Squares — how the website talks to the backend.
//
// Every page uses RS.api.get/post/patch/del/upload with the routes from the API contract
// (e.g. RS.api.get('/api/orders?status=delivered')).
//
//   • Opened as plain files / the simple Windows server → "sample data" mode: answered by sample-api.js.
//   • Opened through the Node.js backend (npm start)     → "live" mode: real database and sign-in.
//     The backend tells the page this through /runtime-config.js (window.RS_RUNTIME).
//
// Pages don't know or care which one answers.
(function () {
  var cfg = window.RS_CONFIG || {};
  var rt = window.RS_RUNTIME || null;
  var LIVE = !!((rt && rt.mode === 'live') || cfg.apiBaseUrl);
  var BASE = String((rt && rt.apiBaseUrl) || cfg.apiBaseUrl || '').replace(/\/+$/, '');
  window.RS = window.RS || {};

  function ApiError(status, code, message) {
    var e = new Error(message || code || 'Request failed');
    e.name = 'ApiError'; e.status = status; e.code = code || 'error';
    return e;
  }

  // auth.js supplies the signed-in session's access token (refreshed when needed).
  function getToken() {
    return (RS.auth && typeof RS.auth.getToken === 'function') ? Promise.resolve(RS.auth.getToken()) : Promise.resolve(null);
  }

  function live(method, path, body, isForm) {
    return getToken().then(function (token) {
      var headers = { 'Accept': 'application/json' };
      if (token) headers['Authorization'] = 'Bearer ' + token;
      var init = { method: method, headers: headers };
      if (body !== undefined) {
        if (isForm) init.body = body;
        else { headers['Content-Type'] = 'application/json'; init.body = JSON.stringify(body); }
      }
      return fetch(BASE + path, init).catch(function () {
        throw ApiError(0, 'network', 'Couldn’t reach the Rapid Squares server. Check your connection and try again.');
      });
    }).then(function (res) {
      if (res.status === 204) return null;
      return res.text().then(function (text) {
        var data = null;
        try { data = text ? JSON.parse(text) : null; } catch (_) { /* not JSON */ }
        if (!res.ok) {
          var err = (data && data.error) || {};
          if (RS.auth && RS.auth.onApiError) RS.auth.onApiError(res.status, err.code);
          throw ApiError(res.status, err.code, err.message || ('Request failed (' + res.status + ')'));
        }
        return data;
      });
    });
  }

  function request(method, path, body) {
    if (!LIVE) {
      if (!RS.sample) return Promise.reject(ApiError(500, 'no_backend', 'Sample data isn’t loaded on this page.'));
      return RS.sample.handle(method, path, body);
    }
    return live(method, path, body, false);
  }

  // Shrink large images before saving them as sample data, so browser storage doesn't fill up.
  function fileToDataUrl(file, maxSide) {
    return new Promise(function (resolve, reject) {
      var reader = new FileReader();
      reader.onerror = function () { reject(ApiError(422, 'bad_file', 'That file couldn’t be read.')); };
      reader.onload = function () {
        var url = reader.result;
        if (!/^data:image\/(png|jpe?g|webp|gif)/i.test(url)) { resolve(url); return; }
        var img = new Image();
        img.onload = function () {
          var scale = Math.min(1, maxSide / Math.max(img.width, img.height));
          if (scale === 1) { resolve(url); return; }
          var c = document.createElement('canvas');
          c.width = Math.round(img.width * scale); c.height = Math.round(img.height * scale);
          c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
          resolve(c.toDataURL(/png/i.test(url) ? 'image/png' : 'image/jpeg', 0.85));
        };
        img.onerror = function () { resolve(url); };
        img.src = url;
      };
      reader.readAsDataURL(file);
    });
  }

  RS.api = {
    mode: LIVE ? 'live' : 'sample',
    ApiError: ApiError,
    get: function (path) { return request('GET', path); },
    post: function (path, body) { return request('POST', path, body === undefined ? {} : body); },
    patch: function (path, body) { return request('PATCH', path, body); },
    del: function (path) { return request('DELETE', path); },
    // Upload one file (logo, profile photo). Real backend gets multipart form data.
    upload: function (path, file) {
      if (!file) return Promise.reject(ApiError(422, 'no_file', 'Choose a file to upload.'));
      if (file.size > 10 * 1024 * 1024) return Promise.reject(ApiError(422, 'file_too_large', 'That file is over 10 MB. Choose a smaller image.'));
      if (LIVE) { var fd = new FormData(); fd.append('file', file); return live('POST', path, fd, true); }
      return fileToDataUrl(file, 640).then(function (dataUrl) { return request('POST', path, { file: dataUrl, name: file.name }); });
    }
  };
})();
