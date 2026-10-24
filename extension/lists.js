/* Dropdown lists copied from the GST portal itself, so GST Desk offers exactly the portal's options.
   districts: { 'Maharashtra': ['Ahmednagar', ...] }  (read from the public New Registration page)
   juris:     { 'Maharashtra': { ward: [...], comm: { 'PUNE-I': { 'DIVISION-II': ['RANGE-V', ...] } } } }
              (read from the Principal Place of Business tab when GST Desk sees it) */
(function (root) {
  'use strict';
  const KEY = 'gstf_lists';
  const clean = (arr) => Array.from(new Set((arr || []).map(s => String(s).replace(/\s+/g, ' ').trim())
    .filter(s => s && !/^(-+\s*)?(select|choose|please select)\b/i.test(s) && !/^-+$/.test(s))));

  const Lists = {
    async all() { return (await chrome.storage.local.get(KEY))[KEY] || { districts: {}, juris: {} }; },
    async districts(state) { const a = await this.all(); return (a.districts || {})[state] || []; },
    async juris(state) { const a = await this.all(); return (a.juris || {})[state] || null; },
    async saveDistricts(map) {
      const a = await this.all();
      a.districts = a.districts || {};
      let n = 0;
      for (const [st, arr] of Object.entries(map)) { const c = clean(arr); if (c.length) { a.districts[st] = c; n++; } }
      a.districtsAt = new Date().toISOString();
      await chrome.storage.local.set({ [KEY]: a });
      return n;
    },
    // patch: { ward?: [], comm?: [], divisions?: {comm: [..]}, ranges?: {comm: {div: [..]}} }
    async saveJuris(state, patch) {
      if (!state) return;
      const a = await this.all();
      a.juris = a.juris || {};
      const j = a.juris[state] = a.juris[state] || { ward: [], comm: {} };
      let changed = false;
      if (patch.ward && clean(patch.ward).length) { const w = clean(patch.ward); if (w.join('|') !== j.ward.join('|')) { j.ward = w; changed = true; } }
      for (const c of clean(patch.comm || [])) if (!j.comm[c]) { j.comm[c] = {}; changed = true; }
      for (const [c, divs] of Object.entries(patch.divisions || {})) {
        j.comm[c] = j.comm[c] || {};
        for (const d of clean(divs)) if (!j.comm[c][d]) { j.comm[c][d] = []; changed = true; }
      }
      for (const [c, byDiv] of Object.entries(patch.ranges || {})) {
        j.comm[c] = j.comm[c] || {};
        for (const [d, rs] of Object.entries(byDiv)) {
          const r = clean(rs);
          if (r.length && r.join('|') !== (j.comm[c][d] || []).join('|')) { j.comm[c][d] = r; changed = true; }
        }
      }
      if (changed) { j.at = new Date().toISOString(); await chrome.storage.local.set({ [KEY]: a }); }
      return changed;
    },
    KEY
  };
  root.GSTLists = Lists;
})(typeof window !== 'undefined' ? window : globalThis);
