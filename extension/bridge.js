/* Bridge for the GST Desk web dashboard (smishra724.github.io/gst-desk).
   Answers the page with a read-only summary. Passwords are never shared. */
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
    try {
      if (action === 'summary') post({ id, ok: true, data: await summary() });
      else if (action === 'open') { chrome.runtime.sendMessage({ type: 'open-manager', hash: hash || '' }); post({ id, ok: true }); }
      else post({ id, ok: false, error: 'unknown action' });
    } catch (err) { post({ id, ok: false, error: err.message }); }
  });
  // Live updates while the dashboard is open
  chrome.storage.onChanged.addListener((ch, area) => {
    if (area === 'local' && (ch[K.profiles] || ch[K.queue] || ch[K.downloads])) post({ event: 'changed' });
  });
  document.documentElement.setAttribute('data-gstdesk-extension', chrome.runtime.getManifest().version);
  post({ event: 'ready' });
})();
