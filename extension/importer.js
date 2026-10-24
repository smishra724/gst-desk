/* GST Desk – imports a registered client's details from the GST portal into the client master.
   Runs on *.gst.gov.in only while an import is active (storage key gstf_import).
   Logs in with the saved GST ID + password (the user types the CAPTCHA), opens the profile page,
   reads every label/value, list and table on it (clicking through its tabs) and hands the result
   to GST Desk, which maps it to client-master fields and asks before overwriting anything. */
(function () {
  'use strict';
  if (window.__gstfImporter) return;
  window.__gstfImporter = true;

  const KEY = 'gstf_import', RESULT = 'gstf_import_result', TAUGHT = 'gstf_import_taught';
  const sleep = (ms) => new Promise(r => setTimeout(r, ms));
  const n = (s) => String(s || '').replace(/\s+/g, ' ').trim();
  const esc = (s) => String(s || '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const send = (msg) => new Promise(res => { try { chrome.runtime.sendMessage(msg, r => { void chrome.runtime.lastError; res(r || {}); }); } catch (_) { res({}); } });
  const load = async () => (await chrome.storage.local.get(KEY))[KEY] || null;
  const mutate = async (fn) => { const r = await load(); if (!r) return null; fn(r); await chrome.storage.local.set({ [KEY]: r }); return r; };
  const visible = (e) => !!e && (e.checkVisibility ? e.checkVisibility({ visibilityProperty: true }) : !!(e.offsetWidth || e.offsetHeight || e.getClientRects().length) && getComputedStyle(e).visibility !== 'hidden');

  /* ---------- JSON the portal page itself downloaded (copied by hook.js) ---------- */
  const jsonBag = [];
  window.addEventListener('message', (e) => {
    if (e.source !== window || !e.data || e.data.__gstf !== 'json') return;
    const s = JSON.stringify(e.data.data);
    if (jsonBag.some(j => j.s === s)) return;
    jsonBag.push({ url: e.data.url, data: e.data.data, s });
    if (jsonBag.length > 30) jsonBag.shift();
  });
  window.postMessage({ __gstf: 'flush' }, location.origin);
  const jsonForResult = () => { let size = 0; const out = []; for (const j of jsonBag.slice().reverse()) { size += j.s.length; if (size > 600000) break; out.unshift({ url: j.url, data: j.data }); } return out; };

  /* ---------- banner ---------- */
  const host = document.createElement('div');
  host.style.cssText = 'position:fixed;right:16px;bottom:16px;z-index:2147483647';
  const sh = host.attachShadow({ mode: 'open' });
  const BANNER_CSS = `*{box-sizing:border-box;font-family:system-ui,-apple-system,"Segoe UI",Roboto,sans-serif}
    .b{width:min(440px,calc(100vw - 32px));background:#1d2433;color:#fff;border-radius:12px;box-shadow:0 10px 30px rgba(0,0,0,.3);padding:11px 13px;font-size:13px;line-height:1.45}
    .s{color:#c8d0e0;font-size:12.5px;margin-top:2px}
    .you{background:#fff4e5;color:#7a4100;border-radius:8px;padding:8px 10px;margin-top:9px;font-weight:600}
    .err{background:#fdecea;color:#b42318;border-radius:8px;padding:8px 10px;margin-top:9px}
    .ok{background:#e6f4ea;color:#1a7f37;border-radius:8px;padding:8px 10px;margin-top:9px;font-weight:600}
    .row{display:flex;gap:6px;margin-top:9px;flex-wrap:wrap}
    button{font:inherit;font-size:12px;border:1px solid #4a5263;background:#2a3245;color:#fff;border-radius:7px;padding:5px 10px;cursor:pointer}
    button.p{background:#3b7be0;border-color:#3b7be0}`;
  let view = { msg: '', you: '', err: '', ok: '' };
  let lastKey = '';
  function banner(run, patch = {}) {
    view = { ...view, ...patch };
    if (!run || run.status === 'stopped') { host.remove(); return; }
    const key = JSON.stringify([view, run.status, run.stage, run.name]);
    if (host.isConnected && key === lastKey) return;   // nothing changed – don't redraw (redrawing every tick made buttons hard to click)
    lastKey = key;
    if (!host.isConnected) document.documentElement.appendChild(host);
    sh.innerHTML = `<style>${BANNER_CSS}</style><div class="b" role="status" aria-live="polite">
      <div><b>GST Desk · Importing details${run.name ? ' – ' + esc(run.name) : ''}</b><div class="s">${esc(view.msg || '')}</div></div>
      ${view.you ? `<div class="you">${esc(view.you)}</div>` : ''}
      ${view.err ? `<div class="err">${esc(view.err)}</div>` : ''}
      ${view.ok ? `<div class="ok">${esc(view.ok)}</div>` : ''}
      <div class="row">
        <button class="${run.status === 'done' ? '' : 'p'}" id="read">${run.status === 'done' ? 'Read this page too' : 'Read this page'}</button>
        ${run.status !== 'done' && run.stage === 'profile' ? '<button id="teach">Teach: I’ll click the profile link</button>' : ''}
        <button id="mgr">Open GST Desk</button>
        ${run.status === 'done' ? '<button id="diag" title="Saves a file of what GST Desk read on the portal, to send if something was picked up wrongly">Save what was read</button>' : ''}
        <button id="stop">${run.status === 'done' ? 'Close' : 'Stop'}</button>
      </div></div>`;
    const on = (id, fn) => { const e = sh.getElementById(id); if (e) e.onclick = fn; };
    on('read', () => readHere(true));
    on('teach', () => teachProfile());
    on('diag', async () => {
      const r = (await chrome.storage.local.get(RESULT))[RESULT];
      if (!r) return;
      const a = document.createElement('a');
      a.href = URL.createObjectURL(new Blob([JSON.stringify({ page: location.href, read: r.data }, null, 1)], { type: 'application/json' }));
      a.download = 'gst-desk-portal-read.json'; document.body.appendChild(a); a.click(); a.remove();
    });
    on('mgr', () => send({ type: 'open-manager', hash: '#clients' }));
    on('stop', () => mutate(r => { r.status = 'stopped'; }).then(() => { host.remove(); window.__gstfAutopilotOn = false; }));
  }

  /* ---------- reading a page ---------- */
  const INLINE = new Set(['B', 'STRONG', 'I', 'EM', 'SPAN', 'A', 'BR', 'SMALL', 'U', 'FONT', 'SUP', 'SUB', 'ABBR', 'LABEL', 'IMG', 'svg']);
  const HEADING = (el) => /^H[1-6]$|^LEGEND$|^CAPTION$/.test(el.tagName) || el.getAttribute('role') === 'heading' ||
    /(^|\s)(panel-heading|panel-title|card-header|card-title|section-title|tbl-hdr|lbl-heading)(\s|$)/.test(el.className || '');
  const LABEL_RX = new RegExp('^(' + [
    'legal name', 'trade name', 'constitution', 'gstin', 'date of', 'effective date', 'taxpayer type', 'type of', 'address', 'nature of',
    'centre jurisdiction', 'center jurisdiction', 'state jurisdiction', 'administrative office', 'other office', 'jurisdiction', 'ward', 'circle',
    'commissionerate', 'division', 'range', 'name', 'first name', 'middle name', 'last name', 'full name', 'designation', 'mobile', 'e-?mail',
    'telephone', 'phone', 'din', 'dpin', 'pan', 'permanent account', 'hsn', 'sac', 'description', 'building', 'flat', 'door', 'floor', 'premises',
    'road', 'street', 'locality', 'city', 'town', 'village', 'district', 'pin ?code', 'pincode', 'landmark', 'latitude', 'longitude', 'account',
    'ifsc', 'bank name', 'father', 'gender', 'citizen', 'aadhaar', 'cin', 'llpin', 'registration', 'commencement', 'incorporation', 'composition',
    'whether', 'promoters', 'partners', 'directors', 'details of', 'authori[sz]ed', 'business activit', 'core business', 'status', 'resident',
    'office email', 'office mobile', 'contact', 'corporate identity', 'llp identification'
  ].join('|') + ')\\b', 'i');
  const PEOPLE_LIST = /^(name of (the )?(proprietor|promoters?|partners?|directors?|karta|members?|trustees?)|promoters?\s*\/\s*partners?|names? of (promoters?|partners?|directors?)|(promoters?|partners?|directors?)( name)?)$/i;
  const clean = (t) => n(t).replace(/\s*\*\s*$/, '').replace(/^\*\s*/, '');
  const isLabel = (t) => { t = clean(t); if (!t || t.length > 70 || t.split(' ').length > 10) return false; if (/:$/.test(t)) return true; if (/\d{4,}/.test(t) || /,/.test(t) || /\s-\s/.test(t)) return false; if (/^state( name)?$/i.test(t)) return true; return LABEL_RX.test(t) && !/^state bank/i.test(t); };

  function labelOfControl(c) {
    const a = window.__gstfApi;
    if (a && a.labelOf) { try { const l = a.labelOf(c); if (l) return l; } catch (_) { /* fall through */ } }
    if (c.id) { const l = document.querySelector(`label[for="${CSS.escape(c.id)}"]`); if (l) return n(l.textContent); }
    return n(c.getAttribute('aria-label') || c.placeholder || c.name || '');
  }

  // Page chrome that never holds the client's details (menus, header bar, footer, our own panels)
  const SKIP_SEL = '[role=tablist], .nav-tabs, .nav-pills, ul.nav, .navbar, .breadcrumb, .dropdown-menu, [role=navigation], [role=menu], .quick-links, .footer, #footer, .modal:not(.in):not(.show)';
  const DESIG = /^(managing |designated |working |sleeping |whole[- ]time |executive |non[- ]executive |independent |additional )?(partner|director|proprietor|karta|member|trustee|coparcener|chairman|chairperson|ceo|cfo|secretary|managing director|authori[sz]ed signatory)s?$/i;
  const nameText = (t) => n(String(t).replace(/[^A-Za-z .'\-]+/g, ' '));
  const looksLikeName = (t) => { const x = nameText(t); return x.length >= 3 && x.length >= n(t).length - 3 && /^[A-Za-z][A-Za-z .'-]{2,60}$/.test(x) && x.split(' ').length <= 6 && !isLabel(x) && !DESIG.test(x) &&
    !/\b(jurisdiction|office|commissionerate|division|range|ward|circle|charge|state|zone|address|business|services?|limited|ltd|llp|private|india|road|street|nagar|floor|building|district|details|contacts?|place|signatory|promoters?|partners|directors|profile|registration|status)\b/i.test(x); };

  function collect(defaultSection) {
    const data = { pairs: [], tables: [], gstin: '' };
    let section = defaultSection || '';
    const leaves = [];
    const sx = window.scrollX, sy = window.scrollY;
    const walk = (el) => {
      for (const c of el.children) {
        if (c === host || /^(SCRIPT|STYLE|NOSCRIPT|TEMPLATE|OPTION|BUTTON|NAV|HEADER|FOOTER|SVG|IMG|IFRAME)$/i.test(c.tagName)) continue;
        if (!visible(c)) continue;
        if (c.matches(SKIP_SEL)) continue;
        if (HEADING(c)) { const t = clean(c.innerText); if (t && t.length < 90) { section = t; continue; } }
        if (c.tagName === 'TABLE') { if (!c.querySelector('table')) readTable(c, section, data); else walk(c); continue; }
        if (/^(INPUT|SELECT|TEXTAREA)$/.test(c.tagName)) { readControl(c, section, data); continue; }
        if (c.tagName === 'DL') { c.querySelectorAll('dt').forEach(dt => { const dd = dt.nextElementSibling; if (dd && dd.tagName === 'DD') data.pairs.push({ section, label: clean(dt.innerText).replace(/:$/, ''), value: n(dd.innerText) }); }); continue; }
        const kids = Array.from(c.children);
        if (!kids.length || kids.every(k => INLINE.has(k.tagName) && !k.querySelector('div,p,table,ul,li,input,select,textarea,h1,h2,h3,h4,h5,h6'))) {
          if (c.querySelector('input,select,textarea')) { walk(c); continue; }
          const t = n(c.innerText);
          if (t) {
            const r = c.getBoundingClientRect();
            // a leaf that is one block of bold text followed by plain text ("<b>Label</b> value") is split
            const first = c.firstElementChild;
            if (first && /^(B|STRONG|LABEL)$/.test(first.tagName) && c.childNodes[0] === first && isLabel(n(first.innerText)) && n(first.innerText).length < t.length) {
              leaves.push({ text: `${clean(first.innerText).replace(/:$/, '')}: ${n(t.slice(n(first.innerText).length)).replace(/^[:\-\s]+/, '')}`, section, x: r.left + sx, y: r.top + sy, w: r.width, h: r.height });
            } else leaves.push({ text: t, section, x: r.left + sx, y: r.top + sy, w: r.width, h: r.height });
          }
          continue;
        }
        walk(c);
      }
    };
    walk(document.body);

    // 1. "Label: value" written in one line
    const taken = new Set();
    leaves.forEach((L, i) => {
      const inl = /^([^:]{2,60}):\s*(.+)$/.exec(L.text);
      if (inl && isLabel(inl[1] + ':') && !isLabel(inl[2])) { data.pairs.push({ section: L.section, label: clean(inl[1]), value: n(inl[2]) }); taken.add(i); L.inline = true; }
    });
    // 2. Labels get the value nearest to them on screen: just below in the same column, or to the right on the same line.
    //    (Works whether the page lists label/value one after another or puts a row of labels above a row of values.)
    const labels = [], cands = [];
    leaves.forEach((L, i) => { if (!taken.has(i) && isLabel(L.text)) labels.push(i); });
    const isLab = new Set(labels);
    for (const li of labels) {
      const L = leaves[li];
      leaves.forEach((V, vi) => {
        if (vi === li || isLab.has(vi) || taken.has(vi)) return;
        const below = V.y >= L.y + L.h - 3 && V.y - (L.y + L.h) < 45 && Math.abs(V.x - L.x) < 25;
        const right = Math.abs((V.y + V.h / 2) - (L.y + L.h / 2)) < Math.max(L.h, V.h) / 2 + 3 && V.x >= L.x + L.w - 3 && V.x - (L.x + L.w) < 320;
        if (below) cands.push({ li, vi, d: V.y - (L.y + L.h) });
        else if (right) cands.push({ li, vi, d: V.x - (L.x + L.w) + 6 });
      });
    }
    cands.sort((a, b) => a.d - b.d);
    const valOf = new Map(), usedV = new Set();
    for (const c of cands) { if (valOf.has(c.li) || usedV.has(c.vi)) continue; valOf.set(c.li, c.vi); usedV.add(c.vi); }
    for (const li of labels) {
      const L = leaves[li];
      const label = clean(L.text).replace(/:$/, '');
      if (!valOf.has(li)) continue;
      const vals = [leaves[valOf.get(li)]];
      // continue down the same column for multi-line values (addresses, lists of names / activities)
      const people = PEOPLE_LIST.test(label);
      for (;;) {
        const last = vals[vals.length - 1];
        const nx = leaves.findIndex((V, vi) => !usedV.has(vi) && !isLab.has(vi) && !taken.has(vi) && Math.abs(V.x - last.x) < 12 &&
          V.y >= last.y + last.h - 3 && V.y - (last.y + last.h) < (people ? 30 : 10));
        if (nx < 0 || vals.length >= 25) break;
        usedV.add(nx); vals.push(leaves[nx]);
      }
      vals.forEach(v => { v.used = true; });
      if (people) vals.forEach(v => data.pairs.push({ section: /promot|partner|director|proprietor|karta|member|trustee/i.test(L.section) ? L.section : 'Promoters / Partners (' + label + ')', label: 'Name', value: v.text }));
      else data.pairs.push({ section: L.section, label, value: vals.map(v => v.text).join(', ') });
    }
    // 3. People shown as cards under a Promoters / Partners / Authorised signatory heading: name, then designation and address lines
    const PEOPLE_SEC = /promot|partner|director|proprietor|karta|trustee|authori[sz]ed signator/i;
    for (let i = 0; i < leaves.length; i++) {
      const L = leaves[i];
      if (taken.has(i) || isLab.has(i) || L.used || !PEOPLE_SEC.test(L.section) || !looksLikeName(L.text)) continue;
      data.pairs.push({ section: L.section, label: 'Name', value: nameText(L.text) });
      for (let j = i + 1; j < leaves.length && j <= i + 6; j++) {
        const V = leaves[j];
        if (V.section !== L.section || taken.has(j) || isLab.has(j) || V.used || looksLikeName(V.text)) break;
        if (DESIG.test(nameText(V.text))) data.pairs.push({ section: L.section, label: 'Designation', value: nameText(V.text) });
        else if (/\b\d{6}\b/.test(V.text)) data.pairs.push({ section: L.section, label: 'Address', value: V.text });
        V.used = true;
      }
    }
    const g = data.pairs.find(p => /^gstin/i.test(p.label) && /\d{2}[A-Z]{5}\d{4}[A-Z][1-9A-Z]Z[0-9A-Z]/.test(p.value));
    const anyG = leaves.map(l => (l.text.match(/\b\d{2}[A-Z]{5}\d{4}[A-Z][1-9A-Z]Z[0-9A-Z]\b/) || [])[0]).find(Boolean);
    data.gstin = g ? g.value.match(/\d{2}[A-Z]{5}\d{4}[A-Z][1-9A-Z]Z[0-9A-Z]/)[0] : anyG || pageGstins()[0] || '';
    return data;
  }
  // GSTINs in the page header / welcome bar (read once per page – innerText of the whole page is slow)
  let gCache = null;
  function pageGstins() {
    if (gCache && gCache.url === location.href && Date.now() - gCache.at < 8000) return gCache.list;
    const list = Array.from(new Set(document.body.textContent.match(/\b\d{2}[A-Z]{5}\d{4}[A-Z][1-9A-Z]Z[0-9A-Z]\b/g) || []));
    gCache = { url: location.href, at: Date.now(), list };
    return list;
  }

  function readControl(c, section, data) {
    if (c.type === 'hidden' || c.type === 'password' || c.type === 'file' || c.type === 'button' || c.type === 'submit') return;
    const label = clean(labelOfControl(c)).replace(/:$/, '');
    if (!label) return;
    if (c.type === 'checkbox' || c.type === 'radio') { if (c.checked) data.pairs.push({ section, label: '(ticked)', value: label }); return; }
    const v = c.tagName === 'SELECT' ? (c.selectedIndex > 0 || (c.options[c.selectedIndex] && !/^select|^-+/i.test(c.options[c.selectedIndex].text)) ? n(c.options[c.selectedIndex] && c.options[c.selectedIndex].text) : '') : n(c.value);
    if (v && !/^select\b/i.test(v)) data.pairs.push({ section, label, value: v });
  }

  function readTable(t, section, data) {
    const rows = Array.from(t.rows).filter(visible);
    if (!rows.length) return;
    const cap = t.caption ? clean(t.caption.innerText) : '';
    const sec = cap || section;
    let hi = rows.findIndex(r => r.cells.length > 1 && Array.from(r.cells).every(c => c.tagName === 'TH'));
    if (hi >= 0) {
      const headers = Array.from(rows[hi].cells).map(c => clean(c.innerText));
      const body = rows.slice(hi + 1).map(r => Array.from(r.cells).map(c => n(c.innerText))).filter(r => r.some(Boolean));
      if (body.length) data.tables.push({ section: sec, headers, rows: body });
      return;
    }
    // label / value rows
    for (const r of rows) {
      const cells = Array.from(r.cells);
      for (let i = 0; i + 1 < cells.length; i += 2) {
        const l = clean(cells[i].innerText).replace(/:$/, ''), v = n(cells[i + 1].innerText);
        if (l && v && (cells[i].tagName === 'TH' || isLabel(l))) data.pairs.push({ section: sec, label: l, value: v });
      }
    }
  }

  function merge(a, b) {
    const k = (p) => [p.section, p.label, p.value].join('|');
    const seen = new Set(a.pairs.map(k));
    for (const p of b.pairs) if (!seen.has(k(p))) { seen.add(k(p)); a.pairs.push(p); }
    const tk = (t) => t.section + '|' + t.headers.join('|') + '|' + JSON.stringify(t.rows);
    const ts = new Set(a.tables.map(tk));
    for (const t of b.tables) if (!ts.has(tk(t))) { ts.add(tk(t)); a.tables.push(t); }
    a.gstin = a.gstin || b.gstin;
    const js = new Set((a.json || []).map(j => JSON.stringify(j.data)));
    a.json = (a.json || []).concat((b.json || []).filter(j => !js.has(JSON.stringify(j.data))));
    return a;
  }

  async function readWithTabs() {
    let data = collect('');
    const MENU_ACT = /log ?out|sign ?out|download|print|edit|amend|cancel|delete|submit|certificate|change password|activate|deactivate|register|update|e-?invoice|e-?way/i;
    const MENU_EXACT = /^(home|help|search|services|user services|gst law|dashboard|news|downloads?|file|pay|returns?|payments?|ledgers?)$/i;
    const MENU = { test: (t) => MENU_ACT.test(t) || MENU_EXACT.test(n(t)) };
    const tabs = Array.from(document.querySelectorAll('[role=tab], [data-toggle=tab], [data-bs-toggle=tab], .nav-tabs > li > a, .nav-tabs > li > button, .nav-pills > li > a'))
      .filter(e => visible(e) && !host.contains(e) && !e.closest('.navbar, header, nav:not(.tabs), [role=navigation], .dropdown-menu, footer') &&
        !MENU.test(n(e.textContent)) && n(e.textContent).length < 50 &&
        (!e.getAttribute('href') || /^(#|javascript)/i.test(e.getAttribute('href'))))
      .slice(0, 8);
    for (const tab of tabs) {
      if (!tab.isConnected) continue;
      const name = clean(tab.innerText);
      tab.click();
      await sleep(700);
      data = merge(data, collect(name));
    }
    return data;
  }

  async function readHere(manual) {
    const run = await load();
    if (!run) return;
    banner(run, { msg: 'Reading this page…', you: '', err: '' });
    // wait for the page's details to finish loading (the portal fills them in after the page opens)
    for (let i = 0; i < 12 && !jsonBag.length && !/legal name|trade name|constitution of business|gstin/i.test(document.body.textContent.slice(0, 200000)); i++) await sleep(500);
    const data = await readWithTabs();
    data.json = jsonForResult();
    const got = data.pairs.length + data.tables.reduce((s, t) => s + t.rows.length, 0) + data.json.length;
    if (!got) { banner(run, { msg: '', err: 'Nothing readable on this page. Open the client’s profile (Dashboard → View/My Profile) and click “Read this page”.' }); return; }
    if (run.gstin && data.gstin && data.gstin !== run.gstin && !pageGstins().includes(run.gstin)) {
      banner(run, { msg: '', err: `This page is for ${data.gstin}, but the client’s GSTIN is ${run.gstin}. Log out and log in with this client’s GST ID.` });
      return;
    }
    const prev = (await chrome.storage.local.get(RESULT))[RESULT];
    const all = prev && prev.clientId === run.clientId && run.status === 'done' ? merge(prev.data, data) : data;
    const at = new Date().toISOString();
    await chrome.storage.local.set({ [RESULT]: { clientId: run.clientId, data: all, at, url: location.href } });
    const r2 = await mutate(r => { r.status = 'done'; r.stage = 'done'; r.pages = (r.pages || 0) + 1; });
    banner(r2, { msg: '', err: '', you: '', ok: `Read ${got} details${manual ? ' from this page' : ''} and sent them to GST Desk. Open GST Desk to see them filled in. You can open another page (e.g. Services → Registration → Amendment of non-core fields → each tab, without saving) and click “Read this page too”.` });
  }

  /* ---------- profile link ---------- */
  const PROFILE_RX = /^(my profile|view profile|profile|view my profile|taxpayer profile)$/i;
  function findProfileLink(taught) {
    const els = Array.from(document.querySelectorAll('a, button, [role=link], [role=menuitem], li[ng-click], span[ng-click]')).filter(e => !host.contains(e));
    if (taught) { const t = els.find(e => n(e.textContent) === taught && (visible(e) || e.tagName === 'A')); if (t) return t; }
    return els.find(e => PROFILE_RX.test(n(e.textContent)) && (visible(e) || (e.tagName === 'A' && e.getAttribute('href') && !/^#$/.test(e.getAttribute('href')))));
  }
  let teaching = false;
  function teachProfile() {
    teaching = true;
    load().then(r => banner(r, { you: 'Click the link that opens the client’s profile. GST Desk will remember it.', err: '' }));
    const h = async (ev) => {
      if (host.contains(ev.target)) return;
      document.removeEventListener('click', h, true);
      const el = ev.target.closest('a,button,[role=link],[role=menuitem],li,span') || ev.target;
      const text = n(el.innerText || el.textContent);
      if (text && text.length < 60) await chrome.storage.local.set({ [TAUGHT]: { profile: text } });
      teaching = false;
      await mutate(r => { r.stage = 'reading'; r.navAt = Date.now(); });
    };
    document.addEventListener('click', h, true);
  }
  const isProfilePage = () => /profile/i.test(location.pathname + location.hash) ||
    Array.from(document.querySelectorAll('h1,h2,h3,h4,.page-title,.breadcrumb')).some(h => visible(h) && /\bprofile\b|registration details/i.test(h.innerText));

  /* ---------- login ---------- */
  const setVal = (el, v) => {
    const proto = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, v);
    ['input', 'change', 'keyup', 'blur'].forEach(t => el.dispatchEvent(new Event(t, { bubbles: true })));
  };

  // Remember a password typed on the login page (saved for the client once the login works)
  function watchTyped(user, pass, clientId) {
    if (pass.__gstfWatch === clientId) return;
    pass.__gstfWatch = clientId;
    let t = null;
    const now = () => { clearTimeout(t); if (pass.value) send({ type: 'login-typed', clientId, username: user ? user.value : '', password: pass.value }); };
    const later = () => { clearTimeout(t); t = setTimeout(now, 250); };
    const sendIt = now;
    [pass, user].forEach(el => el && el.addEventListener('input', later));
    [pass, user].forEach(el => el && ['change', 'blur'].forEach(ev => el.addEventListener(ev, now)));
    document.addEventListener('keydown', (e) => { if (e.key === 'Enter') sendIt(); }, true);
    document.addEventListener('mousedown', (e) => { const b = e.target.closest && e.target.closest('button, input[type=submit], a'); if (b && /log ?in|sign ?in/i.test(b.textContent || b.value || '')) sendIt(); }, true);
  }
  async function doLogin(run) {
    const pass = Array.from(document.querySelectorAll('input[type=password]')).find(visible);
    const user = document.querySelector('input#username, input[name=username], input[name=user_name], input[autocomplete=username]') ||
      Array.from(document.querySelectorAll('input[type=text]')).find(i => visible(i) && /user/i.test(i.id + i.name + i.placeholder));
    if (!pass || !user) return false;
    watchTyped(user, pass, run.clientId);
    if (run.loginFilledAt && Date.now() - run.loginFilledAt < 15000 && pass.value) return true;
    const cred = await send({ type: 'get-login', clientId: run.clientId });
    if (cred.username && user.value !== cred.username) setVal(user, cred.username);
    if (cred.password && pass.value !== cred.password) setVal(pass, cred.password);
    await mutate(r => { r.loginFilledAt = Date.now(); r.stage = 'login'; });
    const cap = document.querySelector('input#captcha, input[name=captcha], input[id*=captcha i], input[name*=captcha i], input[placeholder*=character i]');
    const you = cred.error === 'locked' ? `Passwords are locked in GST Desk – type the password for ${run.name}, then the CAPTCHA, then LOGIN.`
      : !cred.password ? `No GST password saved for ${run.name}. Type it once (GST Desk saves it for next time), then the CAPTCHA, then click LOGIN.`
      : `GST ID and password filled for ${run.name}. Type the CAPTCHA and click LOGIN.`;
    banner(await load(), { msg: 'Step 1 of 2 · Log in', you, err: '', ok: '' });
    if (cap) { cap.scrollIntoView({ block: 'center' }); cap.focus(); cap.style.outline = '3px solid #d97706'; }
    return true;
  }
  const loggedIn = () => !!document.querySelector('a[href*=logout i], [ng-click*=logout i]') || Array.from(document.querySelectorAll('a,button')).some(e => !host.contains(e) && /^(log ?out|sign ?out)$/i.test(n(e.textContent)));

  /* ---------- main loop ---------- */
  let busy = false;
  async function step() {
    const run = await load();
    if (!run || run.status === 'stopped') { if (host.isConnected) host.remove(); window.__gstfAutopilotOn = false; return; }
    window.__gstfAutopilotOn = true;
    if (run.status === 'done') { banner(run); return; }
    if (teaching) return;
    if (await doLogin(run)) return;
    if (!loggedIn()) {
      if (/services\.gst\.gov\.in$/.test(location.hostname) && /\/services\/login/.test(location.pathname)) return;
      if (!run.loginNav || Date.now() - run.loginNav > 15000) { await mutate(r => { r.loginNav = Date.now(); }); location.href = 'https://services.gst.gov.in/services/login'; }
      return;
    }
    if (run.stage === 'login') send({ type: 'login-ok', clientId: run.clientId });
    // Someone is already logged in when the import starts: keep it only if it is this client, otherwise log out first.
    if (run.stage === 'fresh') {
      if (run.gstin && pageGstins().includes(run.gstin)) await mutate(r => { r.stage = 'profile'; });
      else {
        await mutate(r => { r.stage = 'login'; });
        banner(await load(), { msg: 'Logging out the previous login first…', you: '', err: '' });
        const out = Array.from(document.querySelectorAll('a, button')).find(e => !host.contains(e) && /^\s*(log ?out|sign ?out)\s*$/i.test(e.textContent || '')) || document.querySelector('a[href*=logout i]');
        if (out) out.click(); else location.href = 'https://services.gst.gov.in/services/logout';
        return;
      }
    }
    // Logged in. Is it the right client?
    const pageG = pageGstins();
    if (run.gstin && pageG.length && !pageG.includes(run.gstin) && !run.mismatchOk) {
      banner(run, { msg: '', err: `The portal is logged in as ${pageG[0]}, not ${run.gstin} (${run.name}). Log out, then log in with this client’s GST ID.` });
      return;
    }
    if (isProfilePage()) {
      if (run.readUrl === location.href && run.status === 'done') return;
      await sleep(1200);
      await mutate(r => { r.readUrl = location.href; });
      await readHere(false);
      return;
    }
    if (run.stage === 'login') await mutate(r => { r.stage = 'profile'; });
    const taught = ((await chrome.storage.local.get(TAUGHT))[TAUGHT] || {}).profile;
    const link = findProfileLink(taught);
    const r = await load();
    if (link && (!r.navAt || Date.now() - r.navAt > 6000)) {
      await mutate(x => { x.navAt = Date.now(); x.stage = 'reading'; });
      banner(await load(), { msg: 'Step 2 of 2 · Opening the profile…', you: '', err: '' });
      link.click();
      return;
    }
    if (!link) banner(r, { msg: 'Step 2 of 2 · Logged in', you: 'Open the client’s profile (Dashboard → View Profile / My Profile) – GST Desk reads it automatically. Or click “Teach” and then the profile link.', err: '' });
  }
  async function tick() {
    if (busy) return;
    busy = true;
    try { await step(); } catch (e) { banner(await load(), { err: 'Paused: ' + e.message }); }
    busy = false;
  }
  chrome.storage.onChanged.addListener((ch, area) => { if (area === 'local' && ch[KEY]) tick(); });
  setInterval(() => { if (!document.hidden) tick(); }, 2000);
  setTimeout(tick, 600);
})();
