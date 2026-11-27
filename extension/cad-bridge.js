(() => {
// after the extension restarts this copy is cut off – stay quiet instead of throwing
const send = (msg, cb) => { try { if (!chrome.runtime || !chrome.runtime.id) return; chrome.runtime.sendMessage(msg, cb ? (r) => { void chrome.runtime.lastError; cb(r); } : () => void chrome.runtime.lastError); } catch (_) { /* reloaded */ } };
// CA Desk portal helper bridge. Runs on the CA Desk page. Tells the page the extension is installed and relays Login clicks.
document.documentElement.dataset.capmExt = '1';
document.documentElement.dataset.capmTally = '1';
document.documentElement.dataset.capmZoho = '1';   // Zoho Books API through the extension (Zoho does not allow web pages to call it)
document.documentElement.dataset.capmVer = chrome.runtime.getManifest().version;
document.documentElement.dataset.capmId = chrome.runtime.id;
document.documentElement.dataset.capmSuite = '1';   // combined extension (GST Desk + helper)
window.addEventListener('message', e => {
  if (e.source !== window || e.origin !== location.origin) return;
  const d = e.data;
  if (d && d.type === 'CAPM_TALLY' && typeof d.url === 'string' && typeof d.xml === 'string') { // read-only Tally export request
    send({ type: 'CAPM_TALLY', url: d.url, xml: d.xml }, r => {
      const res = r || { ok: false, error: chrome.runtime.lastError?.message || 'no reply' };
      window.postMessage({ type: 'CAPM_TALLY_RES', id: d.id, ...res }, location.origin);
    });
    return;
  }
  if (d && d.type === 'CAPM_ZOHO' && typeof d.url === 'string') { // Zoho Books / Zoho accounts API (read + token exchange only)
    send({ type: 'CAPM_ZOHO', url: d.url, method: d.method || 'GET', body: typeof d.body === 'string' ? d.body : '', auth: typeof d.auth === 'string' ? d.auth : '' }, r => {
      window.postMessage({ type: 'CAPM_ZOHO_RES', id: d.id, ...(r || { ok: false, error: chrome.runtime.lastError?.message || 'no reply' }) }, location.origin);
    });
    return;
  }
  if (d && d.type === 'CAPM_DSC') { // read plugged-in DSC certificates through the CA Desk DSC reader on this computer
    send({ type: 'CAPM_DSC' }, r => window.postMessage({ type: 'CAPM_DSC_RES', id: d.id, ...(r || { ok: false, error: chrome.runtime.lastError?.message || 'no reply' }) }, location.origin));
    return;
  }
  if (d && d.type === 'CAPM_RELOAD') { send({ type: 'CAPM_RELOAD' }); return; }
  if (d && d.type === 'CAPM_FREQ' && Array.isArray(d.queue)) { send({ type: 'CAPM_FREQ', queue: d.queue }); return; }
  if (d && d.type === 'CAPM_G1' && d.job && typeof d.url === 'string') { // GSTR-1 autopilot
    send({ type: 'CAPM_G1', url: d.url, username: d.username || '', password: d.password || '', job: d.job });
    return;
  }
  if (!d || d.type !== 'CAPM_LOGIN' || typeof d.url !== 'string') return;
  send({ type: 'CAPM_LOGIN', url: d.url, username: d.username || '', password: d.password || '', extra: d.extra || {} });
});

// GSTR-1 filed on the portal → hand ARN + PDF to the CA Desk page (and anything that arrived while CA Desk was closed)
const pushResult = r => window.postMessage({ type: 'CAPM_G1_RESULT', result: r }, location.origin);
chrome.runtime.onMessage.addListener(m => { if (m?.type === 'CAPM_G1_RESULT') pushResult(m.result); });
window.addEventListener('message', e => { if (e.source === window && e.data?.type === 'CAPM_G1_ACK') send({ type: 'CAPM_G1_ACK', id: e.data.id }); });
setTimeout(() => send({ type: 'CAPM_G1_PENDING' }, list => (list || []).forEach(pushResult)), 4000);

// filing-frequency results → CA Desk page
const pushFreq = r => window.postMessage({ type: 'CAPM_FREQ_RESULT', result: r }, location.origin);
chrome.runtime.onMessage.addListener(m => { if (m?.type === 'CAPM_FREQ_RESULT') pushFreq(m.result); });
window.addEventListener('message', e => { if (e.source === window && e.data?.type === 'CAPM_FREQ_ACK') send({ type: 'CAPM_FREQ_ACK', id: e.data.id }); });
setTimeout(() => send({ type: 'CAPM_FREQ_PENDING' }, list => (list || []).forEach(pushFreq)), 4500);

})();
