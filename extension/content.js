/* GST portal panel: recognises the current registration tab, fills it from the chosen client,
   and stops for you at every CAPTCHA, OTP, upload and Save/Submit button. */
(function () {
  'use strict';
  if (window.top !== window) return;
  if (window.__gstfLoaded) return;
  window.__gstfLoaded = true;

  const G = window.GSTR;
  const K = G.KEYS;
  const sleep = (ms) => new Promise(r => setTimeout(r, ms));
  const norm = (s) => String(s || '').toLowerCase().replace(/[*:]/g, ' ').replace(/\s+/g, ' ').trim();
  const squash = (s) => norm(s).replace(/[^a-z0-9]/g, '');
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  let profiles = [];
  let mappings = {};
  let settings = {};
  const ui = { ctxOverride: '', personIdx: null, mode: 'main', teachEl: null, lastResult: null };
  let filling = false;

  /* ---------------- storage ---------------- */
  async function load() {
    const r = await chrome.storage.local.get([K.profiles, K.mappings, K.settings]);
    profiles = (r[K.profiles] || []).map(G.normalizeProfile);
    mappings = r[K.mappings] || {};
    settings = r[K.settings] || {};
  }
  const saveSettings = (patch) => { settings = { ...settings, ...patch }; return chrome.storage.local.set({ [K.settings]: settings }); };
  chrome.storage.onChanged.addListener((ch, area) => {
    if (area !== 'local') return;
    if (ch[K.profiles]) profiles = (ch[K.profiles].newValue || []).map(G.normalizeProfile);
    if (ch[K.mappings]) mappings = ch[K.mappings].newValue || {};
    if (ch[K.profiles] || ch[K.mappings]) render();
  });

  const profile = () => profiles.find(p => p.id === settings.panelProfile) || null;

  /* ---------------- reading the page ---------------- */
  const visible = (el) => {
    if (!el || !el.isConnected) return false;
    if (el.closest('#gstf-host')) return false;
    const st = getComputedStyle(el);
    if (st.display === 'none' || st.visibility === 'hidden') return false;
    // Styled toggles/radios often hide the real input; accept them if their label is visible.
    if ((el.type === 'checkbox' || el.type === 'radio') && (st.opacity === '0' || el.offsetWidth === 0)) {
      const l = optionLabelEl(el);
      return !!(l && l.getClientRects().length);
    }
    return el.getClientRects().length > 0;
  };

  const textOf = (node) => {
    if (!node) return '';
    const c = node.cloneNode(true);
    c.querySelectorAll('select, option, input, textarea, button, script, style, .help-block, .err, .error').forEach(n => n.remove());
    return c.textContent.replace(/\s+/g, ' ').trim();
  };

  const controlCount = (root) => root.querySelectorAll('input:not([type=hidden]), select, textarea').length;

  function optionLabelEl(el) {
    if (el.id) {
      const l = document.querySelector(`label[for="${CSS.escape(el.id)}"]`);
      if (l) return l;
    }
    return el.closest('label');
  }

  function labelOf(el) {
    const parts = [];
    const al = el.getAttribute('aria-label');
    if (al) parts.push(al);
    const lb = el.getAttribute('aria-labelledby');
    if (lb) lb.split(/\s+/).forEach(id => { const n = document.getElementById(id); if (n) parts.push(textOf(n)); });
    if (el.type !== 'radio') {
      if (el.id) document.querySelectorAll(`label[for="${CSS.escape(el.id)}"]`).forEach(l => parts.push(textOf(l)));
      const wrap = el.closest('label');
      if (wrap) parts.push(textOf(wrap));
    }
    const weak = (t) => !t.trim() || /^(yes|no|y|n|on|off|yes ?\/ ?no|no ?\/ ?yes|select)$/i.test(t.trim());
    if (weak(parts.join(' '))) {
      // Look upward for the nearest label that belongs to this control alone.
      let a = el.parentElement;
      for (let d = 0; a && d < 5; d++, a = a.parentElement) {
        const n = controlCount(a);
        if (n > 3) break;
        const cand = a.querySelector('label, legend, .control-label, .reg, .lbl, .m-cir');
        if (cand && !cand.contains(el) && (n === 1 || cand.compareDocumentPosition(el) & Node.DOCUMENT_POSITION_FOLLOWING)) {
          const t = textOf(cand);
          if (t && !weak(t)) { parts.unshift(t); break; }
        }
        // Text node immediately before the control
        const prev = el.previousElementSibling;
        if (d === 0 && prev && /^(span|b|strong|div|p)$/i.test(prev.tagName) && textOf(prev).length < 80 && !weak(textOf(prev))) { parts.unshift(textOf(prev)); break; }
      }
    }
    if (!parts.join('').trim()) {
      if (el.placeholder) parts.push(el.placeholder);
      if (el.title) parts.push(el.title);
    }
    return parts.join(' ').replace(/\s+/g, ' ').trim();
  }

  const attrText = (el) => ['name', 'id', 'ng-model', 'data-ng-model', 'formcontrolname', 'placeholder']
    .map(a => el.getAttribute(a) || '').join(' ')
    .replace(/([a-z])([A-Z])/g, '$1 $2').replace(/[._\-[\]()$]/g, ' ');

  const SENSITIVE = /captcha|\botp\b|one time password|characters (you|shown|in the image)|type the (characters|text)|security code|enter the code|image below|\bdsc\b|\bevc\b/;

  function sensitiveReason(el, lab, attrs) {
    if (el.type === 'password') return 'Password';
    if (el.type === 'file') return 'Upload';
    const t = norm(lab + ' ' + attrs);
    if (/captcha|characters|image below|type the/.test(t)) return 'CAPTCHA';
    if (SENSITIVE.test(t)) return /dsc|evc/.test(t) ? 'Signing' : 'OTP';
    const box = el.closest('div, td, fieldset');
    if (box && box.querySelector('img[src*="captcha" i], img[alt*="captcha" i], canvas[id*="captcha" i]')) return 'CAPTCHA';
    return '';
  }

  function detectCtx() {
    const RULES = [
      ['verification', /^verification$|\bverification\b/],
      ['aadhaar', /aadhaar authentication/],
      ['state', /state specific/],
      ['bank', /bank account/],
      ['goods', /goods (and|&) services/],
      ['apob', /additional place/],
      ['ppob', /principal place/],
      ['representative', /authori[sz]ed representative/],
      ['signatory', /authori[sz]ed signator/],
      ['promoter', /promoter|partners?\b|director|proprietor|karta/],
      ['business', /business details/]
    ];
    const pick = (texts) => {
      for (const t of texts) for (const [k, rx] of RULES) if (rx.test(t)) return k;
      return '';
    };
    const active = Array.from(document.querySelectorAll(
      'li.active, li.active > a, .nav .active, a.active, [aria-selected="true"], .tabpane .active, .tab-pane.active h4, .tabs .active, .reg-tabs .active'))
      .filter(e => !e.closest('#gstf-host') && e.getClientRects().length).map(e => norm(e.textContent)).filter(t => t && t.length < 80);
    let k = pick(active);
    if (k) return k;
    const heads = Array.from(document.querySelectorAll('h1, h2, h3, h4, legend, .panel-title, .page-title, .card-title'))
      .filter(e => e.getClientRects().length).map(e => norm(e.textContent)).filter(t => t && t.length < 80);
    const fields = Array.from(document.querySelectorAll('input:not([type=hidden]), select')).filter(visible);
    const labs = fields.map(f => norm(labelOf(f))).join(' | ');
    if (/legal name/.test(labs) && /permanent account number|\bpan\b/.test(labs) && /mobile/.test(labs)) return 'partA';
    if (/\botp\b|one time password/.test(labs) && fields.length <= 6) return 'otp';
    k = pick(heads);
    return k || 'unknown';
  }

  const currentCtx = () => ui.ctxOverride || detectCtx();

  function controls() {
    return Array.from(document.querySelectorAll('input, select, textarea'))
      .filter(el => !/^(hidden|submit|button|reset|image|search)$/i.test(el.type) &&
        (visible(el) || (el.type === 'file' && !el.closest('#gstf-host') && el.parentElement && el.parentElement.getClientRects().length > 0)));
  }

  function sigsOf(el, lab) {
    const s = [];
    if (el.id) s.push('id:' + el.id);
    if (el.name) s.push('name:' + el.name);
    const ng = el.getAttribute('ng-model') || el.getAttribute('data-ng-model') || el.getAttribute('formcontrolname');
    if (ng) s.push('ng:' + ng);
    const l = norm(lab);
    if (l) s.push('lbl:' + l);
    return s;
  }

  function typeFits(el, spec) {
    const isBox = el.type === 'checkbox', isRadio = el.type === 'radio', isSel = el.tagName === 'SELECT';
    if (isRadio) return spec.type === 'radio' || spec.type === 'yesno';
    if (isBox) return spec.type === 'check' || spec.type === 'yesno';
    if (isSel) return spec.type !== 'check' && spec.type !== 'radio' && spec.type !== 'multicheck';
    return !['check', 'yesno', 'radio', 'multicheck'].includes(spec.type) || (spec.type === 'yesno');
  }

  function specFor(el, ctx, lab, attrs) {
    const m = mappings[ctx] || {};
    for (const s of sigsOf(el, lab)) {
      if (m[s]) {
        const known = G.FIELDS.find(f => f.key === m[s]);
        return known ? { ...known, taught: true } : { key: m[s], type: el.tagName === 'SELECT' ? 'select' : 'text', label: m[s], taught: true };
      }
    }
    const specs = G.FIELDS.filter(f => f.ctx.includes(ctx) && f.type !== 'multicheck');
    for (const text of [norm(lab), norm(attrs)]) {
      if (!text) continue;
      for (const f of specs) {
        if (f.pat.every(r => r.test(text)) && !f.not.some(r => r.test(text)) && typeFits(el, f)) return f;
      }
    }
    return null;
  }

  /* ---------------- writing to the page ---------------- */
  const fire = (el, ...types) => types.forEach(t => el.dispatchEvent(new Event(t, { bubbles: true })));

  function setText(el, v) {
    const ro = el.readOnly;
    if (ro) el.removeAttribute('readonly');
    const proto = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, v);
    fire(el, 'input', 'change');
    el.dispatchEvent(new KeyboardEvent('keyup', { bubbles: true, key: 'End' }));
    fire(el, 'blur');
    if (ro) el.setAttribute('readonly', 'readonly');
    return el.value === String(v) || squash(el.value) === squash(v) ? 'ok' : 'check';
  }

  function findOption(el, v) {
    const want = squash(v);
    if (!want) return null;
    const opts = Array.from(el.options).filter(o => !o.disabled && squash(o.text) && !/^select/.test(norm(o.text)));
    return opts.find(o => squash(o.text) === want) ||
      opts.find(o => squash(o.value) === want) ||
      opts.find(o => squash(o.text).startsWith(want)) ||
      opts.find(o => want.startsWith(squash(o.text)) && squash(o.text).length >= 4) ||
      opts.find(o => squash(o.text).includes(want) && want.length >= 3) ||
      opts.find(o => want.includes(squash(o.text)) && squash(o.text).length >= 5) || null;
  }

  function setSelect(el, v) {
    const opt = findOption(el, v);
    if (!opt) return 'noopt';
    if (el.value === opt.value && opt.selected) return 'ok';
    el.value = opt.value;
    opt.selected = true;
    fire(el, 'input', 'change', 'blur');
    return 'ok';
  }

  function setCheck(el, want) {
    if (el.checked !== want) {
      el.click();
      if (el.checked !== want) { el.checked = want; fire(el, 'change'); }
    }
    return el.checked === want ? 'ok' : 'check';
  }

  const truthy = (v) => v === true || /^(yes|y|true|1)$/i.test(String(v));

  async function apply(el, spec, v) {
    if (el.tagName === 'SELECT') {
      const val = spec.type === 'yesno' ? (truthy(v) ? 'Yes' : 'No') : v;
      return setSelect(el, val);
    }
    if (el.type === 'checkbox') return setCheck(el, truthy(v));
    if (spec.type === 'typeahead') { setText(el, v); return 'pick'; }
    return setText(el, String(v));
  }

  function radioGroups(els) {
    const groups = new Map();
    els.filter(e => e.type === 'radio').forEach(r => {
      const key = r.name || (r.parentElement && r.parentElement.parentElement) || r;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(r);
    });
    return Array.from(groups.values());
  }

  function groupLabel(radios) {
    let a = radios[0].parentElement;
    for (let d = 0; a && d < 6; d++, a = a.parentElement) {
      if (!radios.every(r => a.contains(r))) continue;
      const cands = Array.from(a.querySelectorAll('label, legend, .control-label, .reg, span, p'))
        .filter(n => !radios.some(r => n.contains(r) || (r.id && n.getAttribute('for') === r.id)) && textOf(n).length > 1 && textOf(n).length < 120);
      if (cands.length) return textOf(cands[0]);
    }
    return radios[0].name || '';
  }

  const radioText = (r) => textOf(optionLabelEl(r)) || (r.nextSibling && r.nextSibling.textContent) || r.value || '';

  function mark(el, cls, tip) {
    const target = (el.type === 'checkbox' || el.type === 'radio') && getComputedStyle(el).opacity === '0' ? (optionLabelEl(el) || el) : el;
    target.classList.remove('gstf-ok', 'gstf-you', 'gstf-check');
    if (cls) target.classList.add(cls);
    if (tip) target.setAttribute('data-gstf-tip', tip); else target.removeAttribute('data-gstf-tip');
  }

  function ensurePageStyle() {
    if (document.getElementById('gstf-page-style')) return;
    const s = document.createElement('style');
    s.id = 'gstf-page-style';
    s.textContent = `
      .gstf-ok { outline: 2px solid #1a7f37 !important; outline-offset: 1px; background-color: #eef8f0 !important; }
      .gstf-check { outline: 2px dashed #b26b00 !important; outline-offset: 1px; }
      .gstf-you { outline: 3px solid #d97706 !important; outline-offset: 2px; box-shadow: 0 0 0 6px rgba(217,119,6,.18) !important; animation: gstfPulse 1.4s ease-in-out 3; }
      @keyframes gstfPulse { 50% { box-shadow: 0 0 0 10px rgba(217,119,6,.05); } }`;
    document.head.appendChild(s);
  }

  /* ---------------- fill ---------------- */
  // opts (used by the registration autopilot): { clientId, ctx, personIdx, overwrite }
  async function fillPage(opts = {}) {
    if (opts.clientId) await load();
    const p = opts.clientId ? profiles.find(x => x.id === opts.clientId) : profile();
    if (!p) { ui.lastResult = { error: 'Pick a client first.' }; render(); return ui.lastResult; }
    const ctx = opts.ctx || currentCtx();
    if (ctx === 'unknown') {
      ui.lastResult = { error: 'Could not tell which registration tab this is. Choose it under "Section" and press Fill again.' };
      render(); return ui.lastResult;
    }
    filling = true;
    ensurePageStyle();
    const personIdx = opts.personIdx != null ? opts.personIdx : personIndexFor(ctx, p);
    const res = new Map(); // el -> {status, label, note}
    const overwrite = opts.overwrite != null ? opts.overwrite : !!settings.overwrite;
    const C = G.CONSTITUTIONS[p.constitution];
    const docs = window.GSTDocs ? await GSTDocs.Store.all(p.id) : {};
    const attached = new Set();

    for (let pass = 0; pass < 5; pass++) {
      let changed = 0;
      const els = controls();

      for (const el of els) {
        if (el.type === 'radio') continue;
        const prev = res.get(el);
        if (prev && ['ok', 'you', 'pick', 'kept', 'nodata'].includes(prev.status)) continue;
        const lab = labelOf(el), attrs = attrText(el);
        // Upload fields: attach the client's saved document if there is one
        if (el.type === 'file') {
          const key = window.GSTDocs ? GSTDocs.slotForUpload(lab + ' ' + attrs, ctx, p, personIdx) : '';
          const doc = key && docs[key];
          if (el.files && el.files.length && !attached.has(el)) { res.set(el, { status: 'ok', label: lab || 'Upload', note: '' }); continue; }
          if (doc && !attached.has(el)) {
            try {
              const dt = new DataTransfer();
              dt.items.add(GSTDocs.toFile(doc));
              el.files = dt.files;
              fire(el, 'input', 'change');
              attached.add(el);
              res.set(el, { status: 'ok', label: lab || 'Upload', note: `attached ${doc.name}` });
              changed++;
              await sleep(400);
            } catch (e) { res.set(el, { status: 'you', label: lab || 'Upload', note: 'Upload' }); }
          } else if (!attached.has(el)) res.set(el, { status: 'you', label: lab || 'Upload', note: key ? 'Upload (no saved document)' : 'Upload' });
          continue;
        }
        const why = sensitiveReason(el, lab, attrs);
        if (why) { res.set(el, { status: 'you', label: lab || why, note: why }); continue; }
        // Type of proof for the principal place of business
        if (ctx === 'ppob' && el.tagName === 'SELECT' && /type of (document|proof)|document type|proof type|proof of principal/i.test(lab)) {
          const sub = docs['entity:address'] && docs['entity:address'].subtype;
          if (sub) { const r = setSelect(el, sub); res.set(el, { status: r === 'noopt' ? 'wait' : r, label: lab, note: r === 'noopt' ? `no option “${sub}”` : '' }); if (r === 'ok') changed++; continue; }
        }
        if (el.disabled) continue;

        let spec = specFor(el, ctx, lab, attrs);

        // Business activity tick-boxes on the principal place of business tab
        if (!spec && ctx === 'ppob' && el.type === 'checkbox') {
          const t = squash(lab);
          const hit = p.ppob.activities.find(a => t && (squash(a) === t || t.includes(squash(a)) || squash(a).includes(t)));
          if (hit) { const r = setCheck(el, true); res.set(el, { status: r, label: lab }); if (r === 'ok') changed++; }
          else if (G.ACTIVITIES.some(a => squash(a) === t || t.includes(squash(a)))) res.set(el, { status: 'nodata', label: lab });
          continue;
        }
        if (!spec) { res.set(el, { status: 'unknown', label: lab || attrs.trim() || el.type }); continue; }

        const v = G.resolve(spec.key, p, ctx, personIdx);
        if (v === '' || v == null || (Array.isArray(v) && !v.length)) { res.set(el, { status: 'nodata', label: lab || spec.label }); continue; }

        const isText = el.tagName !== 'SELECT' && el.type !== 'checkbox';
        if (isText && el.readOnly && el.value && spec.type !== 'date') { res.set(el, { status: 'kept', label: lab || spec.label, note: 'locked by portal' }); continue; }
        const selHasValue = el.tagName === 'SELECT' && el.selectedIndex > 0 && !/^select/.test(norm(el.options[el.selectedIndex].text));
        const curMatches = el.tagName === 'SELECT' ? (findOption(el, typeof v === 'boolean' ? (v ? 'Yes' : 'No') : String(v)) === el.options[el.selectedIndex]) : squash(el.value) === squash(v);
        if (!overwrite && !prev && ((isText && el.value) || selHasValue) && !curMatches) {
          res.set(el, { status: 'kept', label: lab || spec.label, note: 'already had a value' }); continue;
        }
        const r = await apply(el, spec, v);
        if (r === 'noopt') { res.set(el, { status: 'wait', label: lab || spec.label, note: `no option matching “${v}” yet` }); continue; }
        res.set(el, { status: r, label: lab || spec.label, note: r === 'pick' ? 'pick the suggestion that pops up' : (spec.taught ? 'taught field' : '') });
        changed++;
        if (el.tagName === 'SELECT') await sleep(250); // dependent dropdowns (State → District, etc.)
      }

      for (const group of radioGroups(els)) {
        const first = group[0];
        if (res.get(first) && res.get(first).status === 'ok') continue;
        const lab = groupLabel(group);
        const spec = specFor(first, ctx, lab, attrText(first));
        if (!spec) continue;
        const v = G.resolve(spec.key, p, ctx, personIdx);
        if (v === '' || v == null) { group.forEach(r => res.set(r, { status: 'nodata', label: lab })); continue; }
        const want = spec.type === 'yesno' ? (truthy(v) ? 'yes' : 'no') : squash(v);
        const target = group.find(r => squash(radioText(r)) === want) || group.find(r => squash(r.value) === want) ||
          group.find(r => squash(radioText(r)).startsWith(want));
        if (!target) { res.set(first, { status: 'wait', label: lab, note: `no choice “${v}”` }); continue; }
        if (!target.checked) { target.click(); changed++; }
        group.forEach(r => res.set(r, { status: r === target ? 'ok' : 'skip', label: lab }));
      }

      if (pass > 0 && !changed) break;
      await sleep(pass === 0 ? 700 : 900);
    }

    // Paint the page and build the report
    const report = { ctx, person: personIdx, ok: [], you: [], check: [], unknown: [], kept: [], nodata: 0 };
    let firstYou = null;
    for (const [el, r] of res) {
      if (!el.isConnected) continue;
      if (r.status === 'ok') { mark(el.type === 'file' && !visible(el) ? el.parentElement : el, 'gstf-ok'); report.ok.push(r.label); if (r.note && /^attached/.test(r.note)) (report.attached = report.attached || []).push(r.note.replace(/^attached /, '')); }
      else if (r.status === 'you') { mark(el, 'gstf-you', `Your turn: ${r.note}`); report.you.push(r.note); if (!firstYou) firstYou = el; }
      else if (r.status === 'pick' || r.status === 'check' || r.status === 'wait') { mark(el, 'gstf-check', r.note); report.check.push(`${r.label}${r.note ? ' – ' + r.note : ''}`); }
      else if (r.status === 'kept') { report.kept.push(r.label); }
      else if (r.status === 'nodata') { report.nodata++; }
      else if (r.status === 'unknown' && !el.value && el.type !== 'checkbox') { report.unknown.push(r.label); }
    }
    // De-duplicate radio entries
    report.ok = Array.from(new Set(report.ok));
    report.you = Array.from(new Set(report.you));
    report.unknown = Array.from(new Set(report.unknown)).slice(0, 12);
    if (ctx === 'goods') {
      const extra = p.goods.hsn.filter(Boolean).length + p.goods.sac.filter(Boolean).length - 2;
      if (extra > 0) report.check.push('Add the remaining HSN/SAC codes one by one – see Values');
    }
    if (ctx === 'promoter' && p.persons.length > 1) {
      report.tip = `Filled ${C.person.toLowerCase()} ${personIdx + 1} of ${p.persons.length}. After you click “Save & Add New” on the portal, choose the next person here and fill again.`;
    }
    report.missingUploads = Array.from(res.entries()).filter(([el, r]) => el.isConnected && el.type === 'file' && r.status === 'you').map(([, r]) => r.label);
    ui.lastResult = report;
    filling = false;
    render();
    if (firstYou && !opts.quiet) {
      firstYou.scrollIntoView({ behavior: 'smooth', block: 'center' });
      if (firstYou.type !== 'file') setTimeout(() => firstYou.focus({ preventScroll: true }), 400);
    }
    return report;
  }

  function personIndexFor(ctx, p) {
    if (ui.personIdx != null && ui.personIdx < p.persons.length) return ui.personIdx;
    if (ctx === 'signatory' || ctx === 'representative') return Math.max(0, p.persons.findIndex(x => x.isSignatory));
    return 0;
  }

  /* ---------------- panel ---------------- */
  const host = document.createElement('div');
  host.id = 'gstf-host';
  host.style.cssText = 'position:fixed;z-index:2147483646;right:16px;bottom:16px;';
  const shadow = host.attachShadow({ mode: 'open' });
  document.documentElement.appendChild(host);

  const CSS_TEXT = `
    :host { all: initial; }
    * { box-sizing: border-box; font-family: system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; }
    .panel { width: 330px; max-height: min(78vh, 640px); display: flex; flex-direction: column; background: #fff; color: #1d2433;
      border: 1px solid #d6d3ca; border-radius: 12px; box-shadow: 0 10px 30px rgba(15,20,35,.18), 0 2px 6px rgba(15,20,35,.08); font-size: 13px; line-height: 1.4; }
    .hd { display: flex; align-items: center; gap: 8px; padding: 9px 10px 9px 12px; background: #1f4e8c; color: #fff; border-radius: 11px 11px 0 0; cursor: move; user-select: none; }
    .hd b { font-size: 13px; flex: 1; }
    .pill { font-size: 11px; background: rgba(255,255,255,.18); padding: 2px 7px; border-radius: 999px; white-space: nowrap; max-width: 150px; overflow: hidden; text-overflow: ellipsis; }
    .x { all: unset; cursor: pointer; width: 22px; height: 22px; display: grid; place-items: center; border-radius: 6px; font-size: 15px; }
    .x:hover { background: rgba(255,255,255,.18); }
    .bd { padding: 10px 12px 12px; overflow: auto; display: flex; flex-direction: column; gap: 9px; }
    label.row { display: grid; gap: 3px; font-size: 11.5px; color: #4a5263; font-weight: 600; }
    select { width: 100%; padding: 6px 8px; border: 1px solid #cfccc2; border-radius: 7px; background: #fff; color: #1d2433; font-size: 13px; }
    .opts { display: flex; flex-direction: column; gap: 4px; font-size: 12.5px; color: #4a5263; }
    .opts label { display: flex; gap: 6px; align-items: center; cursor: pointer; }
    .btns { display: flex; gap: 6px; }
    button { font-size: 13px; padding: 7px 10px; border-radius: 8px; border: 1px solid #cfccc2; background: #fff; color: #1d2433; cursor: pointer; }
    button:hover { border-color: #7a8193; }
    button.primary { background: #1f4e8c; color: #fff; border-color: #1f4e8c; font-weight: 600; flex: 1; }
    button.primary:disabled { opacity: .6; cursor: progress; }
    button.link { border: 0; background: none; color: #1f4e8c; padding: 0; font-size: 12px; text-decoration: underline; }
    .res { border: 1px solid #e3e1da; border-radius: 9px; padding: 8px 10px; background: #faf9f6; display: flex; flex-direction: column; gap: 5px; }
    .res .line { display: flex; gap: 6px; align-items: baseline; }
    .dot { width: 8px; height: 8px; border-radius: 50%; flex: none; transform: translateY(-1px); }
    .g { background: #1a7f37; } .a { background: #d97706; } .y { background: #b26b00; } .n { background: #9aa0ad; }
    .you { background: #fff4e5; border: 1px solid #f3c78a; color: #7a4100; border-radius: 8px; padding: 7px 9px; font-weight: 600; }
    .err { background: #fdecea; color: #b42318; border-radius: 8px; padding: 7px 9px; }
    .tip { color: #4a5263; font-size: 12px; }
    details summary { cursor: pointer; color: #4a5263; font-size: 12px; }
    details ul { margin: 4px 0 0; padding-left: 18px; color: #4a5263; font-size: 12px; }
    .vals { display: flex; flex-direction: column; gap: 4px; }
    .val { display: grid; grid-template-columns: 1fr auto; gap: 6px; align-items: center; border-bottom: 1px solid #efede7; padding: 4px 0; }
    .val small { display: block; color: #7a8193; font-size: 11px; }
    .val span { word-break: break-word; }
    .val button { padding: 3px 8px; font-size: 11.5px; }
    .ft { font-size: 11.5px; color: #7a8193; border-top: 1px solid #efede7; padding-top: 8px; display: flex; justify-content: space-between; gap: 8px; align-items: center; }
    .mini { all: unset; cursor: pointer; background: #1f4e8c; color: #fff; font: 600 12px system-ui, sans-serif; padding: 9px 13px; border-radius: 999px; box-shadow: 0 6px 18px rgba(15,20,35,.25); }
    .muted { color: #7a8193; font-size: 12px; }
    @media (prefers-color-scheme: dark) {
      .panel { background: #1c1f26; color: #e8eaef; border-color: #3a3f4b; }
      select, button { background: #232731; color: #e8eaef; border-color: #3a3f4b; }
      label.row, .opts, .tip, details summary, details ul { color: #b9bfcc; }
      .res { background: #20242c; border-color: #2f3440; }
      .val { border-color: #2f3440; } .ft { border-color: #2f3440; }
      button.link { color: #8cb4ec; }
    }`;

  function sectionOptions(ctx) {
    const auto = detectCtx();
    const autoLbl = G.SECTIONS[auto] || 'not recognised';
    return `<option value="">Auto: ${esc(autoLbl)}</option>` +
      Object.entries(G.SECTIONS).filter(([k]) => k !== 'otp')
        .map(([k, v]) => `<option value="${k}"${ui.ctxOverride === k ? ' selected' : ''}>${esc(v)}</option>`).join('');
  }

  function render() {
    const p = profile();
    if (settings.minimized) {
      shadow.innerHTML = `<style>${CSS_TEXT}</style><button class="mini" id="expand" title="GST Registration Filler">GST Filler</button>`;
      shadow.getElementById('expand').onclick = () => { saveSettings({ minimized: false }); render(); };
      return;
    }
    const ctx = currentCtx();
    const C = p ? G.CONSTITUTIONS[p.constitution] : null;
    const showPerson = p && G.PERSON_SECTIONS.includes(ctx);
    const pIdx = p ? personIndexFor(ctx, p) : 0;

    let body = '';
    if (!profiles.length) {
      body = `<div class="err" style="background:#eef3fb;color:#1f4e8c">No clients saved yet.</div>
        <button class="primary" id="manage">Add a client</button>`;
    } else if (ui.mode === 'values' && p) {
      const vals = G.valuesFor(p, ctx, pIdx);
      body = `<div class="tip">Values for <b>${esc(G.SECTIONS[ctx] || ctx)}</b>${showPerson ? ` – ${esc(G.fullName(p.persons[pIdx]) || C.person + ' ' + (pIdx + 1))}` : ''}. Tap Copy and paste into the portal.</div>
        <div class="vals">${vals.length ? vals.map((v, i) => `<div class="val"><span><small>${esc(v.label)}</small>${esc(v.value)}</span><button data-copy="${i}">Copy</button></div>`).join('') : '<div class="muted">Nothing saved for this section.</div>'}</div>
        <button id="back">← Back</button>`;
      ui._vals = vals;
    } else if (ui.mode === 'teach') {
      const specs = G.FIELDS.filter(f => f.ctx.includes(ctx) && f.type !== 'multicheck');
      const taught = Object.keys(mappings[ctx] || {}).length;
      if (!ui.teachEl) {
        body = `<div class="you">Click the portal field you want to teach…</div>
          <div class="tip">Use this when a field on <b>${esc(G.SECTIONS[ctx] || ctx)}</b> isn’t filled. The extension will remember it for every client.</div>
          <div class="btns"><button id="cancel">Cancel</button>${taught ? `<button id="forget">Forget ${taught} taught field${taught > 1 ? 's' : ''} here</button>` : ''}</div>`;
      } else {
        const lab = labelOf(ui.teachEl) || attrText(ui.teachEl).trim() || '(no label)';
        body = `<div class="tip">Portal field: <b>${esc(lab.slice(0, 80))}</b></div>
          <label class="row">This field should get
            <select id="teach-key">${specs.map(f => `<option value="${esc(f.key)}"${ui.teachKey === f.key ? ' selected' : ''}>${esc(f.label)}</option>`).join('')}</select></label>
          <div class="btns"><button class="primary" id="teach-save">Remember</button><button id="cancel">Cancel</button></div>`;
      }
    } else {
      const r = ui.lastResult;
      let res = '';
      if (r && r.error) res = `<div class="err">${esc(r.error)}</div>`;
      else if (r) {
        res = `<div class="res">
          ${r.you.length ? `<div class="you">Your turn: ${esc(Array.from(new Set(r.you)).join(', '))} – highlighted in orange</div>` : ''}
          <div class="line"><span class="dot g"></span><span>${r.ok.length} field${r.ok.length === 1 ? '' : 's'} filled (green)</span></div>
          ${r.attached && r.attached.length ? `<div class="line"><span class="dot g"></span><span>Attached: ${esc(r.attached.join(', '))}</span></div>` : ''}
          ${r.check.length ? `<details open><summary><span class="dot y" style="display:inline-block"></span> ${r.check.length} to check (dashed)</summary><ul>${r.check.map(x => `<li>${esc(x)}</li>`).join('')}</ul></details>` : ''}
          ${r.kept.length ? `<details><summary>${r.kept.length} left as they were</summary><ul>${r.kept.map(x => `<li>${esc(x)}</li>`).join('')}</ul></details>` : ''}
          ${r.unknown.length ? `<details><summary>${r.unknown.length} empty field${r.unknown.length > 1 ? 's' : ''} not recognised</summary><ul>${r.unknown.map(x => `<li>${esc(x)}</li>`).join('')}</ul><div class="tip">Use <b>Teach a field</b> once and it will fill next time.</div></details>` : ''}
          ${r.tip ? `<div class="tip">${esc(r.tip)}</div>` : ''}
          <div class="tip">Review, then click Save &amp; Continue on the portal yourself.</div>
        </div>`;
      }
      body = `
        <label class="row">Client
          <select id="client"><option value="">Choose a client…</option>${profiles.map(x => `<option value="${x.id}"${p && x.id === p.id ? ' selected' : ''}>${esc(x.nickname || x.business.tradeName || x.partA.legalName || 'Untitled')} · ${esc(G.CONSTITUTIONS[x.constitution].label)}</option>`).join('')}</select></label>
        <label class="row">Section on this page
          <select id="section">${sectionOptions(ctx)}</select></label>
        ${showPerson ? `<label class="row">${esc(ctx === 'promoter' ? C.person : 'Person')} to fill
          <select id="person">${p.persons.map((x, i) => `<option value="${i}"${i === pIdx ? ' selected' : ''}>${i + 1}. ${esc(G.fullName(x) || C.person)}${x.isSignatory ? ' (signatory)' : ''}</option>`).join('')}</select></label>` : ''}
        <div class="opts">
          <label><input type="checkbox" id="overwrite"${settings.overwrite ? ' checked' : ''}> Replace values already on the page</label>
          <label><input type="checkbox" id="auto"${settings.auto ? ' checked' : ''}> Fill automatically when I open the next tab</label>
        </div>
        <div class="btns"><button class="primary" id="fill"${filling ? ' disabled' : ''}>${filling ? 'Filling…' : 'Fill this page'}</button></div>
        <div class="btns"><button id="values" style="flex:1">Values to copy</button><button id="teach" style="flex:1">Teach a field</button></div>
        ${ctx === 'ppob' ? `<div class="btns"><button id="learnj" style="flex:1" title="Reads every commissionerate, division and range for this state into GST Desk's dropdowns">Learn jurisdiction lists</button></div>${ui.learnMsg ? `<div class="tip">${esc(ui.learnMsg)}</div>` : ''}` : ''}
        ${res}`;
    }

    shadow.innerHTML = `<style>${CSS_TEXT}</style>
      <div class="panel" role="dialog" aria-label="GST Registration Filler">
        <div class="hd" id="drag"><b>GST Filler</b><span class="pill">${esc(G.SECTIONS[ctx] || 'Section not recognised')}</span>
          <button class="x" id="min" title="Minimise" aria-label="Minimise">–</button></div>
        <div class="bd">${body}
          <div class="ft"><span>CAPTCHA, OTP, uploads &amp; Submit: you.</span><button class="link" id="manage2">Manage clients</button></div>
        </div>
      </div>`;
    wire();
  }

  function wire() {
    const $ = (id) => shadow.getElementById(id);
    const on = (id, ev, fn) => { const e = $(id); if (e) e.addEventListener(ev, fn); };
    on('min', 'click', () => { saveSettings({ minimized: true }); render(); });
    const openMgr = () => chrome.runtime.sendMessage({ type: 'open-manager' });
    on('manage', 'click', openMgr);
    on('manage2', 'click', openMgr);
    on('client', 'change', (e) => { saveSettings({ panelProfile: e.target.value }); ui.personIdx = null; ui.lastResult = null; render(); });
    on('section', 'change', (e) => { ui.ctxOverride = e.target.value; ui.personIdx = null; ui.lastResult = null; render(); });
    on('person', 'change', (e) => { ui.personIdx = +e.target.value; ui.lastResult = null; render(); });
    on('overwrite', 'change', (e) => saveSettings({ overwrite: e.target.checked }));
    on('auto', 'change', (e) => { saveSettings({ auto: e.target.checked }); lastAutoCtx = currentCtx(); });
    on('fill', 'click', () => { filling = true; render(); fillPage().catch(err => { filling = false; ui.lastResult = { error: 'Something went wrong: ' + err.message }; render(); }); });
    on('values', 'click', () => { ui.mode = 'values'; render(); });
    on('learnj', 'click', async () => {
      if (!window.__gstfLearnJuris) return;
      try {
        ui.learnMsg = 'Reading the lists…'; render();
        const r = await window.__gstfLearnJuris((m) => { ui.learnMsg = m; render(); });
        ui.learnMsg = `Saved ${r.comms} commissionerates with their divisions and ranges for ${r.state}. They now appear as dropdowns in GST Desk.`;
      } catch (e) { ui.learnMsg = e.message; }
      render();
    });
    on('back', 'click', () => { ui.mode = 'main'; render(); });
    on('teach', 'click', () => { ui.mode = 'teach'; ui.teachEl = null; render(); startTeach(); });
    on('cancel', 'click', () => { stopTeach(); ui.mode = 'main'; ui.teachEl = null; render(); });
    on('forget', 'click', async () => {
      const ctx = currentCtx();
      delete mappings[ctx];
      await chrome.storage.local.set({ [K.mappings]: mappings });
      stopTeach(); ui.mode = 'main'; render();
    });
    on('teach-key', 'change', (e) => { ui.teachKey = e.target.value; });
    on('teach-save', 'click', async () => {
      const ctx = currentCtx();
      const key = $('teach-key').value;
      const el = ui.teachEl;
      const sigs = sigsOf(el, labelOf(el));
      if (!sigs.length) return;
      mappings[ctx] = { ...(mappings[ctx] || {}), [sigs[0]]: key };
      await chrome.storage.local.set({ [K.mappings]: mappings });
      el.classList.remove('gstf-check');
      ui.mode = 'main'; ui.teachEl = null; ui.teachKey = null;
      ui.lastResult = null;
      render();
    });
    shadow.querySelectorAll('[data-copy]').forEach(b => b.addEventListener('click', async () => {
      const v = ui._vals[+b.dataset.copy].value;
      try { await navigator.clipboard.writeText(v); } catch (_) {
        const t = document.createElement('textarea'); t.value = v; document.body.appendChild(t); t.select(); document.execCommand('copy'); t.remove();
      }
      b.textContent = 'Copied'; setTimeout(() => { b.textContent = 'Copy'; }, 1200);
    }));
    // Drag
    const hd = $('drag');
    if (hd) hd.addEventListener('mousedown', (e) => {
      if (e.target.closest('button')) return;
      const r = host.getBoundingClientRect();
      const dx = e.clientX - r.left, dy = e.clientY - r.top;
      const move = (m) => {
        host.style.left = Math.max(0, Math.min(window.innerWidth - 60, m.clientX - dx)) + 'px';
        host.style.top = Math.max(0, Math.min(window.innerHeight - 40, m.clientY - dy)) + 'px';
        host.style.right = 'auto'; host.style.bottom = 'auto';
      };
      const up = () => { document.removeEventListener('mousemove', move); document.removeEventListener('mouseup', up); saveSettings({ pos: { left: host.style.left, top: host.style.top } }); };
      document.addEventListener('mousemove', move); document.addEventListener('mouseup', up);
    });
  }

  /* ---------------- teach mode ---------------- */
  function teachCatcher(e) {
    const el = e.target;
    if (!el || el.closest && el.closest('#gstf-host')) return;
    if (!/^(INPUT|SELECT|TEXTAREA)$/.test(el.tagName)) return;
    ensurePageStyle();
    stopTeach();
    ui.teachEl = el;
    el.classList.add('gstf-check');
    render();
  }
  function startTeach() { document.addEventListener('focusin', teachCatcher, true); document.addEventListener('mousedown', teachCatcher, true); }
  function stopTeach() { document.removeEventListener('focusin', teachCatcher, true); document.removeEventListener('mousedown', teachCatcher, true); }

  /* ---------------- follow tab changes ---------------- */
  let lastAutoCtx = '';
  let lastShownCtx = '';
  let moTimer = null;
  const mo = new MutationObserver(() => {
    if (filling) return;
    clearTimeout(moTimer);
    moTimer = setTimeout(() => {
      if (filling || ui.ctxOverride) return;
      const ctx = detectCtx();
      if (ctx !== lastShownCtx) {
        lastShownCtx = ctx;
        ui.personIdx = null;
        if (ui.mode !== 'teach') { ui.lastResult = null; render(); }
      }
      if (window.__gstfAutopilotOn) return;
      if (settings.auto && profile() && ctx !== lastAutoCtx && !['unknown', 'otp', 'verification'].includes(ctx)) {
        lastAutoCtx = ctx;
        filling = true; render();
        fillPage().catch(() => { filling = false; render(); });
      }
    }, 1200);
  });

  (async function init() {
    await load();
    const onRegPage = /reg\.gst\.gov\.in|registration/i.test(location.href);
    if (settings.minimized === undefined) settings.minimized = !onRegPage;
    if (settings.pos && settings.pos.left) {
      host.style.left = settings.pos.left; host.style.top = settings.pos.top; host.style.right = 'auto'; host.style.bottom = 'auto';
      const r = host.getBoundingClientRect();
      if (r.left > window.innerWidth - 40 || r.top > window.innerHeight - 40) { host.style.left = ''; host.style.top = ''; host.style.right = '16px'; host.style.bottom = '16px'; }
    }
    if (!settings.panelProfile && settings.lastProfile) settings.panelProfile = settings.lastProfile;
    lastShownCtx = detectCtx();
    render();
    mo.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['class', 'style'] });
  })();

  // Exposed for the extension's own test page only.
  window.__gstfTest = { detectCtx, labelOf, fillPage, specFor, render, get result() { return ui.lastResult; } };
  // Used by regrun.js (registration autopilot) on the same page
  window.__gstfApi = { fill: fillPage, detectCtx, labelOf, controls, visible, setSelect, setText, setCheck, findOption, fire, norm, squash, sleep,
    hidePanel(h) { host.style.display = h ? 'none' : ''; } };
})();
