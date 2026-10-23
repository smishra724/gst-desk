/* Client documents: which ones a client needs, local storage, size fixes,
   reading details out of PDFs, and matching them to portal upload fields. */
(function (root) {
  'use strict';
  const G = root.GSTR;

  const ADDRESS_TYPES = ['Electricity Bill', 'Property Tax Receipt', 'Municipal Khata Copy', 'Legal Ownership Document', 'Rent / Lease Agreement', 'Consent Letter', 'Others'];
  const LIMIT = { photo: 100 * 1024, doc: 1024 * 1024 };

  // Every slot: key, label, hint, kind (photo|doc), who ('entity' or person id), read (what to look for)
  function slots(p) {
    const C = G.CONSTITUTIONS[p.constitution];
    const out = [];
    if (p.constitution !== 'proprietorship') out.push({ key: 'entity:pan', label: `PAN card of the ${C.label.toLowerCase()}`, short: 'PAN card', kind: 'doc', who: 'entity', read: 'entityPan' });
    if (p.constitution === 'partnership') out.push({ key: 'entity:constitution', label: 'Partnership deed', short: 'Partnership deed', kind: 'doc', who: 'entity', read: 'deed' });
    if (p.constitution === 'llp') out.push({ key: 'entity:constitution', label: 'LLP certificate of incorporation', short: 'LLP certificate', kind: 'doc', who: 'entity', read: 'coi' });
    if (p.constitution.endsWith('company')) out.push({ key: 'entity:constitution', label: 'Certificate of incorporation (MCA)', short: 'Incorporation certificate', kind: 'doc', who: 'entity', read: 'coi' });
    out.push({ key: 'entity:address', label: 'Proof of principal place of business', short: 'Address proof', kind: 'doc', who: 'entity', read: 'address', subtypes: ADDRESS_TYPES });
    out.push({ key: 'entity:rent', label: 'Rent / lease agreement', short: 'Rent / lease agreement', kind: 'doc', who: 'entity', read: 'rent', optional: !['Rented', 'Leased'].includes(p.ppob.possession) });
    out.push({ key: 'entity:consent', label: 'Consent letter / NOC from owner', short: 'Consent letter / NOC', kind: 'doc', who: 'entity', read: 'rent', optional: !['Consent', 'Shared'].includes(p.ppob.possession) });
    if (p.constitution !== 'proprietorship') out.push({ key: 'entity:authorisation', label: p.constitution.endsWith('company') ? 'Board resolution for authorised signatory' : 'Letter of authorisation for signatory', short: p.constitution.endsWith('company') ? 'Board resolution' : 'Authorisation letter', kind: 'doc', who: 'entity' });
    out.push({ key: 'entity:bank', label: 'Bank proof (cancelled cheque / passbook / statement)', short: 'Bank proof', kind: 'doc', who: 'entity', read: 'bank', optional: true });
    p.persons.forEach((x, i) => {
      const nm = G.fullName(x) || `${C.person} ${i + 1}`;
      out.push({ key: `person:${x.id}:photo`, label: `Photograph – ${nm}`, short: 'Photo', kind: 'photo', who: x.id, personIndex: i });
      out.push({ key: `person:${x.id}:pan`, label: `PAN card – ${nm}`, short: 'PAN card', kind: 'doc', who: x.id, personIndex: i, read: 'personPan', optional: true });
      out.push({ key: `person:${x.id}:aadhaar`, label: `Aadhaar – ${nm}`, short: 'Aadhaar', kind: 'doc', who: x.id, personIndex: i, read: 'aadhaar', optional: true });
    });
    return out;
  }

  const KEY = (clientId) => `gstf_docs_${clientId}`;
  const Store = {
    async all(clientId) { return (await chrome.storage.local.get(KEY(clientId)))[KEY(clientId)] || {}; },
    async put(clientId, slotKey, doc) { const a = await this.all(clientId); a[slotKey] = doc; await chrome.storage.local.set({ [KEY(clientId)]: a }); },
    async patch(clientId, slotKey, patch) { const a = await this.all(clientId); if (a[slotKey]) { Object.assign(a[slotKey], patch); await chrome.storage.local.set({ [KEY(clientId)]: a }); } },
    async remove(clientId, slotKey) { const a = await this.all(clientId); delete a[slotKey]; await chrome.storage.local.set({ [KEY(clientId)]: a }); },
    async drop(clientId) { await chrome.storage.local.remove(KEY(clientId)); },
    key: KEY
  };

  /* ---------- files ---------- */
  const readAsDataURL = (blob) => new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = () => rej(r.error); r.readAsDataURL(blob); });
  function dataURLtoBlob(u) {
    const [head, b64] = u.split(',');
    const mime = (/data:([^;]+)/.exec(head) || [])[1] || 'application/octet-stream';
    const bin = atob(b64), arr = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
    return new Blob([arr], { type: mime });
  }
  const toFile = (doc) => new File([dataURLtoBlob(doc.dataUrl)], doc.name, { type: doc.type });

  // Photos → JPEG ≤ 100 KB; other images → JPEG ≤ 1 MB. PDFs are kept as they are.
  async function prepare(file, kind) {
    const limit = LIMIT[kind] || LIMIT.doc;
    const isImg = /^image\//.test(file.type);
    const isPdf = file.type === 'application/pdf' || /\.pdf$/i.test(file.name);
    const notes = [];
    if (kind === 'photo' && !isImg) throw new Error('The photograph must be an image (JPEG or PNG)');
    if (!isImg && !isPdf) throw new Error('Use a PDF or an image (JPEG/PNG)');
    if (isPdf) {
      if (file.size > limit) notes.push(`PDF is ${(file.size / 1048576).toFixed(2)} MB – the portal allows 1 MB. Compress it before uploading.`);
      return { blob: file, name: file.name, type: 'application/pdf', notes };
    }
    if (isImg && file.type === 'image/jpeg' && file.size <= limit) return { blob: file, name: file.name, type: 'image/jpeg', notes };
    const bmp = await createImageBitmap(file);
    let maxSide = kind === 'photo' ? 600 : 2200;
    let q = 0.9, blob = null;
    for (let tries = 0; tries < 14; tries++) {
      const scale = Math.min(1, maxSide / Math.max(bmp.width, bmp.height));
      const w = Math.round(bmp.width * scale), h = Math.round(bmp.height * scale);
      const cv = new OffscreenCanvas(w, h);
      const ctx = cv.getContext('2d');
      ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, w, h);
      ctx.drawImage(bmp, 0, 0, w, h);
      blob = await cv.convertToBlob({ type: 'image/jpeg', quality: q });
      if (blob.size <= limit) break;
      if (q > 0.55) q -= 0.1; else maxSide = Math.round(maxSide * 0.8);
    }
    if (blob.size > limit) notes.push('Could not bring the image under the size limit – use a smaller image.');
    else if (blob.size < file.size || file.type !== 'image/jpeg') notes.push(`Resized to ${Math.round(blob.size / 1024)} KB JPEG for the portal`);
    return { blob, name: file.name.replace(/\.[^.]+$/, '') + '.jpg', type: 'image/jpeg', notes };
  }

  /* ---------- reading details ---------- */
  const PAN_RX = /\b([A-Z]{5}[0-9]{4}[A-Z])\b/g;
  // OCR often confuses O/0, I/1, S/5, B/8, Z/2 – repair 10-character tokens into PAN shape
  function fixPans(text) {
    const L2D = { O: '0', D: '0', Q: '0', I: '1', L: '1', Z: '2', S: '5', B: '8', G: '6' }, D2L = { 0: 'O', 1: 'I', 2: 'Z', 5: 'S', 8: 'B', 6: 'G' };
    const out = [];
    for (const m of String(text).toUpperCase().matchAll(/\b[A-Z0-9]{10}\b/g)) {
      const t = m[0].split('');
      for (let i = 0; i < 5; i++) if (D2L[t[i]]) t[i] = D2L[t[i]];
      for (let i = 5; i < 9; i++) if (L2D[t[i]]) t[i] = L2D[t[i]];
      if (D2L[t[9]]) t[9] = D2L[t[9]];
      const v = t.join('');
      if (/^[A-Z]{5}\d{4}[A-Z]$/.test(v) && /[PCFHATBLJG]/.test(v[3])) out.push(v);
    }
    return Array.from(new Set(out));
  }
  const NOISE = /\b(income|tax|department|govt|government|india|permanent|account|number|card|signature|unique|identification|authority|enrolment|aadhaar|male|female|dob|birth|year|address|vid|issue|date|help|www|uidai)\b/i;
  const nameLines = (ls) => ls.map(x => x.replace(/[^A-Za-z .']/g, ' ').replace(/\s+/g, ' ').trim())
    .filter(x => /^[A-Za-z][A-Za-z .']{3,40}$/.test(x) && x.split(' ').filter(w => w.length > 1).length >= 2 && !NOISE.test(x));
  const ORD = ['first', 'second', 'third', 'fourth', 'fifth', 'sixth', 'seventh', 'eighth', 'ninth', 'tenth', 'eleventh', 'twelfth', 'thirteenth', 'fourteenth', 'fifteenth', 'sixteenth', 'seventeenth', 'eighteenth', 'nineteenth', 'twentieth'];
  const NUMW = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19, twenty: 20, thirty: 30, forty: 40, fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90 };
  const MONTHS = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];
  const pad = (n) => String(n).padStart(2, '0');
  function dayWord(w) {
    w = w.toLowerCase().replace(/\s+/g, '-');
    let i = ORD.indexOf(w); if (i >= 0) return i + 1;
    const m = /^(twenty|thirty)-(\w+)$/.exec(w);
    if (m) { i = ORD.indexOf(m[2]); if (i >= 0 && i < 9) return (m[1] === 'twenty' ? 20 : 30) + i + 1; }
    if (w === 'thirtieth') return 30;
    return 0;
  }
  function yearWords(s) {
    const t = s.toLowerCase().replace(/-/g, ' ').match(/two thousand(?:\s+and)?\s*((?:\w+\s*){0,2})/);
    if (!t) return 0;
    let n = 0;
    for (const w of (t[1] || '').trim().split(/\s+/)) if (NUMW[w] !== undefined) n += NUMW[w];
    return 2000 + n;
  }
  function findDate(text, near) {
    const scope = near ? (() => { const i = text.search(near); return i >= 0 ? text.slice(i, i + 220) : text; })() : text;
    let m = /\b(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})\b/.exec(scope);
    if (m) return `${m[3]}-${pad(m[2])}-${pad(m[1])}`;
    m = /\b(\d{1,2})(?:st|nd|rd|th)?\s+(january|february|march|april|may|june|july|august|september|october|november|december),?\s+(\d{4})/i.exec(scope);
    if (m) return `${m[3]}-${pad(MONTHS.indexOf(m[2].toLowerCase()) + 1)}-${pad(m[1])}`;
    m = /\b([a-z-]+(?:[\s-][a-z]+)?)\s+day\s+of\s+(january|february|march|april|may|june|july|august|september|october|november|december)[,\s]+(two thousand[\w\s-]*?|\d{4})(?:\s+under|\.|,|\n)/i.exec(scope.replace(/\n/g, ' '));
    if (m) {
      const words = m[1].split(/\s+/);
      const d = dayWord(words.slice(-2).join('-')) || dayWord(words[words.length - 1]);
      const y = /^\d{4}$/.test(m[3]) ? +m[3] : yearWords(m[3]);
      if (d && y) return `${y}-${pad(MONTHS.indexOf(m[2].toLowerCase()) + 1)}-${pad(d)}`;
    }
    return '';
  }
  const lines = (t) => t.split(/\n/).map(x => x.trim()).filter(Boolean);
  const valueAfter = (ls, labelRx, notRx) => {
    for (let i = 0; i < ls.length; i++) {
      if (labelRx.test(ls[i]) && !(notRx && notRx.test(ls[i]))) {
        const same = ls[i].replace(labelRx, '').replace(/^[\s:/\-–]+/, '').replace(/[^\x20-\x7E]+/g, '').trim();
        if (same && /[A-Za-z]{2}/.test(same) && same.length > 2 && !/^name$/i.test(same)) return same;
        for (let k = i + 1; k < Math.min(i + 3, ls.length); k++) if (/^[A-Z][A-Z .']{2,}$/.test(ls[k])) return ls[k];
      }
    }
    return '';
  };
  const splitName = (n) => {
    const w = n.replace(/\s+/g, ' ').trim().split(' ');
    if (w.length === 1) return { first: w[0], middle: '', last: '' };
    if (w.length === 2) return { first: w[0], middle: '', last: w[1] };
    return { first: w[0], middle: w.slice(1, -1).join(' '), last: w[w.length - 1] };
  };
  function pinState(text) {
    const pins = Array.from(text.matchAll(/(?:^|[^\d])([1-9]\d{2}\s?\d{3})(?!\d)/g)).map(m => m[1].replace(/\s/, ''));
    const pin = pins.length ? pins[pins.length - 1] : '';
    const state = G.STATES.find(s => new RegExp(`\\b${s.replace(/ /g, '\\s+')}\\b`, 'i').test(text)) || '';
    return { pin, state };
  }
  function addressParts(addrLine) {
    let parts = addrLine.split(/,\s*/).map(x => x.trim()).filter(Boolean)
      .filter(x => !/^india$/i.test(x) && !/^\d{6}$/.test(x) && !/^(pin|pincode)/i.test(x));
    const isState = (x) => G.STATES.some(st => st.toLowerCase() === x.toLowerCase().replace(/\s*-\s*\d{6}$/, ''));
    const si = parts.findIndex(isState);
    if (si >= 0) parts = parts.slice(0, si);
    const r = { building: '', floor: '', premises: '', road: '', locality: '', city: '' };
    if (!parts.length) return r;
    r.city = parts.pop();
    const take = (rx) => { const i = parts.findIndex(x => rx.test(x)); return i >= 0 ? parts.splice(i, 1)[0] : ''; };
    r.floor = take(/\bfloor\b|\bflr\b/i).replace(/\s*floor\b/i, '').trim() || '';
    r.premises = take(/complex|tower|building|bldg|apartment|apts?\b|heights|plaza|chambers|bhavan|bhawan|society|residency|arcade|mall|centre|center|house\b|niwas|sadan/i);
    r.road = take(/\broad\b|\brd\b|marg\b|street|\bst\b|lane|path\b|highway|chowk/i);
    r.building = parts.length ? parts.shift() : '';
    r.locality = parts.join(', ');
    return r;
  }
    // Returns [{path, label, value, checked}] relative to the profile.
  function suggest(text, slot, p) {
    const T = text.replace(/\r/g, '');
    const L = lines(T);
    const out = [];
    const add = (path, label, value, checked = true) => { if (value) out.push({ path, label, value: String(value).trim(), checked }); };
    const pans = Array.from(new Set(Array.from(T.matchAll(PAN_RX)).map(m => m[1]).concat(fixPans(T))));
    const pi = slot.personIndex;
    const pb = pi !== undefined ? `persons.${pi}` : '';

    if (slot.read === 'personPan') {
      add(`${pb}.pan`, 'PAN', pans.find(x => x[3] === 'P') || pans[0]);
      let nm = valueAfter(L, /^(name|नाम)\b/i, /father|पिता/i);
      let fn = valueAfter(L, /father'?s?\s*name|पिता/i);
      if (!nm || !fn) { const cand = nameLines(L).map(x => x.toUpperCase()); if (!nm) nm = cand[0] || ''; if (!fn) fn = cand.find(x => x !== nm) || ''; }
      if (nm) { const s = splitName(nm); add(`${pb}.firstName`, 'First name', s.first); add(`${pb}.middleName`, 'Middle name', s.middle); add(`${pb}.lastName`, 'Last name', s.last); }
      if (fn) { const s = splitName(fn); add(`${pb}.fatherFirst`, "Father's first name", s.first); add(`${pb}.fatherMiddle`, "Father's middle name", s.middle); add(`${pb}.fatherLast`, "Father's last name", s.last); }
      add(`${pb}.dob`, 'Date of birth', findDate(T, /date of birth|जन्म/i) || findDate(T));
    }
    if (slot.read === 'entityPan') {
      const want = G.CONSTITUTIONS[p.constitution].panChar;
      add('partA.pan', 'PAN of business', pans.find(x => x[3] === want) || pans[0]);
      add('partA.legalName', 'Legal name (as per PAN)', valueAfter(L, /^(name|नाम)\b/i, /father/i));
      add('business.regDate', 'Date of incorporation / formation', findDate(T, /incorporation|formation|date/i), false);
    }
    if (slot.read === 'coi') {
      const flat = T.replace(/\n/g, ' ');
      add('business.regNo', p.constitution === 'llp' ? 'LLPIN' : 'CIN', ((flat.match(/\b[LU]\d{5}[A-Z]{2}\d{4}[A-Z]{3}\d{6}\b/) || flat.match(/\b[A-Z]{3}-\d{4}\b/)) || [])[0]);
      const nm = /certify that\s+(.+?)\s+(?:is|has been)\s+(?:incorporated|registered)/i.exec(flat);
      add('partA.legalName', 'Legal name', nm && nm[1].replace(/^M\/s\.?\s*/i, ''));
      const pan = /permanent account number[^A-Z]{0,40}?([A-Z]{5}\d{4}[A-Z])/i.exec(flat);
      add('partA.pan', 'PAN of business', pan ? pan[1] : (pans.find(x => x[3] === G.CONSTITUTIONS[p.constitution].panChar) || ''));
      add('business.regDate', 'Date of incorporation', findDate(flat, /incorporated|registered/i));
      const addr = /(?:mailing address|registered office)[^:]*:\s*(.+?\d{6})/i.exec(T.replace(/\n(?!\n)/g, ' '));
      if (addr) {
        const { pin, state } = pinState(addr[1]);
        const a = addressParts(addr[1]);
        add('ppob.address.pin', 'Business PIN code', pin); add('ppob.address.state', 'Business state', state);
        add('ppob.address.city', 'Business city', a.city); add('ppob.address.building', 'Building / flat no.', a.building); add('ppob.address.premises', 'Name of premises', a.premises); add('ppob.address.floor', 'Floor', a.floor);
        add('ppob.address.road', 'Road / street', a.road); add('ppob.address.locality', 'Locality', a.locality);
      }
    }
    if (slot.read === 'deed') {
      const flat = T.replace(/\n/g, ' ');
      const firm = /(?:M\/s\.?|under the (?:firm )?name and style of)\s*["“]?([A-Z][A-Z0-9 &.,'-]{2,60}?)["”]?(?=[,.]|\s+(?:having|with|at|which|shall))/i.exec(flat);
      add('partA.legalName', 'Firm name', firm && firm[1].trim());
      add('business.regDate', 'Date of deed', findDate(flat, /dated|made (?:at|on)|executed/i), false);
      add('partA.pan', 'PAN of firm', pans.find(x => x[3] === 'F'), false);
    }
    if (slot.read === 'aadhaar') {
      const num = (T.match(/\b[2-9]\d{3}\s?\d{4}\s?\d{4}\b/) || [])[0];
      const dobLine = L.findIndex(x => /dob|date of birth|year of birth|जन्म/i.test(x));
      const nmA = (dobLine > 0 ? nameLines(L.slice(Math.max(0, dobLine - 3), dobLine)).pop() : '') || nameLines(L)[0] || '';
      if (nmA) { const s = splitName(nmA.toUpperCase()); add(`${pb}.firstName`, 'First name', s.first); add(`${pb}.middleName`, 'Middle name', s.middle); add(`${pb}.lastName`, 'Last name', s.last); }
      add(`${pb}.aadhaar`, 'Aadhaar number', num && num.replace(/\s/g, ''));
      add(`${pb}.dob`, 'Date of birth', findDate(T, /dob|date of birth|जन्म/i));
      const g = /\b(female|male|transgender)\b/i.exec(T);
      if (g) add(`${pb}.gender`, 'Gender', g[1].toLowerCase() === 'female' ? 'Female' : g[1].toLowerCase() === 'male' ? 'Male' : 'Others');
      const rel = /\b[SD]\/O[:\s]+([A-Za-z .]+?)(?:,|\n)/.exec(T);
      if (rel) { const s = splitName(rel[1].toUpperCase()); add(`${pb}.fatherFirst`, "Father's first name", s.first, false); add(`${pb}.fatherLast`, "Father's last name", s.last, false); }
      const addr = /address[:\s]+([\s\S]{10,220}?\d{6})/i.exec(T);
      if (addr) {
        const one = addr[1].replace(/\n/g, ', ').replace(/\b[SDWC]\/O[:\s]+[A-Za-z .]+,?\s*/i, '');
        const { pin, state } = pinState(one);
        const a = addressParts(one.replace(/\s*-\s*\d{6}$/, ''));
        add(`${pb}.address.pin`, 'PIN code', pin); add(`${pb}.address.state`, 'State', state); add(`${pb}.address.city`, 'City', a.city);
        add(`${pb}.address.building`, 'Building / flat no.', a.building); add(`${pb}.address.premises`, 'Name of premises', a.premises); add(`${pb}.address.floor`, 'Floor', a.floor);
        add(`${pb}.address.road`, 'Road / street', a.road); add(`${pb}.address.locality`, 'Locality', a.locality);
      }
    }
    if (slot.read === 'rent') {
      const flat = T.replace(/\n/g, ' ');
      const a = /(?:premises|property|flat|shop|office|house|unit|godown)\b[^.]{0,80}?(?:situated|located|lying|bearing|being|known as)\s*(?:at|on|in)?\s*[:,-]?\s*(.{10,220}?\b[1-9]\d{5}\b)/i.exec(flat);
      if (a) {
        const one = a[1].replace(/\s*-\s*(\d{6})$/, ', $1');
        const { pin, state } = pinState(one);
        const parts = addressParts(one.replace(/,?\s*[1-9]\d{5}$/, ''));
        add('ppob.address.building', 'Building / flat no.', parts.building); add('ppob.address.floor', 'Floor', parts.floor); add('ppob.address.premises', 'Name of premises', parts.premises);
        add('ppob.address.road', 'Road / street', parts.road); add('ppob.address.locality', 'Locality', parts.locality);
        add('ppob.address.city', 'City', parts.city); add('ppob.address.state', 'State', state); add('ppob.address.pin', 'PIN code', pin);
      } else { const { pin, state } = pinState(T); add('ppob.address.pin', 'Business PIN code', pin); add('ppob.address.state', 'Business state', state); }
      if (!p.ppob.possession) add('ppob.possession', 'Nature of possession', /consent|no objection|noc/i.test(T) ? 'Consent' : /lease deed|lessor|lessee/i.test(T) ? 'Leased' : 'Rented');
    }
    if (slot.read === 'address') {
      const { pin, state } = pinState(T);
      add('ppob.address.pin', 'Business PIN code', pin, !p.ppob.address.pin);
      add('ppob.address.state', 'Business state', state, !p.ppob.address.state);
    }
    if (slot.read === 'bank') {
      add('bank.ifsc', 'IFSC', (T.match(/\b[A-Z]{4}0[A-Z0-9]{6}\b/) || [])[0]);
      const ac = /a\/?c(?:count)?\.?\s*(?:no|number|#)\.?\s*[:\-]?\s*(\d[\d ]{8,20}\d)/i.exec(T);
      add('bank.accountNo', 'Account number', ac && ac[1].replace(/\s/g, ''));
      const ty = /\b(savings|current|cash credit|overdraft)\b/i.exec(T);
      if (ty) add('bank.accountType', 'Account type', ty[1][0].toUpperCase() + ty[1].slice(1).toLowerCase(), false);
    }
    // Uncheck when the profile already holds a different value
    const get = (path) => path.split('.').reduce((o, k) => (o == null ? o : o[k]), p);
    out.forEach(s => { const cur = get(s.path); s.current = cur || ''; if (cur && String(cur) !== s.value) s.checked = false; if (cur && String(cur) === s.value) s.same = true; });
    return out.filter(s => !s.same);
  }

  /* ---------- reader for photos, scans and locked PDFs (runs on the GST Desk site in this browser) ---------- */
  const READER_ORIGIN = 'https://smishra724.github.io';
  const READER_URLS = [READER_ORIGIN + '/gst-desk/docs/reader.html', READER_ORIGIN + '/gst-desk/reader.html'];
  let readerP = null;
  function ensureReader() {
    if (readerP) return readerP;
    readerP = new Promise((res, rej) => {
      let i = 0;
      const next = () => {
        if (i >= READER_URLS.length) return rej(new Error('offline'));
        const f = document.createElement('iframe');
        f.style.cssText = 'position:absolute;width:1px;height:1px;border:0;left:-9999px';
        f.src = READER_URLS[i++];
        const t = setTimeout(() => { window.removeEventListener('message', on); f.remove(); next(); }, 9000);
        const on = (e) => { if (e.source === f.contentWindow && e.data && e.data.gstdeskReader === 'ready') { clearTimeout(t); window.removeEventListener('message', on); res(f); } };
        window.addEventListener('message', on);
        document.body.appendChild(f);
      };
      next();
    });
    readerP.catch(() => { readerP = null; });
    return readerP;
  }
  async function remoteRead(blob, password, onProgress) {
    const f = await ensureReader();
    const id = Math.random().toString(36).slice(2);
    const bytes = await blob.arrayBuffer();
    return new Promise((res, rej) => {
      const on = (e) => {
        if (e.source !== f.contentWindow || !e.data || e.data.id !== id) return;
        if (e.data.gstdeskReader === 'progress') { if (onProgress) onProgress(e.data.note); return; }
        window.removeEventListener('message', on); clearTimeout(t);
        e.data.ok ? res(e.data) : rej(Object.assign(new Error(e.data.error), { code: e.data.error }));
      };
      window.addEventListener('message', on);
      const t = setTimeout(() => { window.removeEventListener('message', on); rej(new Error('Reading took too long')); }, 240000);
      f.contentWindow.postMessage({ gstdeskReader: 'read', id, bytes, type: blob.type, password }, READER_ORIGIN, [bytes]);
    });
  }

  // opts: { askPassword(): Promise<string|null>, onProgress(note) }
  async function readDetails(blob, slot, p, opts = {}) {
    if (!slot.read) return { suggestions: [], note: '' };
    const isPdf = blob.type === 'application/pdf';
    let text = '', note = '';
    try {
      if (isPdf) {
        const r = await root.PDFText.extract(await blob.arrayBuffer());
        if (r.encrypted) {
          let pw = opts.askPassword ? await opts.askPassword() : null;
          while (pw) {
            try { text = (await remoteRead(blob, pw, opts.onProgress)).text; break; }
            catch (e) { if (e.code === 'wrong-password' && opts.askPassword) { pw = await opts.askPassword(true); continue; } throw e; }
          }
          if (!pw) return { suggestions: [], note: 'Password not entered – the file is saved; details were not read.' };
        } else if (r.text && r.text.replace(/\s/g, '').length > 30) text = r.text;
        else { if (opts.onProgress) opts.onProgress('This is a scanned PDF – reading its text…'); text = (await remoteRead(blob, '', opts.onProgress)).text; }
      } else {
        if (opts.onProgress) opts.onProgress('Reading text from the image…');
        text = (await remoteRead(blob, '', opts.onProgress)).text;
      }
    } catch (e) {
      if (e.message === 'offline') return { suggestions: [], note: 'To read photos, scans or locked PDFs, GST Desk needs the internet once (it loads the reader from the GST Desk website). The file is saved.' };
      return { suggestions: [], note: 'Could not read this document (' + e.message + '). The file is saved.' };
    }
    if (!text || text.replace(/\s/g, '').length < 15) return { suggestions: [], note: 'No readable text found in this document. The file is saved.' };
    const sug = suggest(text, slot, p);
    return { suggestions: sug, note: sug.length ? '' : 'No new details found in this document.', text };
  }

  /* ---------- portal upload fields → slot ---------- */
  function slotForUpload(label, ctx, p, personIdx) {
    const t = String(label || '').toLowerCase();
    const person = p.persons[personIdx] || p.persons[0];
    if (/photo/.test(t) && (ctx === 'promoter' || ctx === 'signatory' || ctx === 'representative')) return person ? `person:${person.id}:photo` : '';
    if (/authori[sz]ation|resolution|appointment/.test(t)) return 'entity:authorisation';
    if (ctx === 'business' && /constitution|deed|incorporation|registration certificate|proof/.test(t)) return 'entity:constitution';
    if (ctx === 'ppob' || /place of business/.test(t)) {
      if (/rent|lease/.test(t)) return 'entity:rent';
      if (/consent|noc/.test(t)) return 'entity:consent';
      return 'entity:address';
    }
    if (ctx === 'bank' || /cheque|passbook|bank/.test(t)) return 'entity:bank';
    return '';
  }

  root.GSTDocs = { ADDRESS_TYPES, LIMIT, slots, Store, prepare, readAsDataURL, dataURLtoBlob, toFile, readDetails, suggest, slotForUpload, findDate, fixPans };
})(typeof window !== 'undefined' ? window : globalThis);
