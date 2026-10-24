/* Registration autopilot on the GST portal.
   Started from GST Desk ("File registration"). It fills Part A, waits for your CAPTCHA/OTP, notes the TRN,
   logs in with the TRN (your CAPTCHA/OTP), opens the saved application and fills every tab, attaching
   documents and clicking "Save & Continue". It stops at Verification: you tick the declaration and
   submit with DSC/EVC yourself. If something is unclear it pauses and tells you why.
   Also: reads the portal's district and jurisdiction lists for GST Desk's dropdowns. */
(function () {
  'use strict';
  if (window.top !== window || window.__gstfRegrun) return;
  window.__gstfRegrun = true;

  const G = window.GSTR, K = G.KEYS;
  const RUN = 'gstf_regrun', TAUGHT = 'gstf_reg_taught';
  const sleep = (ms) => new Promise(r => setTimeout(r, ms));
  const norm = (s) => String(s || '').replace(/\s+/g, ' ').trim();
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const send = (msg) => new Promise(res => { try { chrome.runtime.sendMessage(msg, (r) => res(r || {})); } catch (_) { res({}); } });
  const api = () => window.__gstfApi;
  const waitApi = async () => { for (let i = 0; i < 40 && !api(); i++) await sleep(150); return api(); };

  const TAB_ORDER = ['business', 'promoter', 'signatory', 'representative', 'ppob', 'apob', 'goods', 'state', 'aadhaar', 'verification'];
  const OURS = '#gstf-host, #gstf-runner, #gstf-regrun';
  const vis = (el) => !!el && el.isConnected && !el.closest(OURS) && el.getClientRects().length > 0 && getComputedStyle(el).visibility !== 'hidden';
  const clickables = (root = document) => Array.from(root.querySelectorAll('button, a, input[type=button], input[type=submit], [role=button], .btn'))
    .filter(vis).filter(el => !el.disabled && !el.classList.contains('disabled') && el.getAttribute('aria-disabled') !== 'true');
  const btnText = (el) => norm(el.innerText || el.value || el.getAttribute('aria-label') || el.title || '');
  let taught = {};
  function findBtn(key, rxs, root) {
    const list = clickables(root);
    const pats = (taught[key] ? [new RegExp(taught[key], 'i')] : []).concat(rxs);
    for (const rx of pats) { const b = list.find(el => rx.test(btnText(el))); if (b) return b; }
    return null;
  }
  const loadRun = async () => (await chrome.storage.local.get(RUN))[RUN] || null;
  const saveRun = (r) => chrome.storage.local.set({ [RUN]: r });
  async function mutate(fn) { const r = await loadRun(); if (!r) return null; fn(r); await saveRun(r); return r; }
  async function profileOf(id) { const r = await chrome.storage.local.get(K.profiles); return (r[K.profiles] || []).map(G.normalizeProfile).find(p => p.id === id) || null; }
  async function patchProfile(id, fn) {
    const r = await chrome.storage.local.get(K.profiles);
    const list = r[K.profiles] || [];
    const p = list.find(x => x.id === id);
    if (p) { fn(p); p.updated = new Date().toISOString(); await chrome.storage.local.set({ [K.profiles]: list }); }
  }
  const labelOf = (el) => api() ? api().labelOf(el) : '';
  const selectBy = (rx) => Array.from(document.querySelectorAll('select')).filter(vis).find(s => rx.test(labelOf(s) + ' ' + (s.name || '') + ' ' + (s.id || '')));
  const optTexts = (sel) => sel ? Array.from(sel.options).map(o => norm(o.text)).filter(t => t && !/^(-+\s*)?(select|choose|please select)\b/i.test(t)) : [];

  /* ---------------- banner ---------------- */
  const host = document.createElement('div');
  host.id = 'gstf-regrun';
  host.style.cssText = 'position:fixed;z-index:2147483647;left:16px;bottom:16px;';
  const sh = host.attachShadow({ mode: 'open' });
  const BANNER_CSS = `*{box-sizing:border-box;font-family:system-ui,-apple-system,"Segoe UI",Roboto,sans-serif}
    .b{width:min(460px,calc(100vw - 32px));background:#1d2433;color:#fff;border-radius:12px;box-shadow:0 10px 30px rgba(0,0,0,.3);padding:11px 13px;font-size:13px;line-height:1.45}
    .t b{font-size:13.5px}.s{color:#c8d0e0;font-size:12.5px;margin-top:2px}
    .steps{display:flex;gap:3px;margin-top:8px}.steps i{flex:1;height:4px;border-radius:3px;background:#2f3849}.steps i.d{background:#5cc27a}.steps i.c{background:#f2b544}
    .you{background:#fff4e5;color:#7a4100;border-radius:8px;padding:8px 10px;margin-top:9px;font-weight:600}
    .err{background:#fdecea;color:#b42318;border-radius:8px;padding:8px 10px;margin-top:9px}
    .ok{background:#e6f4ea;color:#1a7f37;border-radius:8px;padding:8px 10px;margin-top:9px;font-weight:600}
    .row{display:flex;gap:6px;margin-top:9px;flex-wrap:wrap}
    button{font:inherit;font-size:12px;border:1px solid #4a5263;background:#2a3245;color:#fff;border-radius:7px;padding:5px 10px;cursor:pointer}
    button.p{background:#3b7be0;border-color:#3b7be0}`;
  let view = { msg: '', you: '', err: '', ok: '' };
  function banner(run, patch = {}) {
    view = { ...view, ...patch };
    if (!run || run.status === 'stopped') { host.remove(); return; }
    if (!host.isConnected) document.documentElement.appendChild(host);
    const steps = ['partA', ...TAB_ORDER.filter(t => t !== 'representative' && t !== 'apob')];
    const cur = run.stage === 'tabs' ? steps.indexOf(run.lastTab) : run.stage === 'review' ? steps.length : 0;
    sh.innerHTML = `<style>${BANNER_CSS}</style><div class="b" role="status" aria-live="polite">
      <div class="t"><b>GST Desk · Filing registration${run.name ? ' – ' + esc(run.name) : ''}</b>
        <div class="s">${run.status === 'paused' ? 'Paused · ' : run.status === 'review' ? 'Ready for your review · ' : ''}${esc(view.msg || '')}${run.trn ? ` · TRN ${esc(run.trn)}` : ''}</div></div>
      <div class="steps">${steps.map((_, i) => `<i class="${i < cur ? 'd' : i === cur ? 'c' : ''}"></i>`).join('')}</div>
      ${view.you ? `<div class="you">${esc(view.you)}</div>` : ''}
      ${view.err ? `<div class="err">${esc(view.err)}</div>` : ''}
      ${view.ok ? `<div class="ok">${esc(view.ok)}</div>` : ''}
      <div class="row">
        ${run.status === 'running' ? '<button id="pause">Pause</button>' : ''}
        ${run.status === 'paused' ? '<button class="p" id="resume">Resume</button>' : ''}
        ${run.stage === 'tabs' || run.stage === 'review' ? '<button id="again">Fill this tab again</button>' : ''}
        <button id="stop">${run.status === 'review' ? 'Close' : 'Stop'}</button>
        <button id="mgr">Open GST Desk</button>
      </div></div>`;
    const on = (id, fn) => { const e = sh.getElementById(id); if (e) e.onclick = fn; };
    on('pause', () => mutate(r => { r.status = 'paused'; }).then(r => banner(r, { msg: 'Paused by you' })));
    on('resume', () => { handled = ''; view.err = ''; view.you = ''; mutate(r => { r.status = 'running'; r.note = ''; }).then(() => tick()); });
    on('again', () => { handled = ''; view.err = ''; view.ok = ''; mutate(r => { r.status = 'running'; r.forceFill = true; if (r.stage === 'review') r.stage = 'tabs'; }).then(() => tick()); });
    on('stop', () => mutate(r => { r.status = 'stopped'; }).then(() => { host.remove(); window.__gstfAutopilotOn = false; if (api()) api().hidePanel(false); }));
    on('mgr', () => send({ type: 'open-manager', hash: '#clients' }));
  }
  async function pause(run, why, you) {
    run = await mutate(r => { r.status = 'paused'; r.note = why || you || ''; }) || run;
    banner(run, { err: why || '', you: you || '', ok: '' });
  }

  /* ---------------- teach a button ---------------- */
  let teaching = false;
  function teach(key, what, run) {
    if (teaching) return;
    teaching = true;
    pause(run, '', `I can't find “${what}” on this page. Click it once yourself – I'll remember it – and filing continues.`);
    const handler = async (e) => {
      const el = e.target.closest('button, a, input[type=button], input[type=submit], [role=button], .btn');
      if (!el || el.closest(OURS)) return;
      document.removeEventListener('click', handler, true);
      teaching = false;
      const t = btnText(el);
      if (t) { taught[key] = '^' + t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '$'; await chrome.storage.local.set({ [TAUGHT]: taught }); }
      handled = '';
      await mutate(r => { r.status = 'running'; if (key === 'addNew') r.person = (r.person || 0) + 1; });
      view.you = '';
      setTimeout(tick, 1500);
    };
    document.addEventListener('click', handler, true);
  }

  /* ---------------- page kinds ---------------- */
  function trnOnPage() {
    const t = document.body ? document.body.innerText : '';
    const m = /\b(\d{10,13}TRN)\b/.exec(t) || /\bTRN\b[^A-Z0-9]{0,30}([0-9A-Z]{15})\b/.exec(t);
    return m ? m[1] : '';
  }
  const radioByLabel = (rx) => Array.from(document.querySelectorAll('input[type=radio]')).find(r => {
    const l = (r.id && document.querySelector(`label[for="${CSS.escape(r.id)}"]`)) || r.closest('label');
    return rx.test(norm((l && l.textContent) || r.value || ''));
  });
  const trnRadio = () => radioByLabel(/temporary reference number|\(trn\)|^trn$/i);
  const newRegRadio = () => radioByLabel(/new registration/i);
  const trnInput = () => Array.from(document.querySelectorAll('input[type=text], input:not([type])')).filter(vis)
    .find(i => /temporary reference number|\btrn\b/i.test(labelOf(i) + ' ' + (i.name || '') + ' ' + (i.id || '') + ' ' + (i.placeholder || '')));
  const captchaInput = () => Array.from(document.querySelectorAll('input')).filter(vis)
    .find(i => /captcha|characters|image/i.test(labelOf(i) + ' ' + (i.name || '') + ' ' + (i.id || '') + ' ' + (i.placeholder || '')));
  const isSavedApps = () => /my saved applications|saved applications/i.test(document.body ? document.body.innerText : '');
  function pageKind() {
    const ctx = api().detectCtx();
    if (TAB_ORDER.includes(ctx)) return ctx;
    if (isSavedApps()) return 'saved-apps';
    if (ctx === 'otp') return 'otp';
    if (trnOnPage() && !trnInput() && findBtn('proceed', [/^proceed$/i, /proceed/i])) return 'trn-shown';
    if (ctx === 'partA' || trnRadio() || newRegRadio()) return 'start';
    return 'unknown';
  }

  /* ---------------- steps ---------------- */
  let handled = '';   // what this page instance already did
  let busy = false;

  async function stepStart(run, p) {
    const key = 'start|' + (run.trn ? 'trn' : 'new');
    if (handled === key) return;
    handled = key;
    const A = api();
    if (run.trn) {
      const r = trnRadio();
      if (r && !r.checked) { r.click(); await sleep(800); }
      const ti = trnInput();
      if (!ti) { handled = ''; banner(run, { msg: 'Choose “Temporary Reference Number (TRN)” on this page', you: '' }); return; }
      A.setText(ti, run.trn);
      await mutate(r2 => { r2.stage = 'trn-login'; });
      const cap = captchaInput();
      if (cap) { cap.scrollIntoView({ block: 'center' }); cap.focus(); }
      banner(run, { msg: 'Logging in with the TRN', you: 'Type the CAPTCHA and click PROCEED. Then enter the OTP sent to the mobile / email.', err: '' });
      return;
    }
    const nr = newRegRadio();
    if (nr && !nr.checked) { nr.click(); await sleep(700); }
    banner(run, { msg: 'Filling Part A', you: '', err: '' });
    const rep = await A.fill({ clientId: p.id, ctx: 'partA', quiet: true });
    learnDistrictsHere();
    await mutate(r2 => { r2.stage = 'partA'; });
    const cap = captchaInput();
    if (cap) { cap.scrollIntoView({ block: 'center' }); cap.focus(); }
    const warn = rep && rep.check && rep.check.length ? 'Check: ' + rep.check.join('; ') : '';
    banner(await loadRun(), { msg: 'Part A filled', you: 'Check the details, type the CAPTCHA and click PROCEED. Then enter the mobile and email OTPs.', err: warn });
  }

  async function stepTrnShown(run) {
    if (handled === 'trn') return;
    handled = 'trn';
    const trn = trnOnPage();
    await mutate(r => { r.trn = trn; r.stage = 'trn'; });
    await patchProfile(run.clientId, (p) => { p.trn = trn; p.trnDate = new Date().toISOString(); });
    banner(await loadRun(), { msg: `TRN ${trn} saved to the client`, you: '', ok: `TRN ${trn} generated and saved. Continuing to Part B…` });
    await sleep(1500);
    const b = findBtn('proceed', [/^proceed$/i, /proceed/i]);
    if (b) b.click(); else banner(await loadRun(), { you: 'Click PROCEED on the portal.' });
  }

  async function stepSavedApps(run) {
    if (handled === 'apps') return;
    handled = 'apps';
    banner(run, { msg: 'Opening the saved application', you: '', ok: '' });
    await sleep(600);
    const rows = Array.from(document.querySelectorAll('tr')).filter(vis);
    const row = rows.find(tr => run.trn && tr.innerText.includes(run.trn)) || rows.find(tr => tr.querySelector('td'));
    const scope = row || document;
    const cand = Array.from(scope.querySelectorAll('a, button, [role=button], i, span')).filter(vis).find(el =>
      /edit/i.test(el.getAttribute('title') || '') || /edit/i.test(el.getAttribute('aria-label') || '') ||
      /\b(fa-pencil|fa-edit|glyphicon-pencil|edit)\b/i.test(el.className || '') || /^edit$/i.test(norm(el.textContent)));
    const tb = taught.editApp && findBtn('editApp', [], scope);
    const target = tb || cand;
    if (!target) { handled = ''; return teach('editApp', 'the Edit (pencil) icon of this application', run); }
    (target.closest('a, button, [role=button]') || target).click();
    await mutate(r => { r.stage = 'tabs'; });
  }

  const ERR_SEL = '.err, .error, .text-danger, .alert-danger, .has-error .help-block, .invalid-feedback, [role=alert], .errorMsg, .err-msg';
  const visibleErrors = () => Array.from(document.querySelectorAll(ERR_SEL)).filter(vis)
    .map(e => norm(e.innerText)).filter(t => t && t.length < 300).filter((t, i, a) => a.indexOf(t) === i).slice(0, 6);

  async function clickModalOk() {
    const modals = Array.from(document.querySelectorAll('[role=dialog], .modal, .modal-dialog, .swal2-popup')).filter(vis);
    for (const m of modals) { const b = findBtn('modalOk', [/^(yes|ok|proceed|confirm|continue)$/i], m); if (b) { b.click(); return true; } }
    return false;
  }

  async function waitLeave(ctx, ms) {
    const A = api(), end = Date.now() + ms;
    while (Date.now() < end) {
      await sleep(500);
      if (A.detectCtx() !== ctx) return 'moved';
      if (await clickModalOk()) continue;
      if (visibleErrors().length) { await sleep(400); if (A.detectCtx() === ctx) return 'error'; }
    }
    return A.detectCtx() !== ctx ? 'moved' : 'stuck';
  }

  async function pickHsn(p) {
    const A = api();
    const codes = [...p.goods.hsn.filter(Boolean).map(c => ({ c, k: 'goods' })), ...p.goods.sac.filter(Boolean).map(c => ({ c, k: 'services' }))];
    const failed = [];
    const inTable = (c) => Array.from(document.querySelectorAll('td, li.added, .chip, .tag')).filter(vis).some(td => norm(td.textContent).startsWith(c));
    for (const { c, k } of codes) {
      if (inTable(c)) continue;
      if (k === 'services') { const t = findBtn('servicesTab', [/^services$/i]); if (t && !t.classList.contains('active')) { t.click(); await sleep(700); } }
      else { const t = findBtn('goodsTab', [/^goods$/i]); if (t && !t.classList.contains('active')) { t.click(); await sleep(700); } }
      const inp = Array.from(document.querySelectorAll('input[type=text], input:not([type])')).filter(vis)
        .find(i => /hsn|sac|service|goods|search/i.test(labelOf(i) + ' ' + (i.placeholder || '') + ' ' + (i.name || '') + ' ' + (i.id || '')) && !/captcha/i.test(i.id || ''));
      if (!inp) { failed.push(c); continue; }
      inp.focus();
      A.setText(inp, c);
      inp.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: c.slice(-1) }));
      inp.dispatchEvent(new KeyboardEvent('keyup', { bubbles: true, key: c.slice(-1) }));
      let pick = null;
      for (let i = 0; i < 12 && !pick; i++) {
        await sleep(400);
        pick = Array.from(document.querySelectorAll('li, [role=option], .dropdown-item, .typeahead a, ul.dropdown-menu a, .ui-menu-item, .autocomplete-item')).filter(vis)
          .find(el => !el.closest('nav, .nav, .tabs') && new RegExp('^\\s*' + c + '\\b').test(norm(el.textContent)));
      }
      if (!pick) { failed.push(c); continue; }
      (pick.querySelector('a') || pick).click();
      await sleep(600);
      const add = findBtn('hsnAdd', [/^add$/i, /^\+\s*add$/i]);
      if (add && !inTable(c)) { add.click(); await sleep(600); }
      if (!inTable(c)) { /* some portals show the pick in the field only */ }
    }
    return failed;
  }

  async function stepTab(run, p, ctx) {
    const person = ctx === 'promoter' ? (run.person || 0) : null;
    const key = `tab|${ctx}|${person}`;
    if (handled === key && !run.forceFill) return;
    handled = key;
    const A = api();
    if (run.forceFill) await mutate(r => { r.forceFill = false; });
    await mutate(r => { r.stage = 'tabs'; r.lastTab = ctx; });
    run = await loadRun();
    const C = G.CONSTITUTIONS[p.constitution];
    const label = ctx === 'promoter' ? `${C.person} ${person + 1} of ${p.persons.length}` : (G.SECTIONS[ctx] || ctx);
    banner(run, { msg: `Filling ${label}`, you: '', err: '', ok: '' });

    if (ctx === 'ppob') learnJurisHere(p);
    const rep = await A.fill({ clientId: p.id, ctx, personIdx: ctx === 'promoter' ? person : (ctx === 'signatory' ? Math.max(0, p.persons.findIndex(x => x.isSignatory)) : undefined), quiet: true });
    if (!rep || rep.error) return pause(run, (rep && rep.error) || 'Could not fill this tab');
    if (ctx === 'ppob') learnJurisHere(p);
    if (ctx === 'goods') {
      const failed = await pickHsn(p);
      if (failed.length) return pause(run, '', `Add these codes yourself from the portal's suggestions: ${failed.join(', ')}. Then click Resume.`);
    }
    if (ctx === 'verification') {
      await mutate(r => { r.status = 'review'; r.stage = 'review'; });
      return banner(await loadRun(), { msg: 'All tabs filled', ok: 'All tabs are filled. Check each tab, tick the declaration, select the authorised signatory and submit with DSC or EVC yourself.', you: '', err: '' });
    }
    if (rep.missingUploads && rep.missingUploads.length) {
      return pause(run, '', `Upload yourself: ${rep.missingUploads.join(', ')} (no saved document in GST Desk). Then click Resume.`);
    }
    // More people to add on the Promoter / Partners tab
    if (ctx === 'promoter' && person < p.persons.length - 1) {
      const add = findBtn('addNew', [/save\s*(&|and)\s*add\s*new/i, /^add\s*new$/i, /add\s*new/i, /add\s*another/i]);
      if (!add) { handled = ''; return teach('addNew', `the button that saves ${C.person.toLowerCase()} ${person + 1} and opens a blank form for the next one`, run); }
      await mutate(r => { r.person = person + 1; });
      add.click();
      handled = '';
      await sleep(1800);
      return;
    }
    const save = findBtn('save', [/^save\s*(&|and)\s*continue$/i, /save\s*(&|and)\s*continue/i, /^continue$/i]);
    if (!save) { handled = ''; return teach('save', 'SAVE & CONTINUE', run); }
    banner(run, { msg: `Saving ${label}` });
    save.click();
    const res = await waitLeave(ctx, 12000);
    if (res === 'moved') { await mutate(r => { r.done = { ...(r.done || {}), [ctx]: true }; }); handled = ''; return; }
    const errs = visibleErrors();
    if (res === 'error' || errs.length) return pause(run, 'The portal says: ' + errs.join(' · '), 'Correct this on the portal (or in GST Desk and click “Fill this tab again”), then click Resume.');
    return pause(run, '', 'The portal stayed on this tab after Save & Continue. Check the page, then click Resume.');
  }

  async function tick() {
    if (busy || teaching) return;
    const A = await waitApi();
    if (!A) return;
    const run = await loadRun();
    window.__gstfAutopilotOn = !!(run && run.status === 'running');
    A.hidePanel(!!(run && ['running', 'paused', 'review'].includes(run.status)));
    if (!run || run.status === 'stopped') { host.remove(); return; }
    if (run.status !== 'running') { banner(run); return; }
    const p = await profileOf(run.clientId);
    if (!p) return pause(run, 'This client no longer exists in GST Desk.');
    busy = true;
    try {
      const kind = pageKind();
      if (kind === 'start') await stepStart(run, p);
      else if (kind === 'otp') banner(run, { msg: 'Waiting for OTP', you: 'Enter the OTP(s) sent to the mobile and email, then click PROCEED.', err: '' });
      else if (kind === 'trn-shown') await stepTrnShown(run);
      else if (kind === 'saved-apps') await stepSavedApps(run);
      else if (TAB_ORDER.includes(kind)) await stepTab(run, p, kind);
      else banner(run, { msg: 'Waiting for the portal…', you: run.stage === 'trn' ? 'If the portal shows a login page, choose TRN and continue.' : '' });
    } catch (e) {
      await pause(run, 'Stopped: ' + e.message);
    }
    busy = false;
  }

  /* ---------------- lists from the portal ---------------- */
  function learnDistrictsHere() {
    const st = selectBy(/state|union territory/i), di = selectBy(/district/i);
    if (!st || !di || st.selectedIndex <= 0) return;
    const opts = optTexts(di);
    if (opts.length > 1) GSTLists.saveDistricts({ [norm(st.options[st.selectedIndex].text)]: opts });
  }
  const jSel = () => ({
    ward: selectBy(/sector|circle|ward|charge|unit/i),
    comm: selectBy(/commissionerate/i),
    div: selectBy(/division/i),
    range: selectBy(/\brange\b/i),
    state: selectBy(/^\s*state\b(?!.*jurisdiction)/i)
  });
  function stateFor(p, s) { return (s.state && s.state.selectedIndex > 0 && norm(s.state.options[s.state.selectedIndex].text)) || p.ppob.address.state || p.partA.state; }
  function learnJurisHere(p) {
    const s = jSel();
    const state = stateFor(p, s);
    if (!state) return;
    const patch = {};
    if (s.ward) patch.ward = optTexts(s.ward);
    if (s.comm) patch.comm = optTexts(s.comm);
    const cv = s.comm && s.comm.selectedIndex > 0 ? norm(s.comm.options[s.comm.selectedIndex].text) : '';
    if (cv && s.div) patch.divisions = { [cv]: optTexts(s.div) };
    const dv = s.div && s.div.selectedIndex > 0 ? norm(s.div.options[s.div.selectedIndex].text) : '';
    if (cv && dv && s.range) patch.ranges = { [cv]: { [dv]: optTexts(s.range) } };
    GSTLists.saveJuris(state, patch);
  }
  async function waitOptions(sel, prevSig, ms = 6000) {
    const end = Date.now() + ms;
    while (Date.now() < end) {
      await sleep(250);
      const o = optTexts(sel);
      if (o.length && o.join('|') !== prevSig) return o;
    }
    return optTexts(sel);
  }
  // Walk every commissionerate → division → range on the Principal Place of Business tab
  async function crawlJuris(onProgress) {
    const A = await waitApi();
    const s = jSel();
    if (!s.comm) throw new Error('Open the Principal Place of Business tab first');
    const run = await loadRun();
    const p = run ? await profileOf(run.clientId) : null;
    const state = stateFor(p || G.newProfile(), s);
    if (!state) throw new Error('Choose the State in the address first');
    const keep = { comm: s.comm.value, div: s.div && s.div.value, range: s.range && s.range.value };
    const patch = { ward: s.ward ? optTexts(s.ward) : [], comm: optTexts(s.comm), divisions: {}, ranges: {} };
    const comms = optTexts(s.comm);
    let n = 0;
    for (const c of comms) {
      onProgress && onProgress(`Reading ${c} (${++n}/${comms.length})…`);
      const prevD = s.div ? optTexts(s.div).join('|') : '';
      A.setSelect(s.comm, c);
      if (!s.div) continue;
      const divs = await waitOptions(s.div, prevD);
      patch.divisions[c] = divs;
      patch.ranges[c] = {};
      for (const d of divs) {
        const prevR = s.range ? optTexts(s.range).join('|') : '';
        A.setSelect(s.div, d);
        if (s.range) patch.ranges[c][d] = await waitOptions(s.range, prevR, 4000);
      }
    }
    await GSTLists.saveJuris(state, patch);
    // put the user's selection back
    if (keep.comm) { s.comm.value = keep.comm; A.fire(s.comm, 'change'); await sleep(900); }
    if (keep.div && s.div) { s.div.value = keep.div; A.fire(s.div, 'change'); await sleep(900); }
    if (keep.range && s.range) { s.range.value = keep.range; A.fire(s.range, 'change'); }
    return { state, comms: comms.length };
  }
  window.__gstfLearnJuris = crawlJuris;

  async function harvestDistricts() {
    const A = await waitApi();
    const note = document.createElement('div');
    note.style.cssText = 'position:fixed;z-index:2147483647;top:12px;left:50%;transform:translateX(-50%);background:#1d2433;color:#fff;padding:10px 14px;border-radius:10px;font:13px system-ui';
    note.textContent = 'GST Desk is reading the district lists from this page… this tab closes by itself.';
    document.documentElement.appendChild(note);
    try {
      let st = null;
      for (let i = 0; i < 60 && !(st = selectBy(/state|union territory/i)); i++) {
        const nr = newRegRadio(); if (nr && !nr.checked) nr.click();
        await sleep(500);
      }
      if (!st) throw new Error('State list not found on the portal page');
      const who = selectBy(/i am a|applicant type|type of taxpayer/i);
      if (who) { A.setSelect(who, 'Taxpayer'); await sleep(600); }
      const map = {};
      const states = optTexts(st);
      let i = 0;
      for (const name of states) {
        note.textContent = `GST Desk is reading district lists from the portal… ${++i}/${states.length}`;
        const di = selectBy(/district/i);
        const prev = di ? optTexts(di).join('|') : '';
        A.setSelect(st, name);
        const d2 = selectBy(/district/i);
        if (!d2) continue;
        const list = await waitOptions(d2, prev, 7000);
        if (list.length && list.join('|') !== prev) map[name] = list;
      }
      const n = await GSTLists.saveDistricts(map);
      await send({ type: 'harvest-done', ok: true, count: n });
    } catch (e) {
      note.textContent = 'GST Desk could not read the lists: ' + e.message;
      await send({ type: 'harvest-done', ok: false, error: e.message });
    }
  }

  /* ---------------- start ---------------- */
  (async function init() {
    taught = (await chrome.storage.local.get(TAUGHT))[TAUGHT] || {};
    let h = null;
    for (let i = 0; i < 6; i++) { h = await send({ type: 'harvest-check' }); if (h && h.what) break; if (i === 0 && !(await chrome.storage.local.get('gstf_harvest')).gstf_harvest) break; await sleep(500); }
    if (h && h.what === 'districts') { harvestDistricts(); return; }
    chrome.storage.onChanged.addListener((ch, area) => {
      if (area !== 'local') return;
      if (ch[TAUGHT]) taught = ch[TAUGHT].newValue || {};
    });
    const run = await loadRun();
    if (run && run.status !== 'stopped') { banner(run); setTimeout(tick, 1200); }
    setInterval(() => { loadRun().then(r => { if (r && r.status === 'running' && !busy && !teaching) tick(); }); }, 2000);
    // Passive learning while you work on the portal yourself
    setInterval(async () => {
      if (!api()) return;
      const ctx = api().detectCtx();
      if (ctx === 'partA') learnDistrictsHere();
      if (ctx === 'ppob') { const r = await loadRun(); const p = r ? await profileOf(r.clientId) : null; learnJurisHere(p || G.newProfile()); }
    }, 5000);
  })();
})();
