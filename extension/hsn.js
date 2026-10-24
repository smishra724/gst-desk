/* HSN / SAC descriptions.
   1. Full list: the GST portal's own "HSN Directory" Excel, imported once (exact portal wording).
   2. Otherwise a live look-up on the GST portal's public HSN search.
   3. Otherwise the chapter / service-group name, so there is always some description. */
(function (root) {
  'use strict';
  const DIR_KEY = 'gstf_hsn_dir', CACHE_KEY = 'gstf_hsn_cache';
  const PORTAL_SEARCH_PAGE = 'https://services.gst.gov.in/services/searchhsnsac';

  const CHAPTERS = {
    '01': 'Live animals', '02': 'Meat and edible meat offal', '03': 'Fish, crustaceans and molluscs', '04': 'Dairy produce; eggs; honey',
    '05': 'Other products of animal origin', '06': 'Live trees, plants, cut flowers', '07': 'Edible vegetables', '08': 'Edible fruit and nuts',
    '09': 'Coffee, tea, mate and spices', '10': 'Cereals', '11': 'Milling products; malt; starches', '12': 'Oil seeds and oleaginous fruits',
    '13': 'Lac; gums, resins', '14': 'Vegetable plaiting materials', '15': 'Animal or vegetable fats and oils', '16': 'Preparations of meat or fish',
    '17': 'Sugars and sugar confectionery', '18': 'Cocoa and cocoa preparations', '19': 'Preparations of cereals, flour, starch or milk; bakery products',
    '20': 'Preparations of vegetables, fruit or nuts', '21': 'Miscellaneous edible preparations', '22': 'Beverages, spirits and vinegar',
    '23': 'Food industry residues; animal fodder', '24': 'Tobacco and manufactured tobacco substitutes', '25': 'Salt; sulphur; earths and stone; lime and cement',
    '26': 'Ores, slag and ash', '27': 'Mineral fuels, mineral oils', '28': 'Inorganic chemicals', '29': 'Organic chemicals', '30': 'Pharmaceutical products',
    '31': 'Fertilisers', '32': 'Tanning or dyeing extracts; paints, varnishes, inks', '33': 'Essential oils; perfumery and cosmetic preparations',
    '34': 'Soap, washing preparations, waxes, candles', '35': 'Albuminoidal substances; glues; enzymes', '36': 'Explosives; matches; pyrotechnic products',
    '37': 'Photographic or cinematographic goods', '38': 'Miscellaneous chemical products', '39': 'Plastics and articles thereof', '40': 'Rubber and articles thereof',
    '41': 'Raw hides and skins and leather', '42': 'Articles of leather; handbags, travel goods', '43': 'Furskins and artificial fur', '44': 'Wood and articles of wood',
    '45': 'Cork and articles of cork', '46': 'Manufactures of straw; basketware', '47': 'Pulp of wood', '48': 'Paper and paperboard; articles of paper',
    '49': 'Printed books, newspapers, pictures', '50': 'Silk', '51': 'Wool and animal hair', '52': 'Cotton', '53': 'Other vegetable textile fibres',
    '54': 'Man-made filaments', '55': 'Man-made staple fibres', '56': 'Wadding, felt; twine, cordage, ropes', '57': 'Carpets and textile floor coverings',
    '58': 'Special woven fabrics; lace; embroidery', '59': 'Impregnated or coated textile fabrics', '60': 'Knitted or crocheted fabrics',
    '61': 'Apparel, knitted or crocheted', '62': 'Apparel, not knitted or crocheted', '63': 'Other made up textile articles', '64': 'Footwear',
    '65': 'Headgear', '66': 'Umbrellas, walking sticks', '67': 'Prepared feathers; artificial flowers', '68': 'Articles of stone, plaster, cement, asbestos',
    '69': 'Ceramic products', '70': 'Glass and glassware', '71': 'Pearls, precious stones and metals; jewellery; coin', '72': 'Iron and steel',
    '73': 'Articles of iron or steel', '74': 'Copper and articles thereof', '75': 'Nickel and articles thereof', '76': 'Aluminium and articles thereof',
    '78': 'Lead and articles thereof', '79': 'Zinc and articles thereof', '80': 'Tin and articles thereof', '81': 'Other base metals', '82': 'Tools, cutlery of base metal',
    '83': 'Miscellaneous articles of base metal', '84': 'Machinery, mechanical appliances, computers and parts', '85': 'Electrical machinery and equipment; electronics',
    '86': 'Railway locomotives and rolling stock', '87': 'Vehicles other than railway, and parts', '88': 'Aircraft, spacecraft and parts', '89': 'Ships, boats',
    '90': 'Optical, measuring, medical instruments', '91': 'Clocks and watches', '92': 'Musical instruments', '93': 'Arms and ammunition',
    '94': 'Furniture; bedding; lamps; prefabricated buildings', '95': 'Toys, games and sports requisites', '96': 'Miscellaneous manufactured articles',
    '97': 'Works of art, collectors’ pieces, antiques', '98': 'Project imports; special classification provisions'
  };
  const SAC = {
    '9954': 'Construction services', '9961': 'Wholesale trade services', '9962': 'Retail trade services', '9963': 'Accommodation, food and beverage services',
    '9964': 'Passenger transport services', '9965': 'Goods transport services', '9966': 'Rental of transport vehicles with operator',
    '9967': 'Supporting services in transport', '9968': 'Postal and courier services', '9969': 'Electricity, gas, water distribution services',
    '9971': 'Financial and related services', '9972': 'Real estate services', '9973': 'Leasing or rental services without operator',
    '9981': 'Research and development services', '9982': 'Legal and accounting services', '9983': 'Other professional, technical and business services',
    '9984': 'Telecommunications, broadcasting and information supply services', '9985': 'Support services', '9986': 'Support services to agriculture, mining, utilities',
    '9987': 'Maintenance, repair and installation (except construction) services', '9988': 'Manufacturing services on physical inputs owned by others',
    '9989': 'Other manufacturing services; publishing, printing, recycling', '9991': 'Public administration services', '9992': 'Education services',
    '9993': 'Human health and social care services', '9994': 'Sewage, waste collection and treatment services', '9995': 'Services of membership organisations',
    '9996': 'Recreational, cultural and sporting services', '9997': 'Other services', '9998': 'Domestic services', '9999': 'Services by extraterritorial organisations'
  };

  let dir = null, cache = null;
  async function loadDir() {
    if (dir && cache) return;
    const r = await chrome.storage.local.get([DIR_KEY, CACHE_KEY]);
    dir = (r[DIR_KEY] && r[DIR_KEY].map) || {};
    cache = r[CACHE_KEY] || {};
  }
  async function dirInfo() { const r = await chrome.storage.local.get(DIR_KEY); const d = r[DIR_KEY]; return d ? { count: Object.keys(d.map).length, date: d.date, file: d.file } : null; }

  const titleCase = (s) => /[a-z]/.test(s) ? s : s.toLowerCase().replace(/(^|[\s(,;-])([a-z])/g, (m, a, b) => a + b.toUpperCase());

  /* ---- live search on the GST portal (public, no login) ---- */
  function parseApi(j) {
    const list = Array.isArray(j) ? j : (j && (j.data || j.result || j.hsnList || j.list)) || [];
    const arr = Array.isArray(list) ? list : (list && Array.isArray(list.data) ? list.data : []);
    return arr.map(x => ({
      code: String(x.c || x.hsnCd || x.hsn_cd || x.hsnCode || x.code || x.hsn || '').replace(/\D/g, ''),
      desc: String(x.n || x.hsnDesc || x.hsn_desc || x.description || x.desc || x.name || '').trim()
    })).filter(x => x.code && x.desc);
  }
  async function portal(input, byDesc) {
    const q = encodeURIComponent(input);
    const urls = [
      `https://services.gst.gov.in/commonservices/hsn/search/qsearch?inputText=${q}&selectedType=${byDesc ? 'byDesc' : 'byCode'}&category=null`,
      `https://services.gst.gov.in/commonservices/hsn/search/qsearch?inputText=${q}&selectedType=${byDesc ? 'byDesc' : 'byCode'}`
    ];
    for (const u of urls) {
      try {
        const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), 6000);
        const r = await fetch(u, { signal: ctl.signal, credentials: 'omit' });
        clearTimeout(t);
        if (!r.ok) continue;
        const rows = parseApi(await r.json());
        if (rows.length) return rows;
      } catch (_) { /* try next */ }
    }
    return [];
  }

  // { desc, source: 'directory' | 'portal' | 'chapter', exact }
  async function describe(code) {
    code = String(code || '').replace(/\D/g, '');
    if (code.length < 2) return null;
    await loadDir();
    for (let n = code.length; n >= 2; n -= 2) {
      const k = code.slice(0, n);
      if (dir[k]) return { desc: titleCase(dir[k]), source: 'directory', exact: n === code.length, code: k };
    }
    if (cache[code]) return { ...cache[code], source: 'portal' };
    const rows = await portal(code, false);
    const hit = rows.find(r => r.code === code) || rows.find(r => code.startsWith(r.code)) || null;
    if (hit) {
      cache[code] = { desc: titleCase(hit.desc), exact: hit.code === code, code: hit.code };
      chrome.storage.local.set({ [CACHE_KEY]: cache });
      return { ...cache[code], source: 'portal' };
    }
    if (code.startsWith('99')) {
      const g = SAC[code.slice(0, 4)];
      return g ? { desc: g, source: 'chapter', exact: code.length === 4, code: code.slice(0, 4) } : { desc: 'Services (SAC)', source: 'chapter', exact: false, code: '99' };
    }
    const ch = CHAPTERS[code.slice(0, 2)];
    return ch ? { desc: `Chapter ${code.slice(0, 2)}: ${ch}`, source: 'chapter', exact: false, code: code.slice(0, 2) } : { desc: 'No such HSN chapter', source: 'chapter', bad: true };
  }

  // Search by product / service words
  async function search(text, kind) {
    const words = String(text || '').toLowerCase().split(/\s+/).filter(w => w.length > 1);
    if (!words.length) return [];
    await loadDir();
    const isSac = (c) => c.startsWith('99');
    let out = [];
    if (Object.keys(dir).length) {
      for (const [c, d] of Object.entries(dir)) {
        if (c.length < 4 || (kind === 'sac') !== isSac(c)) continue;
        const dl = d.toLowerCase();
        if (words.every(w => dl.includes(w))) out.push({ code: c, desc: titleCase(d) });
        if (out.length > 60) break;
      }
      out.sort((a, b) => a.code.length - b.code.length || a.code.localeCompare(b.code));
    } else {
      out = (await portal(text, true)).filter(r => r.code.length >= 4 && (kind === 'sac') === isSac(r.code)).map(r => ({ code: r.code, desc: titleCase(r.desc) }));
      if (!out.length) {
        const src = kind === 'sac' ? SAC : CHAPTERS;
        out = Object.entries(src).filter(([, d]) => words.some(w => d.toLowerCase().includes(w))).map(([c, d]) => ({ code: c, desc: d, chapter: true }));
      }
    }
    return out.slice(0, 25);
  }

  /* ---- read the portal's HSN Directory Excel (.xlsx) without a library ---- */
  async function inflateRaw(u8) {
    const ds = new DecompressionStream('deflate-raw');
    return new Uint8Array(await new Response(new Blob([u8]).stream().pipeThrough(ds)).arrayBuffer());
  }
  async function unzip(buf) {
    const u8 = new Uint8Array(buf), dv = new DataView(buf);
    let eocd = -1;
    for (let i = u8.length - 22; i >= Math.max(0, u8.length - 70000); i--) if (dv.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
    if (eocd < 0) throw new Error('Not an Excel (.xlsx) file');
    const count = dv.getUint16(eocd + 10, true);
    let p = dv.getUint32(eocd + 16, true);
    const files = {};
    const dec = new TextDecoder();
    for (let n = 0; n < count; n++) {
      if (dv.getUint32(p, true) !== 0x02014b50) break;
      const method = dv.getUint16(p + 10, true), csize = dv.getUint32(p + 20, true);
      const nlen = dv.getUint16(p + 28, true), xlen = dv.getUint16(p + 30, true), clen = dv.getUint16(p + 32, true), off = dv.getUint32(p + 42, true);
      const name = dec.decode(u8.subarray(p + 46, p + 46 + nlen));
      const lnl = dv.getUint16(off + 26, true), lxl = dv.getUint16(off + 28, true);
      const start = off + 30 + lnl + lxl;
      files[name] = { method, data: u8.subarray(start, start + csize) };
      p += 46 + nlen + xlen + clen;
    }
    return {
      async text(name) {
        const f = files[name];
        if (!f) return null;
        const raw = f.method === 8 ? await inflateRaw(f.data) : f.data;
        return dec.decode(raw);
      },
      names: Object.keys(files)
    };
  }
  function cellRef(r) { const m = /^([A-Z]+)/.exec(r || ''); let n = 0; if (m) for (const ch of m[1]) n = n * 26 + ch.charCodeAt(0) - 64; return n - 1; }
  async function readXlsxRows(buf) {
    const z = await unzip(buf);
    const ss = [];
    const sst = await z.text('xl/sharedStrings.xml');
    if (sst) {
      const doc = new DOMParser().parseFromString(sst, 'application/xml');
      for (const si of doc.getElementsByTagName('si')) ss.push(Array.from(si.getElementsByTagName('t')).map(t => t.textContent).join(''));
    }
    const sheets = z.names.filter(n => /^xl\/worksheets\/sheet\d+\.xml$/.test(n)).sort();
    const rows = [];
    for (const sh of sheets) {
      const xml = await z.text(sh);
      const doc = new DOMParser().parseFromString(xml, 'application/xml');
      for (const r of doc.getElementsByTagName('row')) {
        const row = [];
        for (const c of r.getElementsByTagName('c')) {
          const t = c.getAttribute('t'); const v = c.getElementsByTagName('v')[0]; const is = c.getElementsByTagName('t')[0];
          let val = t === 's' ? ss[+(v && v.textContent)] : t === 'inlineStr' ? (is && is.textContent) : (v && v.textContent);
          row[cellRef(c.getAttribute('r'))] = val == null ? '' : String(val);
        }
        rows.push(row);
      }
    }
    return rows;
  }
  async function importDirectory(file) {
    const rows = await readXlsxRows(await file.arrayBuffer());
    const map = {};
    for (const row of rows) {
      if (!row) continue;
      const ci = row.findIndex(v => /^\d{2,8}$/.test(String(v || '').trim()));
      if (ci < 0) continue;
      const code = String(row[ci]).trim();
      const desc = row.slice(ci + 1).map(v => String(v || '').trim()).find(v => /[A-Za-z]{3}/.test(v));
      if (desc && !map[code]) map[code] = desc.replace(/\s+/g, ' ');
    }
    const n = Object.keys(map).length;
    if (n < 50) throw new Error('This file does not look like the HSN directory (found only ' + n + ' codes)');
    await chrome.storage.local.set({ [DIR_KEY]: { map, date: new Date().toISOString(), file: file.name } });
    dir = map;
    return n;
  }

  root.GSTHsn = { describe, search, importDirectory, dirInfo, readXlsxRows, PORTAL_SEARCH_PAGE, CHAPTERS, SAC };
})(typeof window !== 'undefined' ? window : globalThis);
