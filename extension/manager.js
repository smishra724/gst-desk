/* Client manager page */
(function () {
  'use strict';
  const G = window.GSTR;
  const K = G.KEYS;
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  let profiles = [];
  let mappings = {};
  let currentId = null;
  let saveTimer = null;

  /* ---------- storage ---------- */
  const store = {
    async load() {
      const r = await chrome.storage.local.get([K.profiles, K.mappings, K.settings]);
      profiles = (r[K.profiles] || []).map(G.normalizeProfile);
      mappings = r[K.mappings] || {};
      const s = r[K.settings] || {};
      currentId = s.lastProfile && profiles.some(p => p.id === s.lastProfile) ? s.lastProfile : (profiles[0] && profiles[0].id) || null;
    },
    async save() {
      await chrome.storage.local.set({ [K.profiles]: profiles });
    },
    async saveSettings(patch) {
      const r = await chrome.storage.local.get(K.settings);
      await chrome.storage.local.set({ [K.settings]: { ...(r[K.settings] || {}), ...patch } });
    }
  };

  const current = () => profiles.find(p => p.id === currentId) || null;
  const getPath = (obj, path) => path.split('.').reduce((o, k) => (o == null ? o : o[k]), obj);
  const setPath = (obj, path, v) => {
    const ks = path.split('.');
    let o = obj;
    for (let i = 0; i < ks.length - 1; i++) o = o[ks[i]];
    o[ks[ks.length - 1]] = v;
  };

  function toast(msg) {
    const t = $('#toast');
    t.textContent = msg;
    t.classList.add('show');
    clearTimeout(toast.t);
    toast.t = setTimeout(() => t.classList.remove('show'), 2200);
  }

  function queueSave() {
    const p = current();
    if (p) p.updated = new Date().toISOString();
    const s = $('#saved');
    if (s) s.textContent = 'Saving…';
    clearTimeout(saveTimer);
    saveTimer = setTimeout(async () => {
      await store.save();
      const s2 = $('#saved');
      if (s2) s2.textContent = 'Saved';
      renderList();
    }, 350);
  }

  const displayName = (p) => G.displayName(p);

  /* ---------- sidebar ---------- */
  function renderList() {
    const q = ($('#search').value || '').trim().toLowerCase();
    const list = $('#client-list');
    const items = profiles
      .filter(p => !q || [displayName(p), p.partA.legalName, p.partA.pan, p.business.tradeName, p.gstin].join(' ').toLowerCase().includes(q))
      .sort((a, b) => displayName(a).localeCompare(displayName(b)));
    list.innerHTML = items.map(p => {
      const errs = G.validate(p).filter(e => e.level === 'error').length;
      const badge = errs ? `<span class="badge err">${errs} to fix</span>` : '<span class="badge ok">Ready</span>';
      return `<li><button data-open="${p.id}" aria-current="${p.id === currentId}">
        <span class="nm">${esc(displayName(p))}</span>
        <span class="meta">${p.gstin ? `<span class="badge mono">${esc(p.gstin)}</span>` : `<span class="badge">${p.status === 'new' ? 'New registration' : esc(G.CONSTITUTIONS[p.constitution].label)}</span>`}${badge}</span>
      </button></li>`;
    }).join('');
    $('#empty-list').hidden = profiles.length > 0;
  }

  /* ---------- field builders ---------- */
  function fld(path, label, o = {}) {
    const p = current();
    const v = getPath(p, path) ?? '';
    const span = o.span ? ` s${o.span}` : '';
    const id = 'f_' + path.replace(/\./g, '_');
    const req = o.req ? ' class="req"' : '';
    let control;
    if (o.type === 'select') {
      const opts = (o.options || []).map(x => {
        const [val, txt] = Array.isArray(x) ? x : [x, x];
        return `<option value="${esc(val)}"${String(val) === String(v) ? ' selected' : ''}>${esc(txt)}</option>`;
      }).join('');
      control = `<select id="${id}" data-path="${path}"><option value="">Select…</option>${opts}</select>`;
    } else if (o.type === 'seg') {
      control = `<div class="seg" role="radiogroup" aria-label="${esc(label)}">${(o.options || []).map(x => {
        const [val, txt] = Array.isArray(x) ? x : [x, x];
        return `<label><input type="radio" name="${id}" data-path="${path}" value="${esc(val)}"${String(val) === String(v) ? ' checked' : ''}>${esc(txt)}</label>`;
      }).join('')}</div>`;
      return `<div class="f${span}" data-wrap="${path}"><span class="lbl${o.req ? ' req' : ''}">${esc(label)}</span>${control}<span class="msg"></span>${o.help ? `<span class="help">${esc(o.help)}</span>` : ''}</div>`;
    } else if (o.type === 'textarea') {
      control = `<textarea id="${id}" data-path="${path}" placeholder="${esc(o.placeholder || '')}">${esc(v)}</textarea>`;
    } else {
      const t = o.type || 'text';
      const extra = [
        o.upper ? 'class="upper" data-upper="1"' : '',
        o.digits ? 'inputmode="numeric" data-digits="1"' : '',
        o.maxlength ? `maxlength="${o.maxlength}"` : '',
        o.placeholder ? `placeholder="${esc(o.placeholder)}"` : '',
        o.list ? `list="${o.list}"` : ''
      ].join(' ');
      control = `<input id="${id}" type="${t}" data-path="${path}" value="${esc(v)}" ${extra} autocomplete="off">`;
    }
    return `<div class="f${span}" data-wrap="${path}"><label for="${id}"${req}>${esc(label)}</label>${control}<span class="msg"></span>${o.help ? `<span class="help">${esc(o.help)}</span>` : ''}</div>`;
  }

  function addressBlock(base, o = {}) {
    return [
      fld(`${base}.building`, 'Building / Flat no.', { span: 3, req: true }),
      fld(`${base}.floor`, 'Floor no.', { span: 2 }),
      fld(`${base}.premises`, 'Name of premises / building', { span: 4 }),
      fld(`${base}.road`, 'Road / Street', { span: 3 }),
      fld(`${base}.locality`, 'Locality / Sub-locality', { span: 4 }),
      fld(`${base}.city`, 'City / Town / Village', { span: 4, req: true }),
      fld(`${base}.landmark`, 'Nearby landmark', { span: 4 }),
      fld(`${base}.district`, 'District', { span: 4, req: o.districtReq }),
      fld(`${base}.state`, 'State', { span: 4, type: 'select', options: G.STATES }),
      fld(`${base}.pin`, 'PIN code', { span: 2, req: true, digits: true, maxlength: 6 })
    ].join('');
  }

  /* ---------- editor ---------- */
  function renderEditor() {
    const p = current();
    const ed = $('#editor');
    if (!p) {
      ed.innerHTML = `<div class="welcome"><h2>Add a client to get started</h2>
        <p>Fill in an entity once — Part A, business details, promoters, address, HSN/SAC. Then open the GST portal, pick the client in the panel and press <b>Fill this page</b> on each tab. You type every CAPTCHA and OTP and click Save &amp; Continue yourself.</p>
        <p style="margin-top:14px"><button class="primary" data-act="new">+ New client</button></p></div>`;
      return;
    }
    const C = G.CONSTITUTIONS[p.constitution];
    const constOpts = Object.entries(G.CONSTITUTIONS).map(([k, c]) => [k, c.label]);
    const yesno = [['yes', 'Yes'], ['no', 'No']];

    const people = p.persons.map((x, i) => {
      const b = `persons.${i}`;
      const isCo = p.constitution.endsWith('company') || p.constitution === 'llp';
      return `<div class="person" data-person="${i}">
        <div class="ph">
          <h4>${esc(C.person)} ${p.persons.length > 1 ? i + 1 : ''}${G.fullName(x) ? ' · ' + esc(G.fullName(x)) : ''}</h4>
          <div class="acts">
            <label class="sig"><input type="radio" name="signatory" data-act="signatory" data-i="${i}"${x.isSignatory ? ' checked' : ''}> Authorised signatory</label>
            ${p.persons.length > C.min ? `<button class="danger small" data-act="remove-person" data-i="${i}">Remove</button>` : ''}
          </div>
        </div>
        <div class="pb"><div class="grid">
          ${fld(`${b}.firstName`, 'First name', { span: 4, req: true })}
          ${fld(`${b}.middleName`, 'Middle name', { span: 4 })}
          ${fld(`${b}.lastName`, 'Last name', { span: 4 })}
          ${fld(`${b}.fatherFirst`, "Father's first name", { span: 4, req: true })}
          ${fld(`${b}.fatherMiddle`, "Father's middle name", { span: 4 })}
          ${fld(`${b}.fatherLast`, "Father's last name", { span: 4 })}
          ${fld(`${b}.dob`, 'Date of birth', { span: 3, type: 'date', req: true })}
          ${fld(`${b}.gender`, 'Gender', { span: 5, type: 'seg', options: G.GENDERS, req: true })}
          ${fld(`${b}.designation`, 'Designation / Status', { span: 4, type: 'select', options: C.designations })}
          ${fld(`${b}.mobile`, 'Mobile', { span: 3, type: 'tel', req: true, digits: true, maxlength: 10 })}
          ${fld(`${b}.email`, 'Email', { span: 5, type: 'email', req: true })}
          ${fld(`${b}.telephone`, 'Telephone with STD', { span: 4 })}
          ${fld(`${b}.pan`, 'PAN', { span: 3, req: true, upper: true, maxlength: 10 })}
          ${fld(`${b}.aadhaar`, 'Aadhaar number', { span: 3, digits: true, maxlength: 12, help: 'Needed for Aadhaar authentication' })}
          ${isCo ? fld(`${b}.din`, p.constitution === 'llp' ? 'DPIN / DIN' : 'DIN', { span: 3, digits: true, maxlength: 8 }) : ''}
          ${fld(`${b}.citizen`, 'Citizen of India', { span: 3, type: 'seg', options: yesno })}
          <div class="sub-h"><span>Residential address</span><button class="link" data-act="copy-ppob" data-i="${i}">Copy business address</button></div>
          ${addressBlock(`${b}.address`)}
        </div></div>
      </div>`;
    }).join('');

    const docs = G.documents(p).map(d => `<li>${esc(d)}</li>`).join('');

    ed.innerHTML = `
      <div class="ed-head">
        <div>
          <h2>${esc(displayName(p))}</h2>
          <div class="sub"><span class="badge">${esc(C.label)}</span><span id="saved" class="saved">Saved</span></div>
        </div>
        <div class="ed-actions">
          <button data-act="duplicate">Duplicate</button>
          <button class="danger" data-act="delete">Delete</button>
        </div>
      </div>

      <details class="issues" id="issues" open></details>

      <section class="card"><header><h3><span class="step">1</span>Client</h3></header><div class="body"><div class="grid">
        ${fld('nickname', 'Short name for your list', { span: 6, placeholder: 'e.g. Sharma Traders – Pune' })}
        ${fld('constitution', 'Constitution of business', { span: 6, type: 'select', options: constOpts, req: true })}
        ${fld('status', 'This client is', { span: 6, type: 'seg', options: [['registered', 'Already registered (has GSTIN)'], ['new', 'Applying for new registration']] })}
      </div></div></section>

      <section class="card"><header><h3><span class="step">2</span>GST portal login &amp; Tally</h3><span class="hint">Used for downloading returns and Tally import</span></header><div class="body"><div class="grid">
        ${fld('gstin', 'GSTIN', { span: 4, upper: true, maxlength: 15, req: p.status === 'registered', placeholder: '27AABCS1234K1Z5' })}
        ${fld('portal.username', 'GST portal username', { span: 4, req: p.status === 'registered' })}
        <div class="f s4" data-wrap="portal.password"><label for="pw">GST portal password</label>
          <div class="pw-row"><input type="password" id="pw" autocomplete="new-password" placeholder="${p.portal.passwordEnc ? '•••••••• saved' : 'not saved'}">
          <button type="button" data-act="save-pw">Save</button>${p.portal.passwordEnc ? '<button type="button" data-act="show-pw" title="Show saved password">Show</button>' : ''}</div>
          <span class="msg"></span><span class="help">${p.portal.passwordEnc ? 'Stored encrypted with your master password' : 'Encrypted with your master password before saving'}</span></div>
        ${fld('tally.company', 'Company name in Tally', { span: 8, placeholder: 'Exactly as shown in TallyPrime', help: 'Used by “Tally & GST work”' })}
      </div></div></section>

      <details class="reg-wrap" ${p.status === 'new' ? 'open' : ''}><summary>Registration details${p.status === 'new' ? '' : ' (only needed for a new GST registration)'}</summary>

      <section class="card"><header><h3><span class="step">A</span>Part A – New registration</h3><span class="hint">OTPs go to this mobile and email</span></header><div class="body"><div class="grid">
        ${fld('partA.legalName', 'Legal name of business (exactly as per PAN)', { span: 8, req: true })}
        ${fld('partA.pan', 'PAN of business', { span: 4, req: true, upper: true, maxlength: 10, help: `4th letter should be ${C.panChar}` })}
        ${fld('partA.state', 'State / UT', { span: 4, type: 'select', options: G.STATES, req: true })}
        ${fld('partA.district', 'District', { span: 4, req: true })}
        ${fld('partA.mobile', 'Mobile of authorised signatory', { span: 4, type: 'tel', req: true, digits: true, maxlength: 10 })}
        ${fld('partA.email', 'Email of authorised signatory', { span: 6, type: 'email', req: true })}
      </div></div></section>

      <section class="card"><header><h3><span class="step">B</span>Business details</h3></header><div class="body"><div class="grid">
        ${fld('business.tradeName', 'Trade name', { span: 6 })}
        ${fld('business.reason', 'Reason to obtain registration', { span: 6, type: 'select', options: G.REASONS, req: true })}
        ${fld('business.commencementDate', 'Date of commencement of business', { span: 4, type: 'date', req: true })}
        ${fld('business.liabilityDate', 'Date liability to register arises', { span: 4, type: 'date', help: 'Leave blank to use commencement date' })}
        ${fld('business.composition', 'Opt for composition', { span: 2, type: 'seg', options: yesno })}
        ${fld('business.casual', 'Casual taxable person', { span: 2, type: 'seg', options: yesno })}
        ${C.idLabel ? fld('business.regNo', C.idLabel, { span: 6, upper: true, help: C.idHint || '' }) : ''}
        ${C.idLabel ? fld('business.regDate', p.constitution === 'partnership' ? 'Date of registration' : 'Date of incorporation', { span: 3, type: 'date' }) : ''}
        <div class="sub-h"><span>Jurisdiction (optional — pick on portal if unsure)</span></div>
        ${fld('business.stateWard', 'State: sector / circle / ward', { span: 6 })}
        ${fld('business.commissionerate', 'Centre: commissionerate', { span: 6 })}
        ${fld('business.division', 'Centre: division', { span: 6 })}
        ${fld('business.range', 'Centre: range', { span: 6 })}
      </div></div></section>

      <section class="card"><header><h3><span class="step">C</span>${esc(C.people)}</h3>
        <span class="hint">${C.min > 1 ? `At least ${C.min}. ` : ''}Mark one as authorised signatory.</span></header>
        <div class="body">${people}
          ${p.persons.length < C.max ? `<button data-act="add-person">+ Add ${esc(C.person.toLowerCase())}</button>` : ''}
        </div></section>

      <section class="card"><header><h3><span class="step">D</span>Principal place of business</h3>
        <button class="link" data-act="copy-sig-addr">Copy signatory’s residential address</button></header><div class="body"><div class="grid">
        ${addressBlock('ppob.address', { districtReq: true })}
        ${fld('ppob.latitude', 'Latitude', { span: 3, placeholder: 'optional' })}
        ${fld('ppob.longitude', 'Longitude', { span: 3, placeholder: 'optional' })}
        ${fld('ppob.officeEmail', 'Office email', { span: 6, type: 'email' })}
        ${fld('ppob.officeMobile', 'Office mobile', { span: 3, type: 'tel', digits: true, maxlength: 10 })}
        ${fld('ppob.officePhone', 'Office telephone with STD', { span: 3 })}
        ${fld('ppob.possession', 'Nature of possession of premises', { span: 6, type: 'select', options: G.POSSESSION, req: true })}
        <div class="f s12" data-wrap="ppob.activities"><span class="lbl req">Nature of business activity at this premises</span>
          <div class="checks">${G.ACTIVITIES.map(a => `<label><input type="checkbox" data-multi="ppob.activities" value="${esc(a)}"${p.ppob.activities.includes(a) ? ' checked' : ''}>${esc(a)}</label>`).join('')}</div>
          <span class="msg"></span></div>
      </div></div></section>

      <section class="card"><header><h3><span class="step">E</span>Goods and services</h3><span class="hint">Top 5 each</span></header><div class="body">
        <div class="codes">${p.goods.hsn.map((_, i) => fld(`goods.hsn.${i}`, `HSN ${i + 1}`, { digits: true, maxlength: 8, placeholder: i ? '' : 'e.g. 8471' })).join('')}</div>
        <div class="codes" style="margin-top:10px">${p.goods.sac.map((_, i) => fld(`goods.sac.${i}`, `SAC ${i + 1}`, { digits: true, maxlength: 6, placeholder: i ? '' : 'e.g. 998314' })).join('')}</div>
        <div class="f s12" data-wrap="goods"><span class="msg"></span></div>
      </div></section>

      <section class="card"><header><h3><span class="step">F</span>Other details</h3><span class="hint">Optional</span></header><div class="body"><div class="grid">
        ${fld('aadhaarAuth', 'Opt for Aadhaar authentication', { span: 4, type: 'seg', options: yesno, help: 'Usually Yes – avoids physical verification' })}
        <div class="sub-h"><span>Bank account</span></div>
        ${fld('bank.accountNo', 'Account number', { span: 4, digits: true })}
        ${fld('bank.ifsc', 'IFSC', { span: 4, upper: true, maxlength: 11 })}
        ${fld('bank.accountType', 'Account type', { span: 4, type: 'select', options: G.ACCOUNT_TYPES })}
        <div class="sub-h"><span>State specific information</span></div>
        ${fld('stateInfo.ptEC', 'Professional tax EC no.', { span: 3 })}
        ${fld('stateInfo.ptRC', 'Professional tax RC no.', { span: 3 })}
        ${fld('stateInfo.exciseLicense', 'State excise licence no.', { span: 3 })}
        ${fld('stateInfo.exciseHolder', 'Excise licence holder name', { span: 3 })}
        ${fld('notes', 'Your notes', { span: 12, type: 'textarea', placeholder: 'Anything to remember for this client' })}
      </div></div></section>

      <section class="card"><header><h3><span class="step">G</span>Documents to keep ready for upload</h3></header><div class="body">
        <ul class="docs">${docs}</ul>
        <p class="muted small" style="margin:10px 0 0">Uploads are always done by you on the portal – the extension never touches file fields.</p>
      </div></section></details>`;
    refreshValidation();
  }

  function refreshValidation() {
    const p = current();
    if (!p) return;
    const errs = G.validate(p);
    const docs = $('.docs');
    if (docs) docs.innerHTML = G.documents(p).map(d => `<li>${esc(d)}</li>`).join('');
    $$('[data-wrap]').forEach(w => { w.classList.remove('bad'); const m = $('.msg', w); if (m) { m.textContent = ''; m.className = 'msg'; } });
    for (const e of errs) {
      let w = $(`[data-wrap="${CSS.escape(e.path)}"]`);
      if (!w && e.path === 'goods') w = $('[data-wrap="goods"]');
      if (!w) continue;
      const m = $('.msg', w);
      // Empty required fields are listed in the summary only; inline red is for wrong values.
      if (m && !m.textContent && !/ is required$/.test(e.msg)) {
        m.textContent = e.msg.replace(/^[^:]+: /, '');
        if (e.level === 'warn') m.className = 'msg w'; else w.classList.add('bad');
      }
    }
    const box = $('#issues');
    const ne = errs.filter(e => e.level === 'error').length;
    const nw = errs.length - ne;
    if (!errs.length) {
      box.innerHTML = '<summary><span class="badge ok">Ready</span> Everything required is filled in.</summary>';
      box.open = false;
    } else {
      // One line per section so the list stays short
      const C = G.CONSTITUTIONS[p.constitution];
      const groupOf = (path) => {
        if (path.startsWith('partA')) return 'Part A';
        if (path.startsWith('business')) return 'Business details';
        const m = /^persons\.(\d+)/.exec(path);
        if (m) return `${C.person} ${+m[1] + 1}`;
        if (path === 'persons') return C.people;
        if (path.startsWith('ppob')) return 'Place of business';
        if (path.startsWith('goods')) return 'HSN / SAC';
        return 'Other';
      };
      const groups = new Map();
      for (const e of errs) {
        const g = groupOf(e.path);
        if (!groups.has(g)) groups.set(g, { path: e.path, level: 'warn', items: [] });
        const gr = groups.get(g);
        if (e.level === 'error') gr.level = 'error';
        gr.items.push(e.msg.replace(/^[^:]+: /, '').replace(/ is required$/, ''));
      }
      box.innerHTML = `<summary>${ne ? `<span class="badge err">${ne} to fix</span>` : ''}${nw ? `<span class="badge warn">${nw} to check</span>` : ''} Before you go to the portal</summary>
        <ul>${Array.from(groups).map(([g, gr]) => `<li class="${gr.level === 'error' ? 'e' : 'w'}"><button class="link" data-goto="${esc(gr.path)}"><b>${esc(g)}</b></button> – ${esc(gr.items.slice(0, 6).join(', '))}${gr.items.length > 6 ? ` and ${gr.items.length - 6} more` : ''}</li>`).join('')}</ul>`;
    }
  }

  /* ---------- actions ---------- */
  async function createProfile() {
    const p = G.newProfile('proprietorship');
    profiles.push(p);
    currentId = p.id;
    await store.save();
    store.saveSettings({ lastProfile: p.id });
    renderList();
    renderEditor();
    const n = $('#f_nickname');
    if (n) n.focus();
  }

  function adjustForConstitution(p, oldC) {
    const C = G.CONSTITUTIONS[p.constitution];
    while (p.persons.length < C.min) p.persons.push(G.newPerson());
    if (p.persons.length > C.max) p.persons = p.persons.slice(0, C.max);
    if (!p.persons.some(x => x.isSignatory)) p.persons[0].isSignatory = true;
    p.persons.forEach(x => { if (!C.designations.includes(x.designation)) x.designation = C.designations[0]; });
    if (!C.idLabel) { p.business.regNo = ''; p.business.regDate = ''; }
    else if (oldC && G.CONSTITUTIONS[oldC].idType !== C.idType) p.business.regNo = '';
  }

  document.addEventListener('click', async (ev) => {
    const open = ev.target.closest('[data-open]');
    if (open) {
      currentId = open.dataset.open;
      store.saveSettings({ lastProfile: currentId });
      renderList(); renderEditor();
      window.scrollTo({ top: 0 });
      return;
    }
    const go = ev.target.closest('[data-goto]');
    if (go) {
      const path = go.dataset.goto;
      const w = $(`[data-wrap="${CSS.escape(path)}"]`) || (path.startsWith('goods') && $('[data-wrap="goods"]')) ||
        (path.startsWith('persons') && $('[data-person]'));
      if (w) { w.scrollIntoView({ behavior: 'smooth', block: 'center' }); const i = $('input,select', w); if (i) setTimeout(() => i.focus({ preventScroll: true }), 300); }
      return;
    }
    const a = ev.target.closest('[data-act]');
    if (!a) return;
    const p = current();
    const act = a.dataset.act;
    if (act === 'new') return createProfile();
    if (!p) return;
    if (act === 'save-pw') {
      const val = $('#pw').value;
      if (!val) { toast('Type the password first'); return; }
      if (!(await App.ensureUnlocked())) return;
      p.portal.passwordEnc = await GSTVault.encrypt(val);
      queueSave(); renderEditor(); toast('Password saved (encrypted)');
      return;
    }
    if (act === 'show-pw') {
      if (!(await App.ensureUnlocked())) return;
      const pw = await GSTVault.decrypt(p.portal.passwordEnc);
      const i = $('#pw'); i.type = 'text'; i.value = pw;
      setTimeout(() => { if (i.isConnected) { i.value = ''; i.type = 'password'; } }, 8000);
      return;
    }
    if (act === 'add-person') {
      const x = G.newPerson();
      x.designation = G.CONSTITUTIONS[p.constitution].designations[0];
      p.persons.push(x); queueSave(); renderEditor();
      const last = $$('[data-person]').pop(); if (last) last.scrollIntoView({ behavior: 'smooth', block: 'start' });
    } else if (act === 'remove-person') {
      const i = +a.dataset.i;
      const x = p.persons[i];
      if (!confirm(`Remove ${G.fullName(x) || 'this person'}?`)) return;
      p.persons.splice(i, 1);
      if (!p.persons.some(y => y.isSignatory)) p.persons[0].isSignatory = true;
      queueSave(); renderEditor();
    } else if (act === 'signatory') {
      p.persons.forEach((x, i) => { x.isSignatory = i === +a.dataset.i; });
      queueSave(); refreshValidation();
    } else if (act === 'copy-ppob') {
      const i = +a.dataset.i;
      p.persons[i].address = { ...p.ppob.address };
      queueSave(); renderEditor(); toast('Business address copied');
    } else if (act === 'copy-sig-addr') {
      p.ppob.address = { ...G.signatory(p).address };
      queueSave(); renderEditor(); toast('Signatory address copied');
    } else if (act === 'duplicate') {
      const copy = JSON.parse(JSON.stringify(p));
      copy.id = G.uid(); copy.nickname = displayName(p) + ' (copy)';
      copy.persons.forEach(x => { x.id = G.uid(); });
      profiles.push(copy); currentId = copy.id;
      await store.save(); renderList(); renderEditor(); toast('Duplicated');
    } else if (act === 'delete') {
      if (!confirm(`Delete "${displayName(p)}"? This cannot be undone (export a backup first if unsure).`)) return;
      profiles = profiles.filter(x => x.id !== p.id);
      currentId = profiles[0] ? profiles[0].id : null;
      await store.save(); renderList(); renderEditor(); toast('Client deleted');
    }
  });

  function onEdit(ev) {
    const el = ev.target;
    const p = current();
    if (!p) return;
    if (el.dataset.multi) {
      const path = el.dataset.multi;
      const set = new Set(getPath(p, path));
      el.checked ? set.add(el.value) : set.delete(el.value);
      setPath(p, path, G.ACTIVITIES.filter(x => set.has(x)));
      queueSave(); refreshValidation();
      return;
    }
    const path = el.dataset.path;
    if (!path) return;
    let v = el.value;
    if (el.dataset.upper) { v = v.toUpperCase().replace(/\s+/g, ''); if (el.value !== v) el.value = v; }
    if (el.dataset.digits) { const d = v.replace(/\D/g, ''); if (d !== v) { v = d; el.value = d; } }
    if (path === 'status') {
      p.status = v; queueSave(); renderEditor(); renderList(); return;
    }
    if (path === 'constitution') {
      const old = p.constitution;
      p.constitution = v || 'proprietorship';
      adjustForConstitution(p, old);
      queueSave(); renderEditor(); renderList();
      return;
    }
    setPath(p, path, v);
    queueSave();
    clearTimeout(onEdit.vt);
    onEdit.vt = setTimeout(refreshValidation, el.tagName === 'INPUT' && /text|email|tel/.test(el.type) ? 450 : 0);
    {
      if (/Name$/.test(path) && path.startsWith('persons')) {
        const i = +path.split('.')[1];
        const h = $(`[data-person="${i}"] h4`);
        const C = G.CONSTITUTIONS[p.constitution];
        if (h) h.textContent = `${C.person} ${p.persons.length > 1 ? i + 1 : ''}${G.fullName(p.persons[i]) ? ' · ' + G.fullName(p.persons[i]) : ''}`;
      }
      if (/nickname|tradeName|legalName/.test(path)) { const h2 = $('.ed-head h2'); if (h2) h2.textContent = displayName(p); }
    }
  }
  document.addEventListener('input', onEdit);
  document.addEventListener('change', () => refreshValidation());

  $('#btn-new').addEventListener('click', createProfile);
  $('#search').addEventListener('input', renderList);

  /* ---------- backup ---------- */
  $('#btn-export').addEventListener('click', async () => {
    const r = await chrome.storage.local.get(K.mappings);
    const v = await chrome.storage.local.get(['gstf_vault', K.recipes]);
    const data = { app: 'gst-desk', version: 2, exported: new Date().toISOString(), profiles, mappings: r[K.mappings] || {}, recipes: v[K.recipes] || {}, vault: v.gstf_vault || null };
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `gst-clients-backup-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    toast(`Exported ${profiles.length} client${profiles.length === 1 ? '' : 's'}`);
  });
  $('#btn-import').addEventListener('click', () => $('#file-import').click());
  $('#file-import').addEventListener('change', async (ev) => {
    const file = ev.target.files[0];
    ev.target.value = '';
    if (!file) return;
    try {
      const data = JSON.parse(await file.text());
      let incoming = (Array.isArray(data) ? data : data.profiles || []).map(G.normalizeProfile);
      const lv = (await chrome.storage.local.get('gstf_vault')).gstf_vault;
      if (data.vault && !lv) await chrome.storage.local.set({ gstf_vault: data.vault });
      else if (data.vault && lv && lv.salt !== data.vault.salt) {
        incoming = incoming.map(p => ({ ...p, portal: { ...p.portal, passwordEnc: null } }));
        alert('This backup was made with a different master password, so its saved portal passwords were not imported. Re-enter them per client.');
      }
      if (data.recipes) await chrome.storage.local.set({ [K.recipes]: data.recipes });
      let added = 0, replaced = 0;
      for (const p of incoming) {
        const i = profiles.findIndex(x => x.id === p.id);
        if (i >= 0) { profiles[i] = p; replaced++; } else { profiles.push(p); added++; }
      }
      const r = await chrome.storage.local.get(K.mappings);
      const merged = r[K.mappings] || {};
      for (const [ctx, m] of Object.entries(data.mappings || {})) merged[ctx] = { ...(merged[ctx] || {}), ...m };
      await chrome.storage.local.set({ [K.profiles]: profiles, [K.mappings]: merged });
      if (!currentId && profiles[0]) currentId = profiles[0].id;
      renderList(); renderEditor();
      toast(`Imported: ${added} new, ${replaced} updated`);
    } catch (e) {
      alert('That file could not be read as a backup: ' + e.message);
    }
  });

  /* ---------- shared helpers for the other tabs ---------- */
  async function vaultButton() {
    const st = await GSTVault.state();
    const b = $('#btn-vault');
    b.textContent = st === 'unlocked' ? '🔓 Passwords unlocked' : st === 'locked' ? '🔒 Unlock passwords' : '🔑 Set master password';
    b.classList.toggle('on', st === 'unlocked');
  }
  function vaultDialog(mode) {
    return new Promise((resolve) => {
      const dlg = $('#vault-dlg');
      $('#vault-title').textContent = mode === 'create' ? 'Create a master password' : 'Unlock saved passwords';
      $('#vault-text').textContent = mode === 'create'
        ? 'Client portal passwords are encrypted with this. You will type it once each time Chrome starts. It cannot be recovered – keep it safe.'
        : 'Type your master password. Passwords stay unlocked until you close Chrome.';
      $('#vault-pw2-wrap').hidden = mode !== 'create';
      $('#vault-ok').textContent = mode === 'create' ? 'Create' : 'Unlock';
      $('#vault-err').textContent = '';
      $('#vault-pw').value = ''; $('#vault-pw2').value = '';
      const done = (ok) => { dlg.close(); $('#vault-form').onsubmit = null; $('#vault-cancel').onclick = null; resolve(ok); };
      $('#vault-cancel').onclick = () => done(false);
      $('#vault-form').onsubmit = async (e) => {
        e.preventDefault();
        const a = $('#vault-pw').value;
        try {
          if (mode === 'create') {
            if (a !== $('#vault-pw2').value) throw new Error('The two passwords do not match');
            await GSTVault.create(a);
          } else await GSTVault.unlock(a);
          await vaultButton();
          done(true);
        } catch (err) { $('#vault-err').textContent = err.message; }
      };
      dlg.showModal();
      $('#vault-pw').focus();
    });
  }
  const App = window.GSTApp = {
    get profiles() { return profiles; },
    toast, esc,
    async ensureUnlocked() {
      const st = await GSTVault.state();
      if (st === 'unlocked') return true;
      return vaultDialog(st === 'none' ? 'create' : 'unlock');
    },
    async saveProfiles() { await store.save(); renderList(); },
    openClient(id) { currentId = id; showView('clients'); renderList(); renderEditor(); }
  };
  $('#btn-vault').addEventListener('click', async () => {
    const st = await GSTVault.state();
    if (st === 'unlocked') { if (confirm('Lock saved passwords now?')) { await GSTVault.lock(); await vaultButton(); toast('Passwords locked'); } }
    else await vaultDialog(st === 'none' ? 'create' : 'unlock');
  });

  function showView(v) {
    $$('.tabs [role=tab]').forEach(t => t.setAttribute('aria-selected', String(t.dataset.view === v)));
    $$('.view').forEach(s => { s.hidden = s.id !== 'view-' + v; });
    if (location.hash !== '#' + v) history.replaceState(null, '', '#' + v);
    document.dispatchEvent(new CustomEvent('gstf-view', { detail: v }));
  }
  $$('.tabs [role=tab]').forEach(t => t.addEventListener('click', () => showView(t.dataset.view)));
  chrome.storage.onChanged.addListener((ch, area) => {
    if (area === 'local' && ch[K.profiles] && !saveTimer) { /* changed elsewhere */ }
  });

  (async function init() {
    await store.load();
    renderList();
    renderEditor();
    vaultButton();
    const v = (location.hash || '').slice(1);
    showView(['downloads', 'work'].includes(v) ? v : 'clients');
  })();
})();
