/* GST working: registers, GSTR-1 JSON from books, GSTR-3B working, reconciliations. */
(function (root) {
  'use strict';
  const r2 = (n) => Math.round(((+n || 0) + Number.EPSILON) * 100) / 100;
  const RATES = [0, 0.1, 0.25, 1, 1.5, 3, 5, 6, 7.5, 12, 18, 28, 40];
  const snap = (r) => RATES.reduce((a, b) => Math.abs(b - r) < Math.abs(a - r) ? b : a, 0);
  const B2CL_LIMIT = 100000; // inter-state B2C invoices above this go to B2CL
  const ddmmyyyy = (iso) => { const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso || ''); return m ? `${m[3]}-${m[2]}-${m[1]}` : ''; };
  const toIso = (s) => {
    let m = /^(\d{2})[-/.](\d{2})[-/.](\d{4})$/.exec(String(s || '').trim());
    if (m) return `${m[3]}-${m[2]}-${m[1]}`;
    m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(s || ''));
    return m ? `${m[1]}-${m[2]}-${m[3]}` : '';
  };
  const live = (docs) => docs.filter(d => !d.cancelled);
  const taxOf = (d) => r2(d.igst + d.cgst + d.sgst);

  /* ---------- registers ---------- */
  function registers(docs) {
    const head = ['Date', 'Voucher type', 'Voucher no.', 'Supplier inv. no.', 'Supplier inv. date', 'Party', 'GSTIN', 'Place of supply',
      'Taxable value', 'IGST', 'CGST', 'SGST/UTGST', 'Cess', 'Invoice value', 'Effective rate %', 'Reverse charge', 'Notes'];
    const row = (d) => [d.date, d.vtype, d.number, d.refNo || '', d.refDate || '', d.party, d.gstin, d.pos, d.txval, d.igst, d.cgst, d.sgst,
      d.cess, d.total, d.effRate, d.rcm ? 'Yes' : '', d.flags.join('; ')];
    const money = [8, 9, 10, 11, 12, 13];
    const L = live(docs);
    const sheet = (name, kinds) => ({ name, money, rows: [head, ...L.filter(d => kinds.includes(d.kind)).sort((a, b) => a.date.localeCompare(b.date)).map(row)] });
    return [sheet('Sales register', ['sales']), sheet('Credit notes', ['credit']), sheet('Purchase register', ['purchase']), sheet('Debit notes', ['debit'])];
  }

  /* ---------- split a document into rate groups ---------- */
  function rateGroups(d) {
    const withRate = d.lines.filter(l => l.rate !== null && l.rate !== undefined && l.value);
    let groups;
    if (withRate.length && withRate.length === d.lines.length) {
      const byRate = new Map();
      d.lines.forEach(l => byRate.set(l.rate, (byRate.get(l.rate) || 0) + l.value));
      const linesTotal = Array.from(byRate.values()).reduce((a, b) => a + b, 0) || 1;
      groups = Array.from(byRate, ([rt, v]) => ({ rt: snap(rt), txval: d.txval * v / linesTotal }));
    } else {
      const rt = snap(d.effRate);
      groups = [{ rt, txval: d.txval }];
      if (d.txval && Math.abs(d.effRate - rt) > 0.3) d.flags.push(`Effective rate ${d.effRate}% is not a standard rate – check rate split`);
    }
    // share taxes in proportion to txval × rate so totals equal the books exactly
    const weight = groups.reduce((a, g) => a + g.txval * g.rt, 0);
    const heads = ['igst', 'cgst', 'sgst', 'cess'];
    const out = groups.map(g => ({ rt: g.rt, txval: r2(g.txval), igst: 0, cgst: 0, sgst: 0, cess: 0 }));
    heads.forEach(h => {
      let left = d[h];
      out.forEach((g, i) => {
        const share = i === out.length - 1 ? left : r2(weight ? d[h] * (groups[i].txval * groups[i].rt) / weight : d[h] * groups[i].txval / (d.txval || 1));
        g[h] = r2(share); left = r2(left - share);
      });
    });
    const txLeft = r2(d.txval - out.reduce((a, g) => a + g.txval, 0));
    if (out.length) out[out.length - 1].txval = r2(out[out.length - 1].txval + txLeft);
    return out;
  }
  const itm = (g, i) => ({ num: i + 1, itm_det: { txval: g.txval, rt: g.rt, iamt: g.igst, camt: g.cgst, samt: g.sgst, csamt: g.cess } });

  /* ---------- GSTR-1 from books ---------- */
  function buildGSTR1(docs, { gstin, fp, version }) {
    const own = (gstin || '').slice(0, 2);
    const L = live(docs);
    const exceptions = [];
    const json = { gstin, fp, version: version || 'GST2.2', hash: 'hash', b2b: [], b2cl: [], b2cs: [], cdnr: [], cdnur: [], hsn: { hsn_b2b: [], hsn_b2c: [] }, doc_issue: { doc_det: [] } };
    const b2bMap = new Map(), b2clMap = new Map(), b2csMap = new Map(), cdnrMap = new Map();
    const hsnMap = { b2b: new Map(), b2c: new Map() };

    const addHsn = (d, sign) => {
      const bucket = d.gstin ? hsnMap.b2b : hsnMap.b2c;
      if (!d.lines.length) { if (d.txval) exceptions.push({ doc: d, msg: 'No stock items – HSN/SAC summary needs manual entry' }); return; }
      const groupsTx = d.lines.reduce((a, l) => a + l.value, 0) || 1;
      d.lines.forEach(l => {
        if (!l.hsn) exceptions.push({ doc: d, msg: `Item “${l.item}” has no HSN in Tally` });
        const rt = snap(l.rate !== null && l.rate !== undefined ? l.rate : d.effRate);
        const key = `${l.hsn}|${l.uqc}|${rt}`;
        const share = l.value / groupsTx;
        const cur = bucket.get(key) || { hsn_sc: l.hsn || '', desc: (l.desc || '').slice(0, 30), user_desc: (l.desc || '').slice(0, 30), uqc: l.uqc || 'NA', qty: 0, rt, txval: 0, iamt: 0, camt: 0, samt: 0, csamt: 0 };
        cur.qty = r2(cur.qty + sign * l.qty);
        cur.txval = r2(cur.txval + sign * d.txval * share);
        cur.iamt = r2(cur.iamt + sign * d.igst * share); cur.camt = r2(cur.camt + sign * d.cgst * share);
        cur.samt = r2(cur.samt + sign * d.sgst * share); cur.csamt = r2(cur.csamt + sign * d.cess * share);
        bucket.set(key, cur);
      });
    };

    for (const d of L) {
      if (d.kind !== 'sales' && d.kind !== 'credit') continue;
      if (d.export) { exceptions.push({ doc: d, msg: 'Export / SEZ / deemed export – enter in EXP/SEZ tables yourself' }); continue; }
      const groups = rateGroups(d);
      const inter = d.pos !== own;
      if (d.kind === 'sales') {
        if (d.gstin) {
          const p = b2bMap.get(d.gstin) || { ctin: d.gstin, inv: [] };
          p.inv.push({ inum: d.number, idt: ddmmyyyy(d.date), val: d.total, pos: d.pos, rchrg: d.rcm ? 'Y' : 'N', inv_typ: 'R', itms: groups.map(itm) });
          b2bMap.set(d.gstin, p);
        } else if (inter && d.total > B2CL_LIMIT) {
          const p = b2clMap.get(d.pos) || { pos: d.pos, inv: [] };
          p.inv.push({ inum: d.number, idt: ddmmyyyy(d.date), val: d.total, itms: groups.map((g, i) => ({ num: i + 1, itm_det: { txval: g.txval, rt: g.rt, iamt: g.igst, csamt: g.cess } })) });
          b2clMap.set(d.pos, p);
        } else {
          groups.forEach(g => {
            const key = `${inter ? 'INTER' : 'INTRA'}|${d.pos}|${g.rt}`;
            const c = b2csMap.get(key) || { sply_ty: inter ? 'INTER' : 'INTRA', pos: d.pos, typ: 'OE', rt: g.rt, txval: 0, iamt: 0, camt: 0, samt: 0, csamt: 0 };
            c.txval = r2(c.txval + g.txval); c.iamt = r2(c.iamt + g.igst); c.camt = r2(c.camt + g.cgst); c.samt = r2(c.samt + g.sgst); c.csamt = r2(c.csamt + g.cess);
            b2csMap.set(key, c);
          });
        }
        addHsn(d, 1);
      } else { // credit note on sales
        if (d.gstin) {
          const p = cdnrMap.get(d.gstin) || { ctin: d.gstin, nt: [] };
          p.nt.push({ ntty: 'C', nt_num: d.number, nt_dt: ddmmyyyy(d.date), val: d.total, pos: d.pos, rchrg: 'N', inv_typ: 'R', itms: groups.map(itm) });
          cdnrMap.set(d.gstin, p);
        } else if (inter && d.total > B2CL_LIMIT) {
          json.cdnur.push({ typ: 'B2CL', ntty: 'C', nt_num: d.number, nt_dt: ddmmyyyy(d.date), val: d.total, pos: d.pos, itms: groups.map(itm) });
        } else {
          groups.forEach(g => {
            const key = `${inter ? 'INTER' : 'INTRA'}|${d.pos}|${g.rt}`;
            const c = b2csMap.get(key) || { sply_ty: inter ? 'INTER' : 'INTRA', pos: d.pos, typ: 'OE', rt: g.rt, txval: 0, iamt: 0, camt: 0, samt: 0, csamt: 0 };
            c.txval = r2(c.txval - g.txval); c.iamt = r2(c.iamt - g.igst); c.camt = r2(c.camt - g.cgst); c.samt = r2(c.samt - g.sgst); c.csamt = r2(c.csamt - g.cess);
            b2csMap.set(key, c);
          });
        }
        addHsn(d, -1);
      }
    }
    json.b2b = Array.from(b2bMap.values());
    json.b2cl = Array.from(b2clMap.values());
    json.b2cs = Array.from(b2csMap.values()).filter(c => c.txval || c.iamt || c.camt);
    json.cdnr = Array.from(cdnrMap.values());
    json.b2cs.forEach(c => { if (c.sply_ty === 'INTER') { delete c.camt; delete c.samt; } else delete c.iamt; });
    let n = 0;
    json.hsn.hsn_b2b = Array.from(hsnMap.b2b.values()).map(h => ({ num: ++n, ...h }));
    n = 0;
    json.hsn.hsn_b2c = Array.from(hsnMap.b2c.values()).map(h => ({ num: ++n, ...h }));

    // Table 13: documents issued, per voucher type series
    const series = new Map();
    docs.filter(d => d.kind === 'sales' || d.kind === 'credit').forEach(d => {
      const k = `${d.kind}|${d.vtype}`;
      const s = series.get(k) || { kind: d.kind, nums: [], cancel: 0 };
      if (d.number) s.nums.push(d.number);
      if (d.cancelled) s.cancel++;
      series.set(k, s);
    });
    const byNum = (a, b) => a.localeCompare(b, undefined, { numeric: true });
    const inv = [], cn = [];
    for (const s of series.values()) {
      if (!s.nums.length) continue;
      const sorted = s.nums.slice().sort(byNum);
      const docRow = { from: sorted[0], to: sorted[sorted.length - 1], totnum: sorted.length, cancel: s.cancel, net_issue: sorted.length - s.cancel };
      (s.kind === 'sales' ? inv : cn).push(docRow);
    }
    if (inv.length) json.doc_issue.doc_det.push({ doc_num: 1, docs: inv.map((d, i) => ({ num: i + 1, ...d })) });
    if (cn.length) json.doc_issue.doc_det.push({ doc_num: 5, docs: cn.map((d, i) => ({ num: i + 1, ...d })) });

    for (const k of ['b2b', 'b2cl', 'b2cs', 'cdnr', 'cdnur']) if (!json[k].length) delete json[k];
    for (const d of L) if ((d.kind === 'sales' || d.kind === 'credit') && d.flags.length) d.flags.forEach(f => exceptions.push({ doc: d, msg: f }));
    const totals = {
      invoices: L.filter(d => d.kind === 'sales').length,
      txval: r2(L.filter(d => d.kind === 'sales').reduce((a, d) => a + d.txval, 0) - L.filter(d => d.kind === 'credit').reduce((a, d) => a + d.txval, 0))
    };
    return { json, exceptions, totals };
  }

  /* ---------- portal files → comparable documents ---------- */
  function unwrap(j) {
    let o = j;
    for (let i = 0; i < 3 && o && o.data && !o.docdata && !o.b2b; i++) o = o.data;
    return o || {};
  }
  const sumItems = (items, map) => (items || []).reduce((a, it) => {
    const d = it.itm_det || it;
    a.txval += +d[map.txval] || 0; a.igst += +d[map.igst] || 0; a.cgst += +d[map.cgst] || 0; a.sgst += +d[map.sgst] || 0; a.cess += +d[map.cess] || 0;
    return a;
  }, { txval: 0, igst: 0, cgst: 0, sgst: 0, cess: 0 });
  const M2B = { txval: 'txval', igst: 'igst', cgst: 'cgst', sgst: 'sgst', cess: 'cess' };
  const MR1 = { txval: 'txval', igst: 'iamt', cgst: 'camt', sgst: 'samt', cess: 'csamt' };

  function parse2B(j) {
    const o = unwrap(j);
    const dd = o.docdata || {};
    const out = [];
    const push = (sec, sup, doc, type, numKey) => {
      const s = doc.items ? sumItems(doc.items, M2B) : { txval: +doc.txval || 0, igst: +doc.igst || 0, cgst: +doc.cgst || 0, sgst: +doc.sgst || 0, cess: +doc.cess || 0 };
      const sign = type === 'CN' ? -1 : 1;
      out.push({ section: sec, gstin: sup.ctin || '', name: sup.trdnm || '', num: String(doc[numKey] || ''), date: toIso(doc.dt), type,
        txval: r2(sign * s.txval), igst: r2(sign * s.igst), cgst: r2(sign * s.cgst), sgst: r2(sign * s.sgst), cess: r2(sign * s.cess),
        total: r2(sign * (+doc.val || 0)), itcavl: doc.itcavl || '', rev: doc.rev || 'N', rsn: doc.rsn || '', period: sup.supprd || '', pos: doc.pos || '' });
    };
    (dd.b2b || []).forEach(s => (s.inv || []).forEach(i => push('B2B', s, i, 'INV', 'inum')));
    (dd.b2ba || []).forEach(s => (s.inv || []).forEach(i => push('B2BA', s, i, 'INV', 'inum')));
    (dd.ecom || []).forEach(s => (s.inv || []).forEach(i => push('ECOM', s, i, 'INV', 'inum')));
    (dd.cdnr || []).forEach(s => (s.nt || []).forEach(n => push('CDNR', s, n, n.typ === 'D' ? 'DN' : 'CN', 'ntnum')));
    (dd.cdnra || []).forEach(s => (s.nt || []).forEach(n => push('CDNRA', s, n, n.typ === 'D' ? 'DN' : 'CN', 'ntnum')));
    (dd.impg || []).forEach(b => out.push({ section: 'IMPG', gstin: '', name: 'Import of goods', num: String(b.boenum || ''), date: toIso(b.boedt), type: 'BOE',
      txval: r2(+b.txval || 0), igst: r2(+b.igst || 0), cgst: 0, sgst: 0, cess: r2(+b.cess || 0), total: 0, itcavl: 'Y', rev: 'N', rsn: '' }));
    (dd.impgsez || []).forEach(s => (s.boe || []).forEach(b => out.push({ section: 'IMPGSEZ', gstin: s.ctin || '', name: s.trdnm || '', num: String(b.boenum || ''),
      date: toIso(b.boedt), type: 'BOE', txval: r2(+b.txval || 0), igst: r2(+b.igst || 0), cgst: 0, sgst: 0, cess: r2(+b.cess || 0), total: 0, itcavl: 'Y', rev: 'N', rsn: '' })));
    (dd.isd || []).forEach(s => (s.doclist || []).forEach(x => out.push({ section: 'ISD', gstin: s.ctin || '', name: s.trdnm || '', num: String(x.docnum || ''),
      date: toIso(x.docdt), type: x.doctyp === 'C' ? 'CN' : 'INV', txval: 0, igst: r2(+x.igst || 0), cgst: r2(+x.cgst || 0), sgst: r2(+x.sgst || 0),
      cess: r2(+x.cess || 0), total: 0, itcavl: x.itcelg === 'N' ? 'N' : 'Y', rev: 'N', rsn: '' })));
    return { gstin: o.gstin || '', period: o.rtnprd || '', docs: out };
  }

  function parseGSTR1(j) {
    const o = unwrap(j);
    const out = [];
    (o.b2b || []).forEach(s => (s.inv || []).forEach(i => {
      const t = sumItems(i.itms, MR1);
      out.push({ section: 'B2B', gstin: s.ctin, name: '', num: String(i.inum), date: toIso(i.idt), type: 'INV', ...rnd(t), total: r2(+i.val || 0), pos: i.pos });
    }));
    (o.b2cl || []).forEach(s => (s.inv || []).forEach(i => {
      const t = sumItems(i.itms, MR1);
      out.push({ section: 'B2CL', gstin: '', name: '', num: String(i.inum), date: toIso(i.idt), type: 'INV', ...rnd(t), total: r2(+i.val || 0), pos: s.pos });
    }));
    (o.cdnr || []).forEach(s => (s.nt || []).forEach(n => {
      const t = sumItems(n.itms, MR1), sign = n.ntty === 'D' ? 1 : -1;
      out.push({ section: 'CDNR', gstin: s.ctin, name: '', num: String(n.nt_num), date: toIso(n.nt_dt), type: n.ntty === 'D' ? 'DN' : 'CN',
        txval: r2(sign * t.txval), igst: r2(sign * t.igst), cgst: r2(sign * t.cgst), sgst: r2(sign * t.sgst), cess: r2(sign * t.cess), total: r2(sign * (+n.val || 0)) });
    }));
    const b2cs = (o.b2cs || []).reduce((a, c) => { a.txval += +c.txval || 0; a.igst += +c.iamt || 0; a.cgst += +c.camt || 0; a.sgst += +c.samt || 0; a.cess += +c.csamt || 0; return a; },
      { txval: 0, igst: 0, cgst: 0, sgst: 0, cess: 0 });
    return { gstin: o.gstin || '', period: o.fp || o.ret_period || '', docs: out, b2cs: rnd(b2cs) };
  }
  const rnd = (t) => ({ txval: r2(t.txval), igst: r2(t.igst), cgst: r2(t.cgst), sgst: r2(t.sgst), cess: r2(t.cess) });

  /* ---------- reconciliation ---------- */
  const normNum = (s) => String(s || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  const looseNum = (s) => {
    let t = String(s || '').toUpperCase().replace(/\b(20)?\d{2}\s*[-/]\s*(20)?\d{2}\b/g, ' '); // drop FY like 2025-26 / 25-26
    t = t.replace(/[^A-Z0-9]/g, '');
    const digits = t.replace(/\D/g, '').replace(/^0+/, '');
    return digits || t;
  };

  // books: documents from Tally (purchase side uses supplier ref no.), portal: parsed portal docs
  function reconcile(booksIn, portalIn, { side, tolerance }) {
    const tol = tolerance === undefined ? 1 : +tolerance;
    const books = booksIn.map(d => ({
      src: d, gstin: d.gstin || '', num: side === 'purchase' ? (d.refNo || d.number) : d.number, date: side === 'purchase' ? (d.refDate || d.date) : d.date,
      type: d.kind === 'credit' ? (side === 'purchase' ? 'DN' : 'CN') : d.kind === 'debit' ? (side === 'purchase' ? 'CN' : 'DN') : 'INV',
      name: d.party, sign: (d.kind === 'credit' && side === 'sales') || (d.kind === 'debit' && side === 'purchase') ? -1 : 1,
      txval: d.txval, igst: d.igst, cgst: d.cgst, sgst: d.sgst, cess: d.cess, total: d.total
    })).map(b => ({ ...b, txval: r2(b.sign * b.txval), igst: r2(b.sign * b.igst), cgst: r2(b.sign * b.cgst), sgst: r2(b.sign * b.sgst), cess: r2(b.sign * b.cess), total: r2(b.sign * b.total) }));
    const portal = portalIn.map(p => ({ ...p }));
    const used = new Set();
    const rows = [];
    const diffOf = (b, p) => ({ txval: r2(b.txval - p.txval), igst: r2(b.igst - p.igst), cgst: r2(b.cgst - p.cgst), sgst: r2(b.sgst - p.sgst), cess: r2(b.cess - p.cess) });
    const same = (dfx) => Object.values(dfx).every(v => Math.abs(v) <= tol);

    const index = (fn) => { const m = new Map(); portal.forEach((p, i) => { const k = fn(p); if (!k) return; if (!m.has(k)) m.set(k, []); m.get(k).push(i); }); return m; };
    const exact = index(p => normNum(p.num) && `${p.gstin || ''}|${normNum(p.num)}`);
    const loose = index(p => looseNum(p.num) && `${p.gstin || ''}|${looseNum(p.num)}`);
    const byNum = index(p => normNum(p.num));
    const take = (list) => (list || []).find(i => !used.has(i));

    for (const b of books) {
      let i = take(exact.get(`${b.gstin || ''}|${normNum(b.num)}`)), how = 'exact';
      if (i === undefined) { i = take(loose.get(`${b.gstin || ''}|${looseNum(b.num)}`)); how = 'loose'; }
      let gstinDiff = false;
      if (i === undefined && normNum(b.num)) {
        const cand = take((byNum.get(normNum(b.num)) || []).filter(k => Math.abs(portal[k].total - b.total) <= Math.max(tol, 1) || same(diffOf(b, portal[k]))));
        if (cand !== undefined) { i = cand; gstinDiff = true; how = 'number'; }
      }
      if (i === undefined) { rows.push({ status: side === 'purchase' ? 'Only in books' : 'Only in books (not in GSTR-1)', b, p: null, diff: null }); continue; }
      used.add(i);
      const p = portal[i];
      const dfx = diffOf(b, p);
      let status = same(dfx) ? 'Matched' : 'Value mismatch';
      const notes = [];
      if (gstinDiff) { status = 'GSTIN differs'; notes.push(`Books ${b.gstin || '(blank)'} vs portal ${p.gstin}`); }
      if (how === 'loose') notes.push(`Invoice no. books “${b.num}” vs portal “${p.num}”`);
      if (b.date && p.date && b.date !== p.date) notes.push('Date differs');
      rows.push({ status, b, p, diff: dfx, notes });
    }
    portal.forEach((p, i) => { if (!used.has(i)) rows.push({ status: side === 'purchase' ? 'Only in 2B' : 'Only in GSTR-1', b: null, p, diff: null }); });

    const summary = {};
    rows.forEach(r => {
      const s = summary[r.status] || (summary[r.status] = { count: 0, booksTax: 0, portalTax: 0 });
      s.count++;
      if (r.b) s.booksTax = r2(s.booksTax + r.b.igst + r.b.cgst + r.b.sgst);
      if (r.p) s.portalTax = r2(s.portalTax + r.p.igst + r.p.cgst + r.p.sgst);
    });
    return { rows, summary };
  }

  function reconSheets(res, side) {
    const other = side === 'purchase' ? '2B' : 'GSTR-1';
    const head = ['Status', 'GSTIN (books)', 'GSTIN (portal)', 'Party / supplier', 'Inv. no. (books)', 'Inv. no. (portal)', 'Date (books)', 'Date (portal)',
      'Taxable (books)', `Taxable (${other})`, 'IGST (books)', `IGST (${other})`, 'CGST (books)', `CGST (${other})`, 'SGST (books)', `SGST (${other})`,
      'Cess (books)', `Cess (${other})`, 'Tax difference', 'ITC available (2B)', 'Notes'];
    const order = ['Value mismatch', 'GSTIN differs', 'Only in books', 'Only in books (not in GSTR-1)', 'Only in 2B', 'Only in GSTR-1', 'Matched'];
    const rows = res.rows.slice().sort((a, b) => order.indexOf(a.status) - order.indexOf(b.status));
    const body = rows.map(r => {
      const b = r.b || {}, p = r.p || {};
      const bt = r.b ? b.igst + b.cgst + b.sgst : 0, pt = r.p ? p.igst + p.cgst + p.sgst : 0;
      return [r.status, b.gstin || '', p.gstin || '', b.name || p.name || '', b.num || '', p.num || '', b.date || '', p.date || '',
        r.b ? b.txval : '', r.p ? p.txval : '', r.b ? b.igst : '', r.p ? p.igst : '', r.b ? b.cgst : '', r.p ? p.cgst : '', r.b ? b.sgst : '', r.p ? p.sgst : '',
        r.b ? b.cess : '', r.p ? p.cess : '', r2(bt - pt), p.itcavl || '', (r.notes || []).join('; ')];
    });
    const sumRows = [['Status', 'Documents', 'Tax as per books', `Tax as per ${other}`],
      ...Object.entries(res.summary).map(([k, v]) => [k, v.count, v.booksTax, v.portalTax])];
    return [{ name: 'Summary', rows: sumRows, money: [2, 3] }, { name: 'Details', rows: [head, ...body], money: [8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18] }];
  }

  /* ---------- GSTR-3B working ---------- */
  function threeB(docs, twoB, ownGstin) {
    const own = (ownGstin || '').slice(0, 2);
    const L = live(docs);
    const z = () => ({ txval: 0, igst: 0, cgst: 0, sgst: 0, cess: 0 });
    const add = (a, d, s = 1) => { a.txval = r2(a.txval + s * d.txval); a.igst = r2(a.igst + s * d.igst); a.cgst = r2(a.cgst + s * d.cgst); a.sgst = r2(a.sgst + s * d.sgst); a.cess = r2(a.cess + s * d.cess); };
    const t = { a: z(), b: z(), c: z(), d: z(), inter: {}, booksItc: z(), booksRcm: z() };
    for (const d of L) {
      if (d.kind === 'sales' || d.kind === 'credit') {
        const s = d.kind === 'credit' ? -1 : 1;
        if (d.export) add(t.b, d, s);
        else if (taxOf(d) + d.cess > 0) add(t.a, d, s);
        else add(t.c, d, s);
        if (!d.gstin && !d.export && d.pos && d.pos !== own && taxOf(d) > 0) {
          const k = d.pos;
          t.inter[k] = t.inter[k] || { txval: 0, igst: 0 };
          t.inter[k].txval = r2(t.inter[k].txval + s * d.txval); t.inter[k].igst = r2(t.inter[k].igst + s * d.igst);
        }
      } else if (d.kind === 'purchase' || d.kind === 'debit') {
        const s = d.kind === 'debit' ? -1 : 1;
        if (d.rcm) { add(t.d, d, s); add(t.booksRcm, d, s); } else add(t.booksItc, d, s);
      }
    }
    const itc = { imports: z(), rcm2b: z(), isd: z(), other: z(), notAvail: z() };
    if (twoB) for (const p of twoB.docs) {
      const target = p.itcavl === 'N' ? itc.notAvail : p.section.startsWith('IMPG') ? itc.imports : p.section === 'ISD' ? itc.isd : p.rev === 'Y' ? itc.rcm2b : itc.other;
      add(target, p);
    }
    return { ...t, itc, own };
  }

  function threeBSheet(w, twoB) {
    const row = (label, a, note) => [label, a ? a.txval : '', a ? a.igst : '', a ? a.cgst : '', a ? a.sgst : '', a ? a.cess : '', note || ''];
    const rows = [['GSTR-3B table', 'Taxable value', 'IGST', 'CGST', 'SGST/UTGST', 'Cess', 'Source / note'],
      row('3.1(a) Outward taxable supplies (other than zero/nil/exempt)', w.a, 'Tally sales less credit notes'),
      row('3.1(b) Outward zero-rated supplies (export/SEZ)', w.b, 'Parties marked SEZ/export/overseas in Tally'),
      row('3.1(c) Nil rated / exempted supplies', w.c, 'Sales with no GST charged'),
      row('3.1(d) Inward supplies liable to reverse charge', w.d, 'Tally purchases marked reverse charge'),
      [''], ['3.2 Inter-state supplies to unregistered persons – place of supply', 'Taxable value', 'IGST'],
      ...Object.entries(w.inter).map(([pos, v]) => [`${pos} – ${(root.GSTR && root.GSTR.stateName(pos)) || ''}`, v.txval, v.igst]),
      [''], ['4. Eligible ITC', 'Taxable value', 'IGST', 'CGST', 'SGST/UTGST', 'Cess', ''],
      row('4A(1) Import of goods', twoB ? w.itc.imports : null, twoB ? 'GSTR-2B IMPG / IMPGSEZ' : 'Load GSTR-2B'),
      row('4A(3) Inward supplies liable to reverse charge', w.booksRcm, 'Tally (RCM paid in cash is claimable)'),
      row('4A(4) Inward supplies from ISD', twoB ? w.itc.isd : null, twoB ? 'GSTR-2B ISD' : ''),
      row('4A(5) All other ITC', twoB ? w.itc.other : null, twoB ? 'GSTR-2B B2B + CDNR (ITC available = Yes)' : 'Load GSTR-2B'),
      row('ITC not available as per GSTR-2B', twoB ? w.itc.notAvail : null, 'Do not claim; keep for reference'),
      [''], ['Comparison', 'Taxable value', 'IGST', 'CGST', 'SGST/UTGST', 'Cess', ''],
      row('ITC as per books (Tally purchases, non-RCM)', w.booksItc, ''),
      row('ITC as per GSTR-2B (4A(5))', twoB ? w.itc.other : null, ''),
      row('Difference (books − 2B)', twoB ? { txval: r2(w.booksItc.txval - w.itc.other.txval), igst: r2(w.booksItc.igst - w.itc.other.igst), cgst: r2(w.booksItc.cgst - w.itc.other.cgst), sgst: r2(w.booksItc.sgst - w.itc.other.sgst), cess: r2(w.booksItc.cess - w.itc.other.cess) } : null, 'See the 2B reconciliation for the invoices behind this')
    ];
    return [{ name: 'GSTR-3B working', rows, money: [1, 2, 3, 4, 5], widths: [62, 16, 14, 14, 14, 12, 46] }];
  }

  root.GSTWork = { registers, buildGSTR1, parse2B, parseGSTR1, reconcile, reconSheets, threeB, threeBSheet, rateGroups, snap, r2, toIso, ddmmyyyy, normNum, looseNum };
})(typeof window !== 'undefined' ? window : globalThis);
