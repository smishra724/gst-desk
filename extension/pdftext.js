/* Small built-in PDF text reader (no outside library).
   Handles normal text PDFs such as e-PAN, MCA/LLP certificates, bank letters and bills:
   Flate-compressed streams, object streams, ToUnicode maps, Tj/TJ/'/" text operators.
   Scanned images have no text inside – those need typing (or a searchable PDF). */
(function (root) {
  'use strict';

  const latin1 = (u8) => { let s = ''; for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000)); return s; };
  const toBytes = (s) => { const u = new Uint8Array(s.length); for (let i = 0; i < s.length; i++) u[i] = s.charCodeAt(i) & 0xFF; return u; };

  async function inflate(u8) {
    for (const fmt of ['deflate', 'deflate-raw']) {
      try {
        const ds = new DecompressionStream(fmt);
        const out = new Response(new Blob([u8]).stream().pipeThrough(ds));
        return new Uint8Array(await out.arrayBuffer());
      } catch (_) { /* try next */ }
    }
    // Partial data (bad trailing bytes): read whatever comes out
    try {
      const ds = new DecompressionStream('deflate');
      const reader = new Blob([u8]).stream().pipeThrough(ds).getReader();
      const chunks = [];
      for (;;) { const r = await reader.read().catch(() => ({ done: true })); if (r.done) break; chunks.push(r.value); }
      const n = chunks.reduce((a, c) => a + c.length, 0), out = new Uint8Array(n); let o = 0;
      chunks.forEach(c => { out.set(c, o); o += c.length; });
      return out;
    } catch (_) { return new Uint8Array(0); }
  }

  /* ---------- objects ---------- */
  function parseObjects(src) {
    const objs = new Map(); // num -> {dict, stream(raw string|null)}
    const rx = /(\d+)\s+(\d+)\s+obj\b/g;
    let m;
    while ((m = rx.exec(src))) {
      const num = +m[1];
      const start = rx.lastIndex;
      const end = src.indexOf('endobj', start);
      if (end < 0) break;
      const body = src.slice(start, end);
      const si = body.search(/\bstream\r?\n/);
      if (si >= 0) {
        const dict = body.slice(0, si);
        let dataStart = si + body.slice(si).match(/^stream\r?\n/)[0].length;
        const lenM = /\/Length\s+(\d+)(?!\s+\d+\s+R)/.exec(dict);
        let data;
        if (lenM && dataStart + +lenM[1] <= body.length) data = body.substr(dataStart, +lenM[1]);
        else { const e = body.lastIndexOf('endstream'); data = body.slice(dataStart, e >= 0 ? e : body.length).replace(/\r?\n$/, ''); }
        objs.set(num, { dict, stream: data });
      } else objs.set(num, { dict: body, stream: null });
      rx.lastIndex = end + 6;
    }
    return objs;
  }

  function a85(u8) {
    const s = latin1(u8).replace(/\s+/g, '').replace(/^<~/, '');
    const end = s.indexOf('~>');
    const d = end >= 0 ? s.slice(0, end) : s;
    const out = [];
    let tuple = [], i = 0;
    for (; i < d.length; i++) {
      const ch = d[i];
      if (ch === 'z' && !tuple.length) { out.push(0, 0, 0, 0); continue; }
      tuple.push(ch.charCodeAt(0) - 33);
      if (tuple.length === 5) {
        let v = 0; for (const t of tuple) v = v * 85 + t;
        out.push((v >>> 24) & 255, (v >>> 16) & 255, (v >>> 8) & 255, v & 255); tuple = [];
      }
    }
    if (tuple.length) {
      const n = tuple.length; while (tuple.length < 5) tuple.push(84);
      let v = 0; for (const t of tuple) v = v * 85 + t;
      const b = [(v >>> 24) & 255, (v >>> 16) & 255, (v >>> 8) & 255, v & 255];
      out.push(...b.slice(0, n - 1));
    }
    return new Uint8Array(out);
  }
  function ahx(u8) {
    let h = latin1(u8).replace(/[^0-9a-fA-F]/g, '');
    if (h.length % 2) h += '0';
    const out = new Uint8Array(h.length / 2);
    for (let i = 0; i < out.length; i++) out[i] = parseInt(h.substr(i * 2, 2), 16);
    return out;
  }
  async function streamBytes(o) {
    if (!o || o.stream == null) return null;
    let data = toBytes(o.stream);
    const fm = /\/Filter\s*(\[[^\]]*\]|\/\w+)/.exec(o.dict);
    const filters = fm ? Array.from(fm[1].matchAll(/\/(\w+)/g)).map(x => x[1]) : [];
    for (const f of filters) {
      if (f === 'FlateDecode' || f === 'Fl') data = await inflate(data);
      else if (f === 'ASCII85Decode' || f === 'A85') data = a85(data);
      else if (f === 'ASCIIHexDecode' || f === 'AHx') data = ahx(data);
      else return null; // images (DCT, JBIG2…) carry no text
    }
    return data;
  }

  async function expandObjectStreams(objs) {
    for (const [, o] of Array.from(objs)) {
      if (!/\/Type\s*\/ObjStm/.test(o.dict)) continue;
      const u8 = await streamBytes(o);
      if (!u8) continue;
      const s = latin1(u8);
      const n = +(/\/N\s+(\d+)/.exec(o.dict) || [])[1] || 0;
      const first = +(/\/First\s+(\d+)/.exec(o.dict) || [])[1] || 0;
      const head = s.slice(0, first).trim().split(/\s+/).map(Number);
      for (let i = 0; i < n; i++) {
        const num = head[i * 2], off = head[i * 2 + 1];
        const next = i + 1 < n ? head[(i + 1) * 2 + 1] : s.length - first;
        if (!objs.has(num)) objs.set(num, { dict: s.slice(first + off, first + next), stream: null });
      }
    }
  }

  /* ---------- ToUnicode maps ---------- */
  const hexToStr = (h) => {
    let out = '';
    for (let i = 0; i + 3 < h.length + 0; i += 4) out += String.fromCharCode(parseInt(h.substr(i, 4), 16));
    if (h.length === 2) out = String.fromCharCode(parseInt(h, 16));
    return out;
  };
  function parseCMap(text) {
    const map = new Map();
    let bytes = 1;
    const cs = /begincodespacerange([\s\S]*?)endcodespacerange/.exec(text);
    if (cs) { const h = /<([0-9a-fA-F]+)>/.exec(cs[1]); if (h) bytes = h[1].length / 2; }
    for (const blk of text.matchAll(/beginbfchar([\s\S]*?)endbfchar/g)) {
      for (const p of blk[1].matchAll(/<([0-9a-fA-F]+)>\s*<([0-9a-fA-F]*)>/g)) map.set(parseInt(p[1], 16), hexToStr(p[2]));
    }
    for (const blk of text.matchAll(/beginbfrange([\s\S]*?)endbfrange/g)) {
      const body = blk[1];
      for (const p of body.matchAll(/<([0-9a-fA-F]+)>\s*<([0-9a-fA-F]+)>\s*(<[0-9a-fA-F]*>|\[[^\]]*\])/g)) {
        const lo = parseInt(p[1], 16), hi = parseInt(p[2], 16);
        if (p[3][0] === '[') {
          const items = Array.from(p[3].matchAll(/<([0-9a-fA-F]*)>/g)).map(x => hexToStr(x[1]));
          for (let c = lo; c <= hi && c - lo < items.length; c++) map.set(c, items[c - lo]);
        } else {
          const baseHex = p[3].slice(1, -1);
          const base = parseInt(baseHex.slice(-4) || '0', 16), prefix = hexToStr(baseHex.slice(0, -4));
          for (let c = lo; c <= hi && c - lo < 65536; c++) map.set(c, prefix + String.fromCharCode(base + (c - lo)));
        }
      }
    }
    return { map, bytes };
  }

  /* ---------- content stream tokens ---------- */
  function* tokens(s) {
    let i = 0;
    const n = s.length;
    while (i < n) {
      const c = s[i];
      if (/\s/.test(c)) { i++; continue; }
      if (c === '%') { while (i < n && s[i] !== '\n' && s[i] !== '\r') i++; continue; }
      if (c === '(') {
        let depth = 1, out = ''; i++;
        while (i < n && depth) {
          const ch = s[i];
          if (ch === '\\') {
            const nx = s[i + 1];
            const esc = { n: '\n', r: '\r', t: '\t', b: '\b', f: '\f', '(': '(', ')': ')', '\\': '\\' };
            if (nx in esc) { out += esc[nx]; i += 2; }
            else if (/[0-7]/.test(nx)) { const m = /^[0-7]{1,3}/.exec(s.slice(i + 1, i + 4))[0]; out += String.fromCharCode(parseInt(m, 8)); i += 1 + m.length; }
            else if (nx === '\r' || nx === '\n') { i += 2; if (nx === '\r' && s[i] === '\n') i++; }
            else { out += nx || ''; i += 2; }
            continue;
          }
          if (ch === '(') depth++;
          else if (ch === ')') { depth--; if (!depth) { i++; break; } }
          out += ch; i++;
        }
        yield { t: 'str', v: out }; continue;
      }
      if (c === '<' && s[i + 1] === '<') { yield { t: 'op', v: '<<' }; i += 2; continue; }
      if (c === '>' && s[i + 1] === '>') { yield { t: 'op', v: '>>' }; i += 2; continue; }
      if (c === '<') {
        const e = s.indexOf('>', i);
        let h = s.slice(i + 1, e < 0 ? n : e).replace(/\s+/g, '');
        if (h.length % 2) h += '0';
        let out = ''; for (let k = 0; k < h.length; k += 2) out += String.fromCharCode(parseInt(h.substr(k, 2), 16));
        yield { t: 'str', v: out, hex: true }; i = e < 0 ? n : e + 1; continue;
      }
      if (c === '[' || c === ']') { yield { t: c }; i++; continue; }
      if (c === '/') { let j = i + 1; while (j < n && !/[\s/[\]()<>{}%]/.test(s[j])) j++; yield { t: 'name', v: s.slice(i + 1, j) }; i = j; continue; }
      let j = i; while (j < n && !/[\s/[\]()<>{}%]/.test(s[j])) j++;
      if (j === i) { i++; continue; }
      const w = s.slice(i, j); i = j;
      if (/^[+-]?(\d+\.?\d*|\.\d+)$/.test(w)) yield { t: 'num', v: parseFloat(w) };
      else yield { t: 'op', v: w };
    }
  }

  function decodeWith(font, str) {
    if (!font) return str.replace(/[^\x20-\x7E\xA0-\xFF\n]/g, '');
    const { map, bytes } = font;
    let out = '';
    for (let i = 0; i < str.length; i += bytes) {
      let code = 0;
      for (let b = 0; b < bytes; b++) code = (code << 8) | (str.charCodeAt(i + b) & 0xFF);
      out += map.has(code) ? map.get(code) : (bytes === 1 ? String.fromCharCode(code) : '');
    }
    return out;
  }

  function textFromContent(s, fonts) {
    let out = '', font = null, lastY = null, operands = [];
    let inArray = false, arr = [];
    const nl = () => { if (out && !out.endsWith('\n')) out += '\n'; };
    const sp = () => { if (out && !/[\s]$/.test(out)) out += ' '; };
    for (const tk of tokens(s)) {
      if (tk.t === '[') { inArray = true; arr = []; continue; }
      if (tk.t === ']') { inArray = false; operands.push({ t: 'arr', v: arr }); continue; }
      if (inArray) { arr.push(tk); continue; }
      if (tk.t !== 'op') { operands.push(tk); continue; }
      const op = tk.v;
      if (op === 'Tf') { const nm = operands.find(o => o.t === 'name'); font = nm ? fonts.get(nm.v) || null : null; }
      else if (op === 'Tj' || op === "'" || op === '"') {
        if (op !== 'Tj') nl();
        const st = operands.filter(o => o.t === 'str').pop();
        if (st) out += decodeWith(font, st.v);
      } else if (op === 'TJ') {
        const a = operands.find(o => o.t === 'arr');
        if (a) for (const it of a.v) {
          if (it.t === 'str') out += decodeWith(font, it.v);
          else if (it.t === 'num' && it.v < -180) sp();
        }
      } else if (op === 'Td' || op === 'TD') {
        const nums = operands.filter(o => o.t === 'num');
        const ty = nums.length >= 2 ? nums[nums.length - 1].v : 0, tx = nums.length >= 2 ? nums[nums.length - 2].v : 0;
        if (Math.abs(ty) > 0.5) nl(); else if (tx > 1) sp();
      } else if (op === 'T*') nl();
      else if (op === 'Tm') {
        const nums = operands.filter(o => o.t === 'num');
        const y = nums.length >= 6 ? nums[5].v : null;
        if (y !== null && lastY !== null && Math.abs(y - lastY) > 0.5) nl(); else sp();
        lastY = y;
      } else if (op === 'ET') sp();
      operands = [];
    }
    return out;
  }

  /* ---------- public ---------- */
  async function extract(arrayBuffer) {
    const u8 = new Uint8Array(arrayBuffer);
    const src = latin1(u8);
    if (!/^%PDF-/.test(src.slice(0, 1024).trimStart())) throw new Error('Not a PDF file');
    if (/\/Encrypt\s+\d+\s+\d+\s+R/.test(src) || /\/Encrypt\s*<</.test(src)) return { encrypted: true, text: '' };
    const objs = parseObjects(src);
    await expandObjectStreams(objs);

    // Font resource name → ToUnicode map
    const cmapCache = new Map();
    async function cmapFor(fontNum) {
      if (cmapCache.has(fontNum)) return cmapCache.get(fontNum);
      const f = objs.get(fontNum);
      let res = null;
      const tu = f && /\/ToUnicode\s+(\d+)\s+\d+\s+R/.exec(f.dict);
      if (tu) { const b = await streamBytes(objs.get(+tu[1])); if (b) res = parseCMap(latin1(b)); }
      cmapCache.set(fontNum, res);
      return res;
    }
    const fonts = new Map();
    const fontDicts = [];
    for (const [, o] of objs) {
      for (const m of o.dict.matchAll(/\/Font\s*<<([\s\S]*?)>>/g)) fontDicts.push(m[1]);
      for (const m of o.dict.matchAll(/\/Font\s+(\d+)\s+\d+\s+R/g)) { const fo = objs.get(+m[1]); if (fo) fontDicts.push(fo.dict.replace(/^\s*<<|>>\s*$/g, '')); }
    }
    for (const fd of fontDicts) for (const m of fd.matchAll(/\/([^\s/<>[\]()]+)\s+(\d+)\s+\d+\s+R/g)) {
      const cm = await cmapFor(+m[2]);
      if (!fonts.has(m[1]) || cm) fonts.set(m[1], cm);
    }

    // Pages in order → their content streams
    const pageNums = [];
    for (const [num, o] of objs) if (/\/Type\s*\/Page\b(?!s)/.test(o.dict)) pageNums.push(num);
    const seen = new Set();
    let text = '';
    const contentOf = async (num) => {
      if (seen.has(num)) return ''; seen.add(num);
      const b = await streamBytes(objs.get(num));
      return b ? textFromContent(latin1(b), fonts) + '\n' : '';
    };
    for (const pn of pageNums.sort((a, b) => a - b)) {
      const d = objs.get(pn).dict;
      const arr = /\/Contents\s*\[([^\]]*)\]/.exec(d);
      const refs = arr ? Array.from(arr[1].matchAll(/(\d+)\s+\d+\s+R/g)).map(x => +x[1]) : (((/\/Contents\s+(\d+)\s+\d+\s+R/.exec(d)) || [])[1] ? [+/\/Contents\s+(\d+)\s+\d+\s+R/.exec(d)[1]] : []);
      for (const r of refs) {
        const o = objs.get(r);
        if (o && o.stream == null) { for (const x of o.dict.matchAll(/(\d+)\s+\d+\s+R/g)) text += await contentOf(+x[1]); }
        else text += await contentOf(r);
      }
      text += '\n';
    }
    if (!text.trim()) { // fallback: any stream with text operators
      for (const [num, o] of objs) if (o.stream != null && !seen.has(num)) {
        const b = await streamBytes(o);
        if (b) { const s = latin1(b); if (/\bBT\b[\s\S]*\bET\b/.test(s) && /T[jJ]/.test(s)) text += textFromContent(s, fonts) + '\n'; }
      }
    }
    text = text.replace(/\u0000/g, '').replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').replace(/[ \t]{2,}/g, ' ').trim();
    return { encrypted: false, text, pages: pageNums.length };
  }

  root.PDFText = { extract };
})(typeof window !== 'undefined' ? window : globalThis);
