/* TallyPrime connector over the ODBC/XML port (default 9000).
   In TallyPrime: F1 Help → Settings → Connectivity → Client/Server configuration:
   "TallyPrime acts as" = Both (or Server), "Enable ODBC" = Yes, Port = 9000. Keep the company open. */
(function (root) {
  'use strict';
  const G = root.GSTR;

  /* ---------- transport ---------- */
  async function post(url, xml) {
    let res;
    try {
      res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'text/xml;charset=utf-8' }, body: xml });
    } catch (e) {
      throw new Error(`Cannot reach Tally at ${url}. Is TallyPrime open with ODBC/server enabled on this port?`);
    }
    if (!res.ok) throw new Error(`Tally replied with HTTP ${res.status}`);
    const buf = new Uint8Array(await res.arrayBuffer());
    let text;
    if (buf[0] === 0xFF && buf[1] === 0xFE) text = new TextDecoder('utf-16le').decode(buf);
    else if (buf[0] === 0xFE && buf[1] === 0xFF) text = new TextDecoder('utf-16be').decode(buf);
    else if (buf.length > 3 && buf[1] === 0 && buf[3] === 0) text = new TextDecoder('utf-16le').decode(buf);
    else text = new TextDecoder('utf-8').decode(buf);
    return text;
  }

  function parseXml(text) {
    const clean = text
      .replace(/^﻿/, '')
      .replace(/&#(x?)([0-9a-f]+);/gi, (m, hex, n) => {
        const c = parseInt(n, hex ? 16 : 10);
        return (c < 32 && c !== 9 && c !== 10 && c !== 13) ? '' : m;
      })
      .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '');
    const doc = new DOMParser().parseFromString(clean, 'text/xml');
    const err = doc.getElementsByTagName('parsererror')[0];
    if (err) throw new Error('Tally sent data that could not be read (' + err.textContent.slice(0, 120) + ')');
    const line = doc.getElementsByTagName('LINEERROR')[0];
    if (line) throw new Error('Tally: ' + line.textContent.trim());
    return doc;
  }

  const kids = (el, tag) => el ? Array.from(el.children).filter(c => c.tagName === tag) : [];
  const kid = (el, tag) => kids(el, tag)[0] || null;
  const txt = (el, tag) => { const k = kid(el, tag); return k ? k.textContent.trim() : ''; };
  const deep = (el, tag) => { const all = el ? el.getElementsByTagName(tag) : []; for (const n of all) { const t = n.textContent.trim(); if (t) return t; } return ''; };
  const yes = (v) => /^yes$/i.test(String(v || '').trim());
  const num = (v) => { const n = parseFloat(String(v || '').replace(/[^0-9.\-]/g, '')); return isFinite(n) ? n : 0; };
  const nameOf = (el) => el.getAttribute('NAME') || txt(el, 'NAME') || deep(kid(el, 'LANGUAGENAME.LIST'), 'NAME');
  const r2 = (n) => Math.round((n + Number.EPSILON) * 100) / 100;
  const tDate = (s) => { const m = /^(\d{4})(\d{2})(\d{2})/.exec(s || ''); return m ? `${m[1]}-${m[2]}-${m[3]}` : ''; };
  const xesc = (s) => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

  /* ---------- requests ---------- */
  const reqCompanies = () => `<ENVELOPE><HEADER><VERSION>1</VERSION><TALLYREQUEST>Export</TALLYREQUEST><TYPE>Collection</TYPE><ID>GSTDeskCompanies</ID></HEADER>
<BODY><DESC><STATICVARIABLES><SVEXPORTFORMAT>$$SysName:XML</SVEXPORTFORMAT></STATICVARIABLES>
<TDL><TDLMESSAGE><COLLECTION NAME="GSTDeskCompanies" ISMODIFY="No"><TYPE>Company</TYPE><FETCH>NAME, STARTINGFROM, BOOKSFROM</FETCH></COLLECTION></TDLMESSAGE></TDL>
</DESC></BODY></ENVELOPE>`;

  const reqMasters = (company) => `<ENVELOPE><HEADER><TALLYREQUEST>Export Data</TALLYREQUEST></HEADER><BODY><EXPORTDATA><REQUESTDESC>
<REPORTNAME>List of Accounts</REPORTNAME><STATICVARIABLES><SVCURRENTCOMPANY>${xesc(company)}</SVCURRENTCOMPANY>
<SVEXPORTFORMAT>$$SysName:XML</SVEXPORTFORMAT><ACCOUNTTYPE>All Masters</ACCOUNTTYPE></STATICVARIABLES>
</REQUESTDESC></EXPORTDATA></BODY></ENVELOPE>`;

  const reqVouchers = (company, from, to) => `<ENVELOPE><HEADER><TALLYREQUEST>Export Data</TALLYREQUEST></HEADER><BODY><EXPORTDATA><REQUESTDESC>
<REPORTNAME>Day Book</REPORTNAME><STATICVARIABLES><SVCURRENTCOMPANY>${xesc(company)}</SVCURRENTCOMPANY>
<SVFROMDATE TYPE="Date">${from.replace(/-/g, '')}</SVFROMDATE><SVTODATE TYPE="Date">${to.replace(/-/g, '')}</SVTODATE>
<SVEXPORTFORMAT>$$SysName:XML</SVEXPORTFORMAT><EXPLODEFLAG>Yes</EXPLODEFLAG></STATICVARIABLES>
</REQUESTDESC></EXPORTDATA></BODY></ENVELOPE>`;

  /* ---------- masters ---------- */
  const DUTY = (s) => {
    const t = String(s || '').toLowerCase();
    if (/integrated|igst/.test(t)) return 'igst';
    if (/central|cgst/.test(t)) return 'cgst';
    if (/state|sgst|utgst|union territory/.test(t)) return 'sgst';
    if (/cess/.test(t)) return 'cess';
    return '';
  };
  const UQC = { nos: 'NOS', no: 'NOS', number: 'NOS', numbers: 'NOS', pcs: 'PCS', pc: 'PCS', piece: 'PCS', pieces: 'PCS', kg: 'KGS', kgs: 'KGS',
    kilogram: 'KGS', kilograms: 'KGS', gm: 'GMS', gms: 'GMS', g: 'GMS', gram: 'GMS', grams: 'GMS', ltr: 'LTR', ltrs: 'LTR', litre: 'LTR', l: 'LTR',
    ml: 'MLT', mtr: 'MTR', mtrs: 'MTR', m: 'MTR', metre: 'MTR', box: 'BOX', boxes: 'BOX', bag: 'BAG', bags: 'BAG', set: 'SET', sets: 'SET',
    pair: 'PRS', pairs: 'PRS', doz: 'DOZ', dozen: 'DOZ', bdl: 'BDL', bundle: 'BDL', btl: 'BTL', bottle: 'BTL', ctn: 'CTN', carton: 'CTN',
    can: 'CAN', drm: 'DRM', drum: 'DRM', qtl: 'QTL', ton: 'TON', tonne: 'TON', mt: 'MTS', sqm: 'SQM', sqf: 'SQF', sqft: 'SQF', roll: 'ROL',
    rolls: 'ROL', unit: 'UNT', units: 'UNT', pkt: 'PAC', pack: 'PAC', packet: 'PAC', tbs: 'TBS', tab: 'TBS', km: 'KME', cbm: 'CBM', gross: 'GRS' };
  const uqcOf = (u) => UQC[String(u || '').trim().toLowerCase().replace(/\.$/, '')] || (u ? 'OTH' : 'NA');

  function parseMasters(doc) {
    const groups = {}, ledgers = {}, vtypes = {}, items = {};
    for (const g of doc.getElementsByTagName('GROUP')) { const n = nameOf(g); if (n) groups[n] = txt(g, 'PARENT'); }
    for (const v of doc.getElementsByTagName('VOUCHERTYPE')) { const n = nameOf(v); if (n) vtypes[n] = txt(v, 'PARENT'); }
    for (const l of doc.getElementsByTagName('LEDGER')) {
      const n = nameOf(l);
      if (!n) continue;
      const regEl = kid(l, 'LEDGSTREGDETAILS.LIST');
      const regs = kids(l, 'LEDGSTREGDETAILS.LIST');
      const lastReg = regs[regs.length - 1] || regEl;
      ledgers[n] = {
        parent: txt(l, 'PARENT'),
        gstin: (txt(l, 'PARTYGSTIN') || deep(lastReg, 'GSTIN') || txt(l, 'GSTIN')).toUpperCase(),
        regType: txt(l, 'GSTREGISTRATIONTYPE') || deep(lastReg, 'GSTREGISTRATIONTYPE'),
        state: txt(l, 'LEDSTATENAME') || deep(kid(l, 'LEDMAILINGDETAILS.LIST'), 'STATE') || txt(l, 'STATENAME') || deep(lastReg, 'STATE'),
        country: txt(l, 'COUNTRYOFRESIDENCE') || deep(kid(l, 'LEDMAILINGDETAILS.LIST'), 'COUNTRY'),
        duty: DUTY(txt(l, 'GSTDUTYHEAD')),
        taxType: txt(l, 'TAXTYPE')
      };
    }
    for (const s of doc.getElementsByTagName('STOCKITEM')) {
      const n = nameOf(s);
      if (!n) continue;
      let rate = '';
      for (const rd of s.getElementsByTagName('RATEDETAILS.LIST')) {
        if (/integrated|igst/i.test(txt(rd, 'GSTRATEDUTYHEAD'))) { const v = txt(rd, 'GSTRATE'); if (v !== '') rate = num(v); }
      }
      items[n] = { hsn: deep(s, 'HSNCODE') || deep(s, 'HSN'), rate: rate === '' ? null : rate, unit: txt(s, 'BASEUNITS'),
        desc: deep(s, 'HSNDESCRIPTION') || deep(s, 'HSNMASTERNAME') };
    }
    return { groups, ledgers, vtypes, items };
  }

  function under(m, ledgerName, groupRx) {
    let g = m.ledgers[ledgerName] ? m.ledgers[ledgerName].parent : '';
    for (let i = 0; g && i < 20; i++) {
      if (groupRx.test(g)) return true;
      const p = m.groups[g];
      if (!p || p === g || /^primary$/i.test(p)) return groupRx.test(p || '');
      g = p;
    }
    return false;
  }
  function baseType(m, vt) {
    let t = vt;
    for (let i = 0; t && i < 15; i++) {
      if (/^(sales|purchase|credit note|debit note|journal|receipt|payment|contra)$/i.test(t)) return t.toLowerCase();
      const p = m.vtypes[t];
      if (!p || p === t) break;
      t = p;
    }
    return String(t || vt || '').toLowerCase();
  }

  /* ---------- vouchers → GST documents ---------- */
  function toDocs(doc, m, opts) {
    const own = opts.ownStateCode || '';
    const out = [];
    for (const v of doc.getElementsByTagName('VOUCHER')) {
      if (yes(txt(v, 'ISCANCELLED')) || yes(txt(v, 'ISOPTIONAL')) || yes(txt(v, 'ISDELETED'))) {
        const vt0 = txt(v, 'VOUCHERTYPENAME') || v.getAttribute('VCHTYPE') || '';
        const b0 = baseType(m, vt0);
        if (b0 === 'sales' && yes(txt(v, 'ISCANCELLED'))) out.push({ kind: 'sales', cancelled: true, vtype: vt0, number: txt(v, 'VOUCHERNUMBER'), date: tDate(txt(v, 'DATE')) });
        continue;
      }
      const vt = txt(v, 'VOUCHERTYPENAME') || v.getAttribute('VCHTYPE') || '';
      const base = baseType(m, vt);
      const kind = base === 'sales' ? 'sales' : base === 'purchase' ? 'purchase' : base === 'credit note' ? 'credit' : base === 'debit note' ? 'debit' : '';
      if (!kind) continue;
      const party = txt(v, 'PARTYLEDGERNAME') || txt(v, 'PARTYNAME');
      const pl = m.ledgers[party] || {};
      const led = kids(v, 'ALLLEDGERENTRIES.LIST').length ? kids(v, 'ALLLEDGERENTRIES.LIST') : kids(v, 'LEDGERENTRIES.LIST');
      const inv = kids(v, 'ALLINVENTORYENTRIES.LIST').length ? kids(v, 'ALLINVENTORYENTRIES.LIST') : kids(v, 'INVENTORYENTRIES.LIST');
      const d = { kind, vtype: vt, date: tDate(txt(v, 'DATE')), number: txt(v, 'VOUCHERNUMBER'), refNo: txt(v, 'REFERENCE'),
        refDate: tDate(txt(v, 'REFERENCEDATE')), party, gstin: (txt(v, 'PARTYGSTIN') || pl.gstin || '').toUpperCase(),
        regType: txt(v, 'GSTREGISTRATIONTYPE') || pl.regType || '', txval: 0, igst: 0, cgst: 0, sgst: 0, cess: 0, other: 0, total: 0, lines: [], flags: [] };
      const posName = txt(v, 'PLACEOFSUPPLY') || txt(v, 'STATENAME') || pl.state;
      d.pos = G.stateCode(posName) || (d.gstin ? d.gstin.slice(0, 2) : '') || own;
      d.rcm = ['ISREVERSECHARGEAPPLICABLE', 'REVERSECHARGE', 'ISRCMAPPLICABLE'].some(t => yes(txt(v, t)));
      const country = txt(v, 'COUNTRYOFRESIDENCE') || pl.country;
      d.export = /sez|overseas|export|deemed/i.test(d.regType) || (country && !/^india$/i.test(country));
      let partyAmt = 0;
      for (const e of led) {
        const ln = txt(e, 'LEDGERNAME');
        const amt = num(txt(e, 'AMOUNT'));
        const lm = m.ledgers[ln] || {};
        const isParty = ln === party || yes(txt(e, 'ISPARTYLEDGER')) || under(m, ln, /^(sundry debtors|sundry creditors|cash-in-hand|bank accounts|bank od a\/c)$/i);
        if (isParty) { partyAmt += amt; continue; }
        const duty = lm.duty || (under(m, ln, /^duties & taxes$/i) && /gst/i.test(lm.taxType || ln) ? DUTY(ln) : '');
        if (duty) { d[duty] += Math.abs(amt); continue; }
        if (under(m, ln, /^duties & taxes$/i)) { d.other += amt; continue; } // TDS / TCS
        if (/round/i.test(ln)) { d.other += amt; continue; }
        d.txval += Math.abs(amt);
      }
      for (const e of inv) {
        const item = txt(e, 'STOCKITEMNAME');
        const im = m.items[item] || {};
        const amt = Math.abs(num(txt(e, 'AMOUNT')));
        const qtyRaw = txt(e, 'BILLEDQTY') || txt(e, 'ACTUALQTY');
        const qm = /(-?[\d.,]+)\s*([A-Za-z.]*)/.exec(qtyRaw || '');
        let rate = null;
        for (const rd of e.getElementsByTagName('RATEDETAILS.LIST')) if (/integrated|igst/i.test(txt(rd, 'GSTRATEDUTYHEAD'))) rate = num(txt(rd, 'GSTRATE'));
        if (rate === null && txt(e, 'GSTRATE')) rate = num(txt(e, 'GSTRATE'));
        if (rate === null) rate = im.rate;
        d.lines.push({ item, hsn: deep(e, 'GSTHSNNAME') || deep(e, 'HSNCODE') || im.hsn || '', desc: im.desc || item,
          qty: qm ? Math.abs(num(qm[1])) : 0, uqc: uqcOf((qm && qm[2]) || im.unit), value: amt, rate });
        d.txval += amt;
      }
      d.total = Math.abs(partyAmt) || r2(d.txval + d.igst + d.cgst + d.sgst + d.cess);
      ['txval', 'igst', 'cgst', 'sgst', 'cess', 'other', 'total'].forEach(k => { d[k] = r2(d[k]); });
      const tax = d.igst + d.cgst + d.sgst;
      d.effRate = d.txval ? r2(tax / d.txval * 100) : 0;
      d.interState = d.igst > 0 || (!!d.pos && !!own && d.pos !== own && !(d.cgst + d.sgst));
      if (!d.gstin && kind !== 'sales' && kind !== 'credit' && tax > 0 && !d.rcm) d.flags.push('Supplier GSTIN missing in Tally');
      out.push(d);
    }
    return out;
  }

  /* ---------- public ---------- */
  function Tally(port, host) {
    const url = `http://${host || 'localhost'}:${port || 9000}`;
    let masters = null, masterCompany = '';
    return {
      url,
      async companies() {
        const doc = parseXml(await post(url, reqCompanies()));
        const names = Array.from(doc.getElementsByTagName('COMPANY')).map(nameOf).filter(Boolean);
        return Array.from(new Set(names));
      },
      async masters(company) {
        if (masters && masterCompany === company) return masters;
        masters = parseMasters(parseXml(await post(url, reqMasters(company))));
        masterCompany = company;
        return masters;
      },
      // from/to: yyyy-mm-dd. Pulled month by month to keep Tally responsive.
      async documents(company, from, to, opts = {}, onProgress) {
        const m = await this.masters(company);
        const docs = [];
        let cur = new Date(from + 'T00:00:00');
        const end = new Date(to + 'T00:00:00');
        while (cur <= end) {
          const mEnd = new Date(cur.getFullYear(), cur.getMonth() + 1, 0);
          const a = fmt(cur) > from ? fmt(cur) : from;
          const b = mEnd > end ? to : fmt(mEnd);
          if (onProgress) onProgress(`Reading ${a.slice(0, 7)} from Tally…`);
          const doc = parseXml(await post(url, reqVouchers(company, a, b)));
          docs.push(...toDocs(doc, m, opts));
          cur = new Date(cur.getFullYear(), cur.getMonth() + 1, 1);
        }
        return docs;
      }
    };
  }
  const fmt = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

  root.GSTTally = { Tally, parseXml, parseMasters, toDocs, uqcOf };
})(typeof window !== 'undefined' ? window : globalThis);
