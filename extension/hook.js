/* GST Desk – runs in the GST portal page itself (services.gst.gov.in).
   The portal's screens are filled from JSON the page downloads. This keeps a copy of the JSON
   responses that carry taxpayer details (GSTIN, legal name, address…) so the importer can read
   them exactly, instead of guessing from the screen layout. Nothing leaves the browser. */
(() => {
  if (window.__gstfHook) return;
  window.__gstfHook = true;
  const WANT = /"(gstin|lgnm|tradeNam|legalName|legal_name|tradeName|trade_name|pradr|ctb|bzdtls|prmtrs?|authSign|nba|stj|ctj)"/i;
  const buf = [];
  const keep = (url, text) => {
    try {
      if (!text || text.length > 1500000 || !WANT.test(text)) return;
      const data = JSON.parse(text);
      buf.push({ url: String(url || ''), data });
      if (buf.length > 30) buf.shift();
      window.postMessage({ __gstf: 'json', url: String(url || ''), data }, location.origin);
    } catch (_) { /* not JSON */ }
  };
  const X = XMLHttpRequest.prototype, open = X.open, send = X.send;
  X.open = function (m, u) { this.__gstfUrl = u; return open.apply(this, arguments); };
  X.send = function () {
    this.addEventListener('load', function () {
      try {
        if (this.responseType === '' || this.responseType === 'text') keep(this.__gstfUrl, this.responseText);
        else if (this.responseType === 'json' && this.response) keep(this.__gstfUrl, JSON.stringify(this.response));
      } catch (_) { /* ignore */ }
    });
    return send.apply(this, arguments);
  };
  const f = window.fetch;
  if (f) window.fetch = function () {
    return f.apply(this, arguments).then(r => {
      try { if (/json|text/i.test(r.headers.get('content-type') || '')) r.clone().text().then(t => keep(r.url, t), () => {}); } catch (_) { /* ignore */ }
      return r;
    });
  };
  window.addEventListener('message', (e) => {
    if (e.source === window && e.data && e.data.__gstf === 'flush') buf.forEach(b => window.postMessage({ __gstf: 'json', url: b.url, data: b.data }, location.origin));
  });
})();
