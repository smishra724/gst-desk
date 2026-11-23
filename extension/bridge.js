/* Bridge for the GST Desk web dashboard (smishra724.github.io/gst-desk) and CA Desk (smishra724.github.io/ca-desk).
   Answers the page with a summary, opens GST Desk, shares clients + GST logins with CA Desk (same site only),
   takes clients sent from CA Desk, and restarts itself after CA Desk has written an update. */
(function () {
  'use strict';
  if (window.__gstfBridge) return;
  window.__gstfBridge = true;
  const G = window.GSTR, K = G.KEYS;
  const ORIGIN = location.origin;

  async function summary() {
    const r = await chrome.storage.local.get([K.profiles, K.queue, K.downloads]);
    const clients = (r[K.profiles] || []).map(G.normalizeProfile).map(p => {
      const errs = G.validate(p);
      return {
        id: p.id, name: G.displayName(p), gstin: p.gstin, status: p.status, constitution: G.CONSTITUTIONS[p.constitution].label,
        state: p.gstin ? G.stateName(p.gstin.slice(0, 2)) : p.partA.state, username: !!p.portal.username, passwordSaved: !!p.portal.passwordEnc,
        tallyCompany: p.tally.company || '', toFix: errs.filter(e => e.level === 'error').length, updated: p.updated
      };
    });
    const q = r[K.queue];
    const queue = q ? {
      status: q.status, created: q.created,
      items: q.items.map(it => ({ name: it.name, gstin: it.gstin, status: it.status,
        jobs: it.jobs.map(j => ({ file: j.file, period: j.period, status: j.status, note: j.note || '', filename: j.filename || '' })) }))
    } : null;
    return { version: chrome.runtime.getManifest().version, clients, queue, downloads: (r[K.downloads] || []).slice(0, 100) };
  }

  const post = (msg) => window.postMessage({ gstdesk: 'ext', ...msg }, ORIGIN);
  window.addEventListener('message', async (e) => {
    if (e.source !== window || e.origin !== ORIGIN || !e.data || e.data.gstdesk !== 'page') return;
    const { id, action, hash } = e.data;
    // After GST Desk is updated/reloaded this old copy can no longer reach the extension: say so instead of failing silently.
    if (!chrome.runtime || !chrome.runtime.id) { post({ id, ok: false, stale: true, error: 'GST Desk was updated or reloaded. Reload this page (F5) once and try again.' }); return; }
    try {
      if (action === 'summary') post({ id, ok: true, data: await summary() });
      else if (action === 'open') {
        chrome.runtime.sendMessage({ type: 'open-manager', hash: hash || '' }, (r) => { const err = chrome.runtime.lastError; post(err ? { id, ok: false, error: err.message } : { id, ok: true }); });
      }
      else if (action === 'sync-clients') {
        const r = await new Promise(res => chrome.runtime.sendMessage({ type: 'import-clients', clients: e.data.clients || [], replacePasswords: !!e.data.replacePasswords }, x => { void chrome.runtime.lastError; res(x || { error: 'GST Desk did not answer' }); }));
        post({ id, ok: !r.error, data: r, error: r.error });
      }
      else if (action === 'export-clients') {
        const r = await new Promise(res => chrome.runtime.sendMessage({ type: 'export-clients' }, x => { void chrome.runtime.lastError; res(x || { error: 'GST Desk did not answer' }); }));
        post({ id, ok: !r.error, data: r, error: r.error });
      }
      else if (action === 'reload') { post({ id, ok: true }); setTimeout(() => chrome.runtime.sendMessage({ type: 'reload-self' }, () => void chrome.runtime.lastError), 150); }
      else post({ id, ok: false, error: 'unknown action' });
    } catch (err) { post({ id, ok: false, error: err.message }); }
  });
  // Live updates while the dashboard is open
  chrome.storage.onChanged.addListener((ch, area) => {
    if (!chrome.runtime || !chrome.runtime.id) return;
    if (area === 'local' && (ch[K.profiles] || ch[K.queue] || ch[K.downloads])) post({ event: 'changed' });
  });
  document.documentElement.setAttribute('data-gstdesk-extension', chrome.runtime.getManifest().version);
  document.documentElement.setAttribute('data-gstdesk-id', chrome.runtime.id);   // lets the page open GST Desk with a plain link
  post({ event: 'ready' });
})();
