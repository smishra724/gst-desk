/* Turns what GST Desk read from a client's pages on the GST portal into client-master fields.
   Input: { pairs: [{section, label, value}], tables: [{section, headers, rows}], gstin }
   Output: { suggestions: [{path, label, value}], persons: [...], info: {...} } */
(function (root) {
  'use strict';
  const G = root.GSTR, D = root.GSTDocs;
  const n = (s) => String(s || '').replace(/\s+/g, ' ').trim();
  const lc = (s) => n(s).toLowerCase();
  const isPpob = (sec) => /principal place|place of business|business address|address of principal/i.test(sec || '');
  const isPeople = (sec) => /promoter|partner|director|proprietor|karta|member|trustee|coparcener/i.test(sec || '');
  const isSign = (sec) => /authori[sz]ed signator/i.test(sec || '');
  const masked = (v) => /[*xX]{3,}|•{3,}/.test(v);
  const toIso = (v) => {
    let m = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/.exec(n(v)); if (m) return `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
    m = /^(\d{4})-(\d{2})-(\d{2})/.exec(n(v)); if (m) return m[0].slice(0, 10);
    m = /^(\d{1,2})[\s-]([A-Za-z]{3})[a-z]*[\s-,]+(\d{4})$/.exec(n(v));
    if (m) { const i = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'].indexOf(m[2].toLowerCase()); if (i >= 0) return `${m[3]}-${String(i + 1).padStart(2, '0')}-${m[1].padStart(2, '0')}`; }
    return '';
  };
  const CONST = [
    [/limited liability partnership|\bllp\b/i, 'llp'], [/public limited/i, 'public_company'], [/private limited|pvt\.? ltd/i, 'pvt_company'],
    [/partnership/i, 'partnership'], [/proprietor/i, 'proprietorship']
  ];

  // label → field (business level). First match wins.
  const RULES = [
    [/^gstin|gstin\s*\/\s*uin|^registration number/i, 'gstin'],
    [/legal name/i, 'partA.legalName'],
    [/trade name/i, 'business.tradeName'],
    [/constitution/i, 'constitution'],
    [/date of (registration|liability)|effective date of registration|registration date/i, 'reg.date'],
    [/gstin\s*\/\s*uin status|^status$|taxpayer status|gstin status/i, 'reg.status'],
    [/taxpayer type|type of taxpayer|registration type/i, 'reg.type'],
    [/nature of core business/i, 'reg.core'],
    [/date of commencement/i, 'business.commencementDate'],
    [/\bcin\b|corporate identity|llpin|registration (no|number) (under|of)/i, 'business.regNo'],
    [/date of incorporation/i, 'business.regDate'],
    [/composition/i, 'business.composition'],
    [/sector|circle|ward|charge|unit|state jurisdiction|administrative office/i, 'business.stateWard'],
    [/commissionerate|centre jurisdiction|center jurisdiction|other office/i, 'business.commissionerate'],
    [/^division$|centre.*division/i, 'business.division'],
    [/^range$|centre.*range/i, 'business.range'],
    [/account number|bank account no/i, 'bank.accountNo'],
    [/\bifsc\b/i, 'bank.ifsc'],
    [/type of account|account type/i, 'bank.accountType'],
    [/e-?mail/i, 'partA.email'],
    [/mobile/i, 'partA.mobile'],
    [/professional tax.*(ec|enrol)/i, 'stateInfo.ptEC'],
    [/professional tax.*(rc|registration)/i, 'stateInfo.ptRC']
  ];
  const ADDR = [
    [/possession/i, 'possession'],
    [/building no|flat no|door no|house no/i, 'building'], [/floor/i, 'floor'], [/premises|name of (the )?building/i, 'premises'],
    [/road|street/i, 'road'], [/locality/i, 'locality'], [/city|town|village/i, 'city'], [/district/i, 'district'],
    [/^state$|state name/i, 'state'], [/pin ?code|pincode/i, 'pin'], [/landmark/i, 'landmark'], [/latitude/i, 'latitude'], [/longitude/i, 'longitude']
  ];

  function personFromCells(get) {
    const full = n(get(/^name$|full name|name of (the )?(partner|director|promoter|proprietor|person)|^partner name|^director name/i));
    const x = { firstName: n(get(/first name/i)), middleName: n(get(/middle name/i)), lastName: n(get(/last name|surname/i)),
      designation: n(get(/designation|status|role/i)), din: n(get(/\bdin\b|dpin|director identification/i)).replace(/\D/g, ''),
      pan: n(get(/\bpan\b|permanent account/i)).toUpperCase(), fatherFirst: '', fatherLast: '', fatherMiddle: '',
      mobile: n(get(/mobile/i)).replace(/\D/g, ''), email: n(get(/e-?mail/i)), dob: toIso(get(/date of birth|\bdob\b/i)), gender: n(get(/gender/i)) };
    if (!x.firstName && full) { const s = D.splitName(full.toUpperCase()); x.firstName = s.first; x.middleName = s.middle; x.lastName = s.last; }
    const fa = n(get(/father/i));
    if (fa) { const s = D.splitName(fa.toUpperCase()); x.fatherFirst = s.first; x.fatherMiddle = s.middle; x.fatherLast = s.last; }
    if (masked(x.mobile)) x.mobile = ''; if (masked(x.email)) x.email = ''; if (masked(x.pan) || !/^[A-Z]{5}\d{4}[A-Z]$/.test(x.pan)) x.pan = '';
    if (!/^\d{10}$/.test(x.mobile)) x.mobile = '';
    if (/^(male|female|others?)$/i.test(x.gender)) x.gender = x.gender[0].toUpperCase() + x.gender.slice(1).toLowerCase().replace(/^other$/, 'Others'); else x.gender = '';
    return x.firstName ? x : null;
  }

  function mapImport(data, p) {
    const out = new Map();
    const info = {};
    const put = (path, label, value) => { value = n(value); if (!value || masked(value) || out.has(path)) return; out.set(path, { path, label, value }); };
    const pairs = (data.pairs || []).filter(x => n(x.value) && n(x.value).length < 400);

    // --- business-level fields ---
    for (const { section, label, value } of pairs) {
      if (isPeople(section) || isSign(section)) continue;
      if (label === '(ticked)') { if (isPpob(section) || /business activit/i.test(section)) info.activities = (info.activities || '') + ',' + value; continue; }
      if (isPpob(section)) {
        const r = ADDR.find(([rx]) => rx.test(label));
        if (r) {
          if (r[1] === 'possession') { const pos = G.POSSESSION.find(o => lc(value).startsWith(o.toLowerCase())); if (pos) put('ppob.possession', 'Nature of possession', pos); }
          else if (r[1] === 'state') { const st = G.STATES.find(sx => sx.toLowerCase() === lc(value)); if (st) put('ppob.address.state', 'Business state', st); }
          else put(r[1] === 'latitude' || r[1] === 'longitude' ? `ppob.${r[1]}` : `ppob.address.${r[1]}`, 'Business ' + r[1], r[1] === 'pin' ? value.replace(/\D/g, '') : value);
          continue;
        }
        if (/^address$|address of principal|principal place of business/i.test(label) && /\d{6}/.test(value)) { info.ppobLine = value; continue; }
        if (/e-?mail/i.test(label)) { put('ppob.officeEmail', 'Office email', value); continue; }
        if (/mobile/i.test(label)) { put('ppob.officeMobile', 'Office mobile', value.replace(/\D/g, '')); continue; }
        if (/nature of business|business activit/i.test(label)) { info.activities = (info.activities || '') + ',' + value; continue; }
      }
      if (/principal place of business|address of principal place/i.test(label) && /\d{6}/.test(value)) { info.ppobLine = info.ppobLine || value; continue; }
      if (/nature of business activit/i.test(label)) { info.activities = (info.activities || '') + ',' + value; continue; }
      if (/jurisdiction|administrative office|other office/i.test(label) && /(commissionerate|division|range|ward|circle|charge|sector|unit)\s*[-:]/i.test(value)) {
        const centre = /cent(er|re)|other office/i.test(label + ' ' + value.slice(0, 30)) && !/state/i.test(label);
        for (const m of value.matchAll(/(commissionerate|division|range|ward|circle|charge|sector|unit)\s*[-:]\s*([^,;\n]+?)(?=\s*(,|;|$|\b(commissionerate|division|range|ward|circle|charge|sector|unit)\s*[-:]))/gi)) {
          const k = m[1].toLowerCase(), v = n(m[2]);
          if (k === 'commissionerate') put('business.commissionerate', 'Centre: commissionerate', v);
          else if (k === 'range' && centre) put('business.range', 'Centre: range', v);
          else if (k === 'division' && centre) put('business.division', 'Centre: division', v);
          else if (!centre && /ward|circle|charge|sector|unit/.test(k)) put('business.stateWard', 'State jurisdiction', v);
        }
        continue;
      }
      const r = RULES.find(([rx]) => rx.test(label));
      if (!r) continue;
      const [, path] = r;
      if (path === 'constitution') { const c = CONST.find(([rx]) => rx.test(value)); if (c) put('constitution', 'Constitution of business', c[1]); info.constitution = value; continue; }
      if (path.startsWith('reg.')) { info[path.slice(4)] = value; continue; }
      if (path === 'gstin') { const g = value.toUpperCase().replace(/\s/g, ''); if (/^\d{2}[A-Z]{5}\d{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/.test(g)) put('gstin', 'GSTIN', g); continue; }
      if (/Date$/.test(path)) { const d = toIso(value); if (d) put(path, label, d); continue; }
      if (path === 'business.composition') { put(path, label, /yes|opted|composition taxpayer/i.test(value) && !/^no/i.test(value) ? 'yes' : 'no'); continue; }
      if (path === 'bank.accountType') { const t = G.ACCOUNT_TYPES.find(o => lc(value).startsWith(o.toLowerCase())); if (t) put(path, label, t); continue; }
      if (path === 'partA.mobile') { const m = value.replace(/\D/g, '').slice(-10); if (/^[6-9]\d{9}$/.test(m)) put(path, 'Mobile', m); continue; }
      if (path === 'bank.ifsc') { const f = value.toUpperCase().replace(/\s/g, ''); if (/^[A-Z]{4}0[A-Z0-9]{6}$/.test(f)) put(path, 'IFSC', f); continue; }
      if (path === 'bank.accountNo') { const a = value.replace(/\s/g, ''); if (/^\d{6,20}$/.test(a)) put(path, 'Account number', a); continue; }
      put(path, label, value);
    }

    // GSTIN gives PAN and state
    const gstin = (out.get('gstin') || {}).value || data.gstin || p.gstin;
    if (gstin && /^\d{2}[A-Z]{5}\d{4}/.test(gstin)) {
      put('partA.pan', 'PAN (from GSTIN)', gstin.slice(2, 12));
      const st = G.stateName(gstin.slice(0, 2)); if (st) put('partA.state', 'State (from GSTIN)', st);
    }
    // One-line address of the principal place of business
    if (info.ppobLine && !out.has('ppob.address.pin')) {
      const a = D.parseAddress(info.ppobLine);
      if (a) for (const k of ['building', 'floor', 'premises', 'road', 'locality', 'city', 'district', 'state', 'pin', 'landmark']) if (a[k]) put(`ppob.address.${k}`, 'Business ' + k, a[k]);
    }
    if (out.has('ppob.address.district') && !out.has('partA.district')) put('partA.district', 'District', out.get('ppob.address.district').value);
    // Business activities (comma or line separated)
    if (info.activities) {
      const ACT_RX = [/bonded/i, /\beou\b|\bstp\b|ehtp/i, /export/i, /factory|manufactur/i, /import/i, /supplier of services/i, /leasing/i,
        /office|sale office/i, /recipient/i, /retail/i, /warehouse|depot/i, /wholesale/i, /works contract/i, /input service distributor|\bisd\b/i, /^others?$/i];
      const parts = info.activities.split(/[,;\n]+/).map(n).filter(Boolean);
      const acts = G.ACTIVITIES.filter((a, i) => parts.some(x => i === 4 ? /^import/i.test(x) : i === 2 ? /^export/i.test(x) : i === 0 ? ACT_RX[0].test(x) : i === 10 ? /warehouse|depot/i.test(x) && !/bonded/i.test(x) : ACT_RX[i].test(x)));
      if (acts.length) out.set('ppob.activities', { path: 'ppob.activities', label: 'Business activities', value: acts.join(', '), list: acts });
    }
    // HSN / SAC from tables or values
    const codes = new Set();
    for (const t of data.tables || []) {
      const ci = t.headers.findIndex(h => /hsn|sac|code/i.test(h));
      if (ci >= 0 && /goods|service|hsn|sac|commodit/i.test(t.section + ' ' + t.headers.join(' '))) for (const r of t.rows) { const c = n(r[ci]).replace(/\D/g, ''); if (/^\d{4,8}$/.test(c)) codes.add(c); }
    }
    for (const { label, value } of pairs) if (/^hsn|^sac|hsn code|sac code/i.test(label)) for (const c of n(value).match(/\b\d{4,8}\b/g) || []) codes.add(c);
    const hsn = [...codes].filter(c => !c.startsWith('99')).slice(0, 5), sac = [...codes].filter(c => c.startsWith('99')).slice(0, 5);
    hsn.forEach((c, i) => put(`goods.hsn.${i}`, `HSN ${i + 1}`, c));
    sac.forEach((c, i) => put(`goods.sac.${i}`, `SAC ${i + 1}`, c));

    // --- promoters / partners / directors ---
    const persons = [];
    const seen = new Set();
    const addPerson = (x, sign) => {
      if (!x) return;
      const key = [x.firstName, x.lastName].join(' ').toUpperCase();
      const ex = persons.find(y => [y.firstName, y.lastName].join(' ').toUpperCase() === key);
      if (ex) { for (const k of Object.keys(x)) if (x[k] && !ex[k]) ex[k] = x[k]; if (sign) ex.isSignatory = true; return; }
      if (seen.has(key)) return; seen.add(key);
      persons.push({ ...x, isSignatory: !!sign });
    };
    for (const t of data.tables || []) {
      const ctx = t.section + ' ' + t.headers.join(' ');
      if (!(isPeople(ctx) || isSign(ctx)) || !t.headers.some(h => /name/i.test(h))) continue;
      for (const r of t.rows) {
        const get = (rx) => { const i = t.headers.findIndex(h => rx.test(h)); return i >= 0 ? r[i] : ''; };
        addPerson(personFromCells(get), isSign(ctx));
      }
    }
    // people shown as label/value blocks: a new person starts when "First Name"/"Name" repeats
    const groups = [];
    for (const pr of pairs) {
      if (!(isPeople(pr.section) || isSign(pr.section))) continue;
      const starts = /^(first name|name|name of (the )?(partner|director|promoter|proprietor|person))$/i.test(n(pr.label));
      const last = groups[groups.length - 1];
      if (!last || last[0].section !== pr.section || (starts && last.some(q => /^(first name|name|name of)/i.test(n(q.label))))) groups.push([]);
      groups[groups.length - 1].push(pr);
    }
    for (const g of groups) {
      const get = (rx) => { const q = g.find(x => rx.test(n(x.label))); return q ? q.value : ''; };
      addPerson(personFromCells(get), isSign(g[0].section));
      const x = persons[persons.length - 1];
      if (x && !x.address) {
        const a = {}; for (const [rx, k] of ADDR) { if (k === 'possession' || k === 'latitude' || k === 'longitude') continue; const v = get(rx); if (v) a[k] = k === 'pin' ? v.replace(/\D/g, '') : v; }
        if (a.state) a.state = G.STATES.find(sx => sx.toLowerCase() === lc(a.state)) || '';
        if (Object.keys(a).length >= 2) x.address = a;
      }
    }
    if (persons.length && !persons.some(x => x.isSignatory)) persons[0].isSignatory = true;

    // Compare with what the client already has
    const get = (path) => path.split('.').reduce((o, k) => (o == null ? o : o[k]), p);
    const suggestions = Array.from(out.values()).map(s => {
      const cur = s.path === 'ppob.activities' ? (p.ppob.activities || []).join(', ') : get(s.path);
      return { ...s, current: cur && String(cur) !== s.value ? String(cur) : '', same: String(cur || '') === s.value };
    }).filter(s => !s.same);
    return { suggestions, persons, info };
  }

  root.GSTImport = { mapImport };
})(typeof window !== 'undefined' ? window : globalThis);
