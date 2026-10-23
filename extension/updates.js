/* Update check: compares this extension's version with the latest one on the GST Desk website. */
(function (root) {
  'use strict';
  const SOURCES = ['https://smishra724.github.io/gst-desk/docs/version.json', 'https://smishra724.github.io/gst-desk/version.json'];
  const KEY = 'gstf_update';
  const cmp = (a, b) => { const x = String(a).split('.').map(Number), y = String(b).split('.').map(Number); for (let i = 0; i < 3; i++) { if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) - (y[i] || 0); } return 0; };

  async function fetchLatest() {
    for (const u of SOURCES) {
      try {
        const r = await fetch(u + '?t=' + Date.now(), { cache: 'no-store' });
        if (r.ok) { const j = await r.json(); if (j && j.version) return { ...j, base: u.replace(/version\.json$/, '') }; }
      } catch (_) { /* try next */ }
    }
    return null;
  }

  async function check(force) {
    const cur = chrome.runtime.getManifest().version;
    const saved = (await chrome.storage.local.get(KEY))[KEY];
    let info = saved;
    if (force || !saved || Date.now() - saved.checked > 3600 * 1000) {
      const latest = await fetchLatest();
      if (latest) { info = { ...latest, checked: Date.now() }; await chrome.storage.local.set({ [KEY]: info }); }
    }
    if (!info) return { current: cur, latest: null, update: false };
    return { current: cur, latest: info.version, notes: info.notes || '', zip: info.base + (info.zip || 'gst-desk.zip'), page: info.base + 'index.html#download',
      storeUrl: info.storeUrl || '', update: cmp(info.version, cur) > 0 };
  }

  root.GSTUpdates = { check, cmp };
})(typeof window !== 'undefined' ? window : globalThis);
