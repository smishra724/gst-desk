/* Returns download runner on the GST portal.
   Works through the queue built in the manager: logs in each client (you type the CAPTCHA),
   opens the returns dashboard, picks the period and clicks the download buttons.
   If it can't find a button it pauses and asks you to click it once; it remembers that. */
(function () {
  'use strict';
  if (window.top !== window || window.__gstfReturns) return;
  window.__gstfReturns = true;

  const G = window.GSTR, K = G.KEYS;
  const DASH = 'https://return.gst.gov.in/returns/auth/dashboard';
  const LOGIN = 'https://services.gst.gov.in/services/login';
  const sleep = (ms) => new Promise(r => setTimeout(r, ms));
  const norm = (s) => String(s || '').replace(/\s+/g, ' ').trim();
  const lower = (s) => norm(s).toLowerCase();
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const send = (msg) => new Promise(res => { try { chrome.runtime.sendMessage(msg, (r) => res(r || {})); } catch (_) { res({}); } });

  /* ---------- recipes: how to get each file (button texts are regexes, case-insensitive) ---------- */
  const TILE = { GSTR1: /\bgstr[\s-]*1\b(?![\s-]*a\b)/i, GSTR3B: /gstr[\s-]*3b/i, GSTR2B: /gstr[\s-]*2b/i };
  const RECIPES = {
    GSTR1_PDF: [
      { do: 'dashboard' }, { do: 'period' },
      { do: 'click', name: 'VIEW on the GSTR-1 tile', tile: 'GSTR1', text: ['^view$', '^view gstr-?1', '^view return'], nav: true },
      { do: 'click', name: 'VIEW SUMMARY', text: ['view summary', 'summary'], optional: true },
      { do: 'download', name: 'DOWNLOAD (PDF) of GSTR-1 summary', text: ['download.*pdf', 'pdf'] }
    ],
    GSTR1_JSON: [
      { do: 'dashboard' }, { do: 'period' },
      { do: 'click', name: 'DOWNLOAD on the GSTR-1 tile', tile: 'GSTR1', text: ['^download$', 'download'], nav: true },
      { do: 'generate', name: 'GENERATE JSON FILE TO DOWNLOAD', text: ['generate json', 'json'], link: ['click here to download', 'file\\s*\\d', 'download.*json'] }
    ],
    GSTR3B_PDF: [
      { do: 'dashboard' }, { do: 'period' },
      { do: 'download', name: 'DOWNLOAD on the GSTR-3B tile', tile: 'GSTR3B', text: ['^download$', 'download.*pdf', 'download filed'] }
    ],
    GSTR2B_XLSX: [
      { do: 'dashboard' }, { do: 'period' },
      { do: 'click', name: 'DOWNLOAD on the GSTR-2B tile', tile: 'GSTR2B', text: ['^download$', 'download'], nav: true },
      { do: 'download', name: 'GENERATE / DOWNLOAD EXCEL', text: ['excel', 'xlsx'] }
    ],
    GSTR2B_JSON: [
      { do: 'dashboard' }, { do: 'period' },
      { do: 'click', name: 'DOWNLOAD on the GSTR-2B tile', tile: 'GSTR2B', text: ['^download$', 'download'], nav: true },
      { do: 'download', name: 'GENERATE / DOWNLOAD JSON', text: ['json'] }
    ]
  };
  const FILE_LABEL = { GSTR1_PDF: 'GSTR-1 summary PDF', GSTR1_JSON: 'GSTR-1 JSON', GSTR3B_PDF: 'GSTR-3B PDF', GSTR2B_XLSX: 'GSTR-2B Excel', GSTR2B_JSON: 'GSTR-2B JSON' };
  const KIND = { GSTR1_PDF: 'Summary', GSTR1_JSON: 'Details', GSTR3B_PDF: 'Filed', GSTR2B_XLSX: 'Details', GSTR2B_JSON: 'Details' };

  let taught = {};
  const loadQueue = async () => (await chrome.storage.local.get(K.queue))[K.queue] || null;
  const saveQueue = (q) => chrome.storage.local.set({ [K.queue]: q });

  /* ---------- page helpers ---------- */
  const visible = (el) => !!el && el.isConnected && !el.closest('#gstf-runner') && el.getClientRects().length > 0 &&
    getComputedStyle(el).visibility !== 'hidden' && getComputedStyle(el).display !== 'none';
  const clickables = (root = document) => Array.from(root.querySelectorAll('button, a, input[type=button], input[type=submit], [role=button], .btn'))
    .filter(visible).filter(el => !el.disabled && !el.classList.contains('disabled'));
  const labelText = (el) => norm(el.innerText || el.value || el.getAttribute('aria-label') || el.title || '');

  const MIX = { GSTR1: /\bgstr[\s-]*1\b(?![\s-]*a\b)/i, GSTR3B: /gstr[\s-]*3b/i, GSTR2B: /gstr[\s-]*2b/i };
  function tileFor(key) {
    const rx = TILE[key];
    const heads = Array.from(document.querySelectorAll('h1,h2,h3,h4,h5,p,span,div,strong,b,label'))
      .filter(e => visible(e) && e.children.length <= 2 && norm(e.textContent).length < 80 && rx.test(norm(e.textContent)));
    for (const h of heads) {
      let a = h.parentElement;
      for (let d = 0; a && d < 7; d++, a = a.parentElement) {
        const t = norm(a.textContent);
        if (Object.entries(MIX).some(([k, r]) => k !== key && r.test(t))) break;
        if (clickables(a).length) return a;
      }
    }
    return null;
  }

  function findTarget(step, recipeKey, idx) {
    const scope = step.tile ? tileFor(step.tile) : document;
    if (step.tile && !scope) return null;
    const over = taught[recipeKey] && taught[recipeKey][idx];
    const pats = (over ? [over] : []).concat(step.text).map(t => new RegExp(t, 'i'));
    const list = clickables(scope);
    for (const rx of pats) {
      const hit = list.find(el => rx.test(labelText(el)));
      if (hit) return hit;
    }
    return null;
  }

  async function waitFor(fn, ms) {
    const end = Date.now() + ms;
    while (Date.now() < end) { const r = fn(); if (r) return r; await sleep(400); }
    return null;
  }

  function fyOf(period) { const [y, m] = period.split('-').map(Number); return m >= 4 ? `${y}-${String((y + 1) % 100).padStart(2, '0')}` : `${y - 1}-${String(y % 100).padStart(2, '0')}`; }
  const MONTH = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  const QSTART = { 4: 'apr', 5: 'apr', 6: 'apr', 7: 'jul', 8: 'jul', 9: 'jul', 10: 'oct', 11: 'oct', 12: 'oct', 1: 'jan', 2: 'jan', 3: 'jan' };
  const QNUM = { 4: 1, 5: 1, 6: 1, 7: 2, 8: 2, 9: 2, 10: 3, 11: 3, 12: 3, 1: 4, 2: 4, 3: 4 };

  function selectNear(rx) {
    for (const s of document.querySelectorAll('select')) {
      if (!visible(s)) continue;
      let lab = '';
      if (s.id) { const l = document.querySelector(`label[for="${CSS.escape(s.id)}"]`); if (l) lab = l.textContent; }
      if (!lab) { let a = s.parentElement; for (let d = 0; a && d < 3 && !lab; d++, a = a.parentElement) { const l = a.querySelector('label'); if (l) lab = l.textContent; } }
      if (rx.test(lab + ' ' + (s.name || '') + ' ' + (s.id || '') + ' ' + (s.getAttribute('ng-model') || ''))) return s;
    }
    return null;
  }
  function choose(sel, test) {
    const opt = Array.from(sel.options).find(o => test(lower(o.text)));
    if (!opt) return false;
    if (sel.value !== opt.value) {
      sel.value = opt.value; opt.selected = true;
      sel.dispatchEvent(new Event('input', { bubbles: true })); sel.dispatchEvent(new Event('change', { bubbles: true }));
    }
    return true;
  }

  async function pickPeriod(period) {
    const [y, m] = period.split('-').map(Number);
    const fy = fyOf(period);
    const fySel = await waitFor(() => selectNear(/financial\s*year|fin_?year|finyr|\bfy\b/i), 15000);
    if (!fySel) return 'Could not find the Financial Year box';
    const short = fy.replace(/^(\d{4})-(\d{2})$/, '$1-$2');
    if (!choose(fySel, t => t.includes(short) || t.includes(`${fy.slice(0, 4)}-20${fy.slice(5)}`))) return `Financial year ${fy} is not in the list`;
    await sleep(700);
    const qSel = selectNear(/quarter/i);
    if (qSel) {
      await waitFor(() => qSel.options.length > 1, 5000);
      choose(qSel, t => t.includes(QSTART[m]) || new RegExp(`quarter\\s*${QNUM[m]}\\b|\\bq${QNUM[m]}\\b`).test(t));
      await sleep(700);
    }
    const pSel = await waitFor(() => selectNear(/period|month|tax\s*period/i), 6000);
    if (pSel) {
      await waitFor(() => pSel.options.length > 1, 5000);
      if (!choose(pSel, t => t.startsWith(MONTH[m - 1].toLowerCase()) || t.startsWith(MONTH[m - 1].slice(0, 3).toLowerCase()))) return `${MONTH[m - 1]} is not in the Period list (quarterly filer?)`;
      await sleep(400);
    }
    const search = clickables().find(b => /^search$/i.test(labelText(b)));
    if (!search) return 'Could not find the SEARCH button';
    search.click();
    const tiles = await waitFor(() => Object.keys(TILE).some(k => tileFor(k)), 15000);
    return tiles ? '' : 'Return tiles did not appear after SEARCH';
  }

  /* ---------- banner ---------- */
  const host = document.createElement('div');
  host.id = 'gstf-runner';
  host.style.cssText = 'position:fixed;z-index:2147483647;left:16px;bottom:16px;';
  const sh = host.attachShadow({ mode: 'open' });
  const BANNER_CSS = `*{box-sizing:border-box;font-family:system-ui,-apple-system,"Segoe UI",Roboto,sans-serif}
    .b{width:min(440px,calc(100vw - 32px));background:#1d2433;color:#fff;border-radius:12px;box-shadow:0 10px 30px rgba(0,0,0,.3);padding:10px 12px;font-size:13px;line-height:1.4}
    .t{display:flex;gap:8px;align-items:center;justify-content:space-between}
    .t b{font-size:13px} .s{color:#c8d0e0;font-size:12px;margin-top:2px}
    .you{background:#fff4e5;color:#7a4100;border-radius:8px;padding:7px 9px;margin-top:8px;font-weight:600}
    .err{background:#fdecea;color:#b42318;border-radius:8px;padding:7px 9px;margin-top:8px}
    .row{display:flex;gap:6px;margin-top:8px;flex-wrap:wrap}
    button{font:inherit;font-size:12px;border:1px solid #4a5263;background:#2a3245;color:#fff;border-radius:7px;padding:5px 10px;cursor:pointer}
    button.p{background:#3b7be0;border-color:#3b7be0}
    .bar{height:4px;background:#2a3245;border-radius:4px;margin-top:8px;overflow:hidden}.bar i{display:block;height:100%;background:#5cc27a}`;
  let bannerState = { msg: '', you: '', err: '' };
  function banner(q, extra = {}) {
    bannerState = { ...bannerState, ...extra };
    if (!q || q.status === 'done' && !extra.force) { if (host.isConnected && (!q || q.status !== 'done')) host.remove(); }
    if (!q) return;
    if (!host.isConnected) document.documentElement.appendChild(host);
    const items = q.items;
    const it = items[q.cur.item];
    const all = items.flatMap(i => i.jobs);
    const done = all.filter(j => ['downloaded', 'requested', 'failed', 'skipped'].includes(j.status)).length;
    const job = it && it.jobs.find(j => j.status === 'pending' || j.status === 'running');
    const head = q.status === 'done' ? 'Downloads finished' : it ? `Client ${q.cur.item + 1} of ${items.length}: ${esc(it.name)}` : 'Downloads';
    const sub = q.status === 'done'
      ? `${all.filter(j => j.status === 'downloaded').length} downloaded · ${all.filter(j => j.status === 'requested').length} requested (run again later) · ${all.filter(j => j.status === 'failed').length} failed`
      : job ? `${FILE_LABEL[job.file]} · ${job.period} · ${q.status === 'paused' ? 'paused' : esc(bannerState.msg || 'working…')}` : esc(bannerState.msg || '');
    sh.innerHTML = `<style>${BANNER_CSS}</style><div class="b">
      <div class="t"><div><b>GST Desk · ${head}</b><div class="s">${sub}</div></div></div>
      <div class="bar"><i style="width:${all.length ? Math.round(done / all.length * 100) : 0}%"></i></div>
      ${bannerState.you ? `<div class="you">${esc(bannerState.you)}</div>` : ''}
      ${bannerState.err ? `<div class="err">${esc(bannerState.err)}</div>` : ''}
      <div class="row">
        ${q.status === 'running' ? '<button id="pause">Pause</button>' : q.status === 'paused' ? '<button class="p" id="resume">Resume</button>' : ''}
        ${q.status !== 'done' && job ? '<button id="skip">Skip this file</button><button id="skipc">Skip client</button>' : ''}
        ${q.status !== 'done' ? '<button id="stop">Stop</button>' : '<button id="close">Close</button>'}
        <button id="mgr">Open GST Desk</button>
      </div></div>`;
    const on = (id, fn) => { const e = sh.getElementById(id); if (e) e.onclick = fn; };
    on('pause', () => mutate(q2 => { q2.status = 'paused'; }));
    on('resume', () => { bannerState.err = ''; bannerState.you = ''; mutate(q2 => { q2.status = 'running'; }); });
    on('skip', () => mutate(q2 => { const j = curJob(q2); if (j) { j.status = 'skipped'; j.note = 'skipped by you'; } q2.status = 'running'; bannerState.err = ''; bannerState.you = ''; }));
    on('skipc', () => mutate(q2 => { const i = q2.items[q2.cur.item]; i.jobs.forEach(j => { if (j.status === 'pending' || j.status === 'running') { j.status = 'skipped'; j.note = 'client skipped'; } }); q2.status = 'running'; bannerState.err = ''; bannerState.you = ''; }));
    on('stop', () => mutate(q2 => { q2.status = 'stopped'; }).then(() => host.remove()));
    on('close', () => { host.remove(); mutate(q2 => { q2.dismissed = true; }); });
    on('mgr', () => send({ type: 'open-manager', hash: '#downloads' }));
  }
  const curJob = (q) => { const it = q.items[q.cur.item]; return it && it.jobs.find(j => j.status === 'pending' || j.status === 'running'); };
  async function mutate(fn) { const q = await loadQueue(); if (!q) return; fn(q); await saveQueue(q); }

  /* ---------- teach a click ---------- */
  let teaching = null;
  function startTeach(recipeKey, idx, step, job, item) {
    if (teaching) return;
    teaching = { recipeKey, idx };
    const handler = async (e) => {
      const el = e.target.closest('button, a, input[type=button], input[type=submit], [role=button], .btn');
      if (!el || el.closest('#gstf-runner')) return;
      document.removeEventListener('click', handler, true);
      const text = labelText(el);
      const exact = '^' + text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '$';
      taught[recipeKey] = { ...(taught[recipeKey] || {}), [idx]: exact };
      await chrome.storage.local.set({ [K.recipes]: taught });
      teaching = null;
      bannerState.you = ''; bannerState.err = '';
      await mutate(q => {
        const j = q.items[q.cur.item].jobs.find(x => x.id === job.id);
        if (j) { j.step = idx + 1; if (step.do === 'download') j.waitingSince = Date.now(); }
        q.status = 'running';
      });
    };
    document.addEventListener('click', handler, true);
    if (step.do === 'download' || step.do === 'generate') send({ type: 'expect-download', info: { client: item.name, ret: job.file.split('_')[0], period: job.period, kind: KIND[job.file], jobId: job.id } });
  }

  /* ---------- login ---------- */
  const isLoginPage = () => /\/services\/login/i.test(location.href) ||
    (!!document.querySelector('input[type=password]') && !!document.querySelector('input#username, input[name=username], input[name=user_name]'));
  const logoutEl = () => Array.from(document.querySelectorAll('a, button')).find(el => /^\s*log\s*out\s*$/i.test(el.textContent || ''));
  const isLoggedIn = () => !!logoutEl();

  async function doLogin(q, it) {
    if (it.loginShownAt && Date.now() - it.loginShownAt < 4000) return;
    const user = document.querySelector('input#username, input[name=username], input[name=user_name], input[autocomplete=username]') ||
      Array.from(document.querySelectorAll('input[type=text]')).find(i => visible(i) && /user/i.test(i.id + i.name + i.placeholder));
    const pass = document.querySelector('input[type=password]');
    if (!user || !pass) return;
    const cred = await send({ type: 'get-login', clientId: it.clientId });
    const setVal = (el, v) => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(el, v);
      el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true })); el.dispatchEvent(new Event('blur', { bubbles: true }));
    };
    if (cred.username && user.value !== cred.username) setVal(user, cred.username);
    if (cred.password && pass.value !== cred.password) setVal(pass, cred.password);
    const cap = document.querySelector('input#captcha, input[name=captcha], input[id*=captcha i], input[name*=captcha i], input[placeholder*=character i]');
    it.loginShownAt = Date.now();
    it.status = 'login';
    await saveQueue(q);
    if (cred.error === 'locked') banner(q, { you: `Passwords are locked. Unlock them in GST Desk, or type the password for ${it.name} yourself, then the CAPTCHA, then LOGIN.`, err: '' });
    else if (!cred.password) banner(q, { you: `No saved password for ${it.name}. Type it, then the CAPTCHA, then click LOGIN.`, err: '' });
    else banner(q, { you: `Type the CAPTCHA for ${it.name} and click LOGIN.`, err: '' });
    if (cap) { cap.scrollIntoView({ block: 'center' }); cap.focus(); cap.style.outline = '3px solid #d97706'; }
  }

  /* ---------- main loop ---------- */
  let busy = false;
  async function tick() {
    if (busy || teaching) return;
    busy = true;
    try { await step(); } catch (e) { await mutate(q => { q.status = 'paused'; }); banner(await loadQueue(), { err: 'Paused: ' + e.message }); }
    busy = false;
  }

  async function step() {
    const q = await loadQueue();
    if (!q || q.status === 'stopped' || q.dismissed) { if (host.isConnected) host.remove(); return; }
    if (q.status === 'done') { banner(q, { you: '', err: '' }); return; }
    if (q.status !== 'running') { banner(q); return; }

    let it = q.items[q.cur.item];
    // Client finished? Log out and move on.
    while (it && !it.jobs.some(j => j.status === 'pending' || j.status === 'running')) {
      const wasActive = it.status !== 'done' && it.status !== 'pending';
      it.status = 'done';
      q.cur.item++;
      await saveQueue(q);
      const out = logoutEl();
      if (wasActive && out && q.cur.item < q.items.length) { banner(q, { msg: 'Logging out for the next client…', you: '' }); out.click(); return; }
      it = q.items[q.cur.item];
    }
    if (!it) { q.status = 'done'; await saveQueue(q); banner(q, { you: '', err: '', msg: '' }); return; }

    if (isLoginPage()) { await doLogin(q, it); return; }
    if (!isLoggedIn()) {
      // Not logged in and not on the login page → go there.
      if (/gst\.gov\.in/.test(location.hostname) && !/\/auth\//.test(location.pathname)) {
        banner(q, { msg: 'Opening login page…', you: '' });
        await sleep(800);
        location.href = LOGIN;
      } else banner(q, { msg: 'Waiting for the portal…' });
      return;
    }
    if (it.status === 'login' || it.status === 'pending') {
      // Make sure we are logged in as the right client.
      const seen = (document.body.innerText.match(/\b\d{2}[A-Z]{5}\d{4}[A-Z][1-9A-Z]Z[0-9A-Z]\b/g) || []);
      if (it.gstin && seen.length && !seen.includes(it.gstin)) {
        q.status = 'paused'; await saveQueue(q);
        banner(q, { err: `The portal shows GSTIN ${seen[0]}, but this client is ${it.gstin}. Log out and log in as ${it.name}, then Resume.`, you: '' });
        return;
      }
      it.status = 'active'; await saveQueue(q);
    }
    bannerState.you = '';

    const job = it.jobs.find(j => j.status === 'pending' || j.status === 'running');
    const recipe = RECIPES[job.file];
    if (job.status === 'pending') { job.status = 'running'; job.step = 0; await saveQueue(q); }
    const idx = job.step || 0;
    if (idx >= recipe.length) {
      // A download was just clicked (e.g. a button you taught) – give Chrome time to report it before giving up
      if (job.waitingSince && Date.now() - job.waitingSince < 60000 && await waitDownloaded(job.id, 30000)) return tick2();
      const q2 = await loadQueue(); const j2 = q2.items[q2.cur.item].jobs.find(x => x.id === job.id);
      if (j2 && j2.status === 'running') { j2.status = 'failed'; j2.note = j2.note || 'finished without a file'; await saveQueue(q2); }
      return tick2();
    }
    const s = recipe[idx];
    banner(q, { msg: s.name || (s.do === 'period' ? `Selecting ${job.period}` : s.do === 'dashboard' ? 'Opening returns dashboard' : s.do), err: '' });

    const advance = async (patch = {}) => { const q2 = await loadQueue(); const j2 = q2.items[q2.cur.item].jobs.find(x => x.id === job.id); Object.assign(j2, { step: idx + 1 }, patch); await saveQueue(q2); };

    if (s.do === 'dashboard') {
      if (!/\/returns\/auth\/dashboard/i.test(location.href)) { await advance(); location.href = DASH; return; }
      await advance(); return tick2();
    }
    if (s.do === 'period') {
      const err = await pickPeriod(job.period);
      if (err) return fail(job, err);
      await advance(); return tick2();
    }
    if (s.do === 'click') {
      const el = await waitFor(() => findTarget(s, job.file, idx), s.optional ? 6000 : 12000);
      if (!el) {
        if (s.optional) { await advance(); return tick2(); }
        return askToTeach(q, it, job, s, idx);
      }
      await advance();
      el.click();
      if (!s.nav) { await sleep(1500); return tick2(); }
      return; // page will change; next load continues
    }
    if (s.do === 'download' || s.do === 'generate') {
      const el = await waitFor(() => findTarget(s, job.file, idx), 12000);
      if (!el) return askToTeach(q, it, job, s, idx);
      await send({ type: 'expect-download', info: { client: it.name, ret: job.file.split('_')[0], period: job.period, kind: KIND[job.file], jobId: job.id } });
      await advance({ waitingSince: Date.now() });
      el.click();
      // Wait for the background to see the file
      const ok = await waitDownloaded(job.id, s.do === 'generate' ? 10000 : 40000);
      if (ok) return tick2();
      if (s.do === 'generate') {
        const link = await waitFor(() => clickables().find(e => s.link.some(t => new RegExp(t, 'i').test(labelText(e)))), 6000);
        if (link) {
          await send({ type: 'expect-download', info: { client: it.name, ret: job.file.split('_')[0], period: job.period, kind: KIND[job.file], jobId: job.id } });
          link.click();
          if (await waitDownloaded(job.id, 40000)) return tick2();
        }
        const q3 = await loadQueue(); const j3 = q3.items[q3.cur.item].jobs.find(x => x.id === job.id);
        j3.status = 'requested'; j3.note = 'Portal is preparing the JSON – queue it again in 20–30 minutes to download';
        await saveQueue(q3); await send({ type: 'clear-expect' });
        return tick2();
      }
      return fail(job, 'Clicked, but no file arrived (nothing filed for this period?)');
    }
  }
  const tick2 = () => { busy = false; setTimeout(tick, 600); };

  async function waitDownloaded(jobId, ms) {
    const end = Date.now() + ms;
    while (Date.now() < end) {
      const q = await loadQueue();
      const j = q && q.items[q.cur.item] && q.items[q.cur.item].jobs.find(x => x.id === jobId);
      if (j && j.status === 'downloaded') return true;
      await sleep(700);
    }
    return false;
  }
  async function fail(job, note) {
    const q = await loadQueue();
    const j = q.items[q.cur.item].jobs.find(x => x.id === job.id);
    j.status = 'failed'; j.note = note;
    await saveQueue(q);
    banner(q, { err: `${FILE_LABEL[job.file]} ${job.period}: ${note}. Moving on.` });
    await sleep(2500);
    bannerState.err = '';
    return tick2();
  }
  async function askToTeach(q, it, job, s, idx) {
    q.status = 'paused';
    await saveQueue(q);
    banner(q, { you: `I can't find “${s.name}”. Click it on the page once – I'll remember it for every client – and the queue continues.`, err: '' });
    startTeach(job.file, idx, s, job, it);
  }

  /* ---------- start ---------- */
  (async function init() {
    taught = (await chrome.storage.local.get(K.recipes))[K.recipes] || {};
    chrome.storage.onChanged.addListener((ch, area) => {
      if (area !== 'local') return;
      if (ch[K.recipes]) taught = ch[K.recipes].newValue || {};
      if (ch[K.queue]) {
        const q = ch[K.queue].newValue;
        if (!busy) { if (q && q.status === 'running' && !teaching) tick(); else banner(q); }
      }
    });
    const q = await loadQueue();
    if (q && q.status !== 'stopped' && !q.dismissed) { banner(q); setTimeout(tick, 1500); }
    let t = null;
    new MutationObserver(() => { clearTimeout(t); t = setTimeout(() => { if (!busy) loadQueue().then(q2 => { if (q2 && q2.status === 'running') tick(); }); }, 1500); })
      .observe(document.documentElement, { childList: true, subtree: true });
  })();

  window.__gstfRunner = { RECIPES, tileFor, pickPeriod, findTarget, tick };
})();
