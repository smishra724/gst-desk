/* "Tally & GST work" tab: pull books from TallyPrime, then registers, GSTR-1 JSON,
   GSTR-3B working and reconciliations with GSTR-2B / GSTR-1. */
(function () {
  'use strict';
  const G = window.GSTR, W = window.GSTWork, App = window.GSTApp;
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
  const esc = App.esc;
  const inr = (n) => (+n || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const SETTINGS = 'gstf_work';

  const st = {
    clientId: '', company: '', port: 9000, from: '', to: '',
    docs: null, status: '', error: '', companies: [],
    twoB: null, twoBFiles: [], r1: null, r1File: '',
    recon2b: null, reconR1: null, gstr1: null, tolerance: 1
  };
  (function defaults() {
    const d = new Date(); d.setDate(1); d.setMonth(d.getMonth() - 1);
    const y = d.getFullYear(), m = String(d.getMonth() + 1).padStart(2, '0');
    st.from = `${y}-${m}`; st.to = `${y}-${m}`;
  })();

  const client = () => App.profiles.find(p => p.id === st.clientId) || null;
  const monthEnd = (ym) => { const [y, m] = ym.split('-').map(Number); return `${ym}-${String(new Date(y, m, 0).getDate()).padStart(2, '0')}`; };
  const fileBase = () => `${(G.displayName(client() || {}) || 'client').replace(/[\\/:*?"<>|]+/g, ' ').trim()}_${st.from}${st.to !== st.from ? '_to_' + st.to : ''}`;

  async function loadSettings() {
    const s = (await chrome.storage.local.get(SETTINGS))[SETTINGS] || {};
    st.port = s.port || 9000;
    st.tolerance = s.tolerance ?? 1;
    if (s.clientId && App.profiles.some(p => p.id === s.clientId)) st.clientId = s.clientId;
    else if (App.profiles[0]) st.clientId = App.profiles[0].id;
    const c = client(); st.company = (c && c.tally.company) || '';
  }
  const saveSettings = () => chrome.storage.local.set({ [SETTINGS]: { port: st.port, clientId: st.clientId, tolerance: st.tolerance } });

  function sums(kind) {
    const L = (st.docs || []).filter(d => !d.cancelled && d.kind === kind);
    return L.reduce((a, d) => { a.n++; a.txval += d.txval; a.tax += d.igst + d.cgst + d.sgst + d.cess; return a; }, { n: 0, txval: 0, tax: 0 });
  }

  function render() {
    const root = $('#work');
    const c = client();
    const single = st.from === st.to;
    const flags = (st.docs || []).filter(d => d.flags && d.flags.length).length;
    root.innerHTML = `
      <h2>Tally &amp; GST work</h2>
      <p class="lead">Reads sales, purchases and notes straight from TallyPrime, then builds registers, the GSTR-1 JSON, the GSTR-3B working and reconciliations with GSTR-2B and GSTR-1.</p>

      <section class="card"><header><h3>1 · Read from Tally</h3><span class="hint">TallyPrime must be open with the company loaded</span></header><div class="body">
        <div class="grid">
          <div class="f s4"><label for="w-client">Client</label><select id="w-client">${App.profiles.map(p => `<option value="${p.id}"${p.id === st.clientId ? ' selected' : ''}>${esc(G.displayName(p))}${p.gstin ? ' · ' + esc(p.gstin) : ''}</option>`).join('')}</select></div>
          <div class="f s4"><label for="w-company">Company in Tally</label><input id="w-company" type="text" list="w-companies" value="${esc(st.company)}" placeholder="Exactly as in TallyPrime">
            <datalist id="w-companies">${st.companies.map(n => `<option value="${esc(n)}">`).join('')}</datalist></div>
          <div class="f s2"><label for="w-port">ODBC / server port</label><input id="w-port" type="text" inputmode="numeric" value="${esc(st.port)}"></div>
          <div class="f s2"><span class="lbl">&nbsp;</span><button id="w-list">List open companies</button></div>
          <div class="f s3"><label for="w-from">From month</label><input id="w-from" type="month" value="${st.from}"></div>
          <div class="f s3"><label for="w-to">To month</label><input id="w-to" type="month" value="${st.to}"></div>
          <div class="f s3"><span class="lbl">&nbsp;</span><button class="primary" id="w-fetch">Read from Tally</button></div>
        </div>
        ${c && !c.gstin ? '<div class="note warn" style="margin-top:10px">This client has no GSTIN saved – add it on the Clients tab (needed for GSTR-1 and place-of-supply).</div>' : ''}
        ${st.status ? `<div class="note" style="margin-top:10px">${esc(st.status)}</div>` : ''}
        ${st.error ? `<div class="note err" style="margin-top:10px">${esc(st.error)}<br><span class="small">In TallyPrime: F1 (Help) → Settings → Connectivity → Client/Server configuration → TallyPrime acts as <b>Both</b>, Enable ODBC <b>Yes</b>, Port <b>${esc(st.port)}</b>. Restart Tally after changing.</span></div>` : ''}
        ${st.docs ? `<div class="stats" style="margin-top:12px">
          ${[['Sales', 'sales'], ['Credit notes', 'credit'], ['Purchases', 'purchase'], ['Debit notes', 'debit']].map(([l, k]) => { const s = sums(k); return `<div class="stat"><div class="k">${l}</div><div class="v">${s.n}</div><div class="s">Taxable ₹${inr(s.txval)} · Tax ₹${inr(s.tax)}</div></div>`; }).join('')}
          <div class="stat"><div class="k">Needs a look</div><div class="v">${flags}</div><div class="s">vouchers with warnings</div></div>
        </div>
        <div class="row" style="margin-top:12px"><button id="w-reg">Export sales &amp; purchase registers (Excel)</button></div>` : ''}
      </div></section>

      ${st.docs ? `
      <div class="cols">
        <section class="card"><header><h3>2 · GSTR-1 JSON</h3><span class="hint">from Tally sales</span></header><div class="body">
          ${single ? `<p class="small" style="margin-top:0">Builds B2B, B2CL, B2CS, CDNR, HSN (B2B/B2C) and documents issued for ${esc(st.from)}. Exports/SEZ are listed for you to add. Check it in the GST offline tool or upload on the portal.</p>
            <div class="row"><button class="primary" id="w-r1">Build GSTR-1 JSON</button>${st.gstr1 ? '<button id="w-r1dl">Download JSON</button><button id="w-r1x">Exceptions (Excel)</button>' : ''}</div>
            ${st.gstr1 ? gstr1Html() : ''}` : '<p class="muted small">Choose a single month (From = To) to build GSTR-1.</p>'}
        </div></section>

        <section class="card"><header><h3>3 · GSTR-2B reconciliation</h3><span class="hint">Tally purchases vs 2B</span></header><div class="body">
          <div class="drop" id="w-2b-drop"><b>Choose GSTR-2B JSON file(s)</b> or drop them here<br><span class="small muted">${st.twoBFiles.length ? esc(st.twoBFiles.join(', ')) : 'One file per month – from Download returns'}</span></div>
          <input type="file" id="w-2b" accept=".json,application/json" multiple hidden>
          <div class="row" style="margin-top:10px"><label class="small">Tolerance ₹ <input id="w-tol" type="text" inputmode="decimal" value="${esc(st.tolerance)}" style="width:60px;min-height:28px;padding:3px 6px"></label>
            <button class="primary" id="w-rec2b"${st.twoB ? '' : ' disabled'}>Reconcile</button>${st.recon2b ? '<button id="w-rec2bx">Download (Excel)</button>' : ''}</div>
          ${st.recon2b ? reconHtml(st.recon2b, 'purchase') : ''}
        </div></section>
      </div>

      <div class="cols">
        <section class="card"><header><h3>4 · GSTR-3B working</h3><span class="hint">books + 2B</span></header><div class="body">
          <p class="small" style="margin-top:0">Outward tax from Tally (3.1, 3.2) and ITC from GSTR-2B (4A), with books-vs-2B ITC. ${st.twoB ? '' : '<b>Load GSTR-2B</b> above for the ITC tables.'}</p>
          <div class="row"><button class="primary" id="w-3b">Show GSTR-3B working</button>${st.threeB ? '<button id="w-3bx">Download (Excel)</button>' : ''}</div>
          ${st.threeB ? threeBHtml() : ''}
        </div></section>

        <section class="card"><header><h3>5 · GSTR-1 reconciliation</h3><span class="hint">Tally sales vs filed GSTR-1</span></header><div class="body">
          <div class="drop" id="w-r1-drop"><b>Choose GSTR-1 JSON</b> downloaded from the portal<br><span class="small muted">${st.r1File ? esc(st.r1File) : 'Compares B2B, B2CL and credit notes invoice-wise; B2CS in total'}</span></div>
          <input type="file" id="w-r1f" accept=".json,application/json" hidden>
          <div class="row" style="margin-top:10px"><button class="primary" id="w-recr1"${st.r1 ? '' : ' disabled'}>Reconcile</button>${st.reconR1 ? '<button id="w-recr1x">Download (Excel)</button>' : ''}</div>
          ${st.reconR1 ? reconHtml(st.reconR1, 'sales') : ''}
        </div></section>
      </div>` : ''}`;
    wire();
  }

  function gstr1Html() {
    const j = st.gstr1.json;
    const cnt = (k) => (j[k] || []).reduce((a, x) => a + ((x.inv || x.nt || [x]).length), 0);
    const ex = st.gstr1.exceptions;
    return `<table class="tbl" style="margin-top:10px"><tbody>
      <tr><td>B2B invoices</td><td class="n">${cnt('b2b')}</td></tr><tr><td>B2CL invoices</td><td class="n">${cnt('b2cl')}</td></tr>
      <tr><td>B2CS rows</td><td class="n">${(j.b2cs || []).length}</td></tr><tr><td>Credit/debit notes (registered)</td><td class="n">${cnt('cdnr')}</td></tr>
      <tr><td>HSN rows (B2B / B2C)</td><td class="n">${j.hsn.hsn_b2b.length} / ${j.hsn.hsn_b2c.length}</td></tr>
      <tr class="sum"><td>Net taxable value</td><td class="n">₹${inr(st.gstr1.totals.txval)}</td></tr></tbody></table>
      ${ex.length ? `<div class="note warn" style="margin-top:10px">${ex.length} item${ex.length > 1 ? 's' : ''} need your attention:<ul style="margin:6px 0 0;padding-left:18px">${ex.slice(0, 8).map(e => `<li>${esc(e.doc.number || '')} ${esc(e.doc.party || '')}: ${esc(e.msg)}</li>`).join('')}${ex.length > 8 ? `<li>…and ${ex.length - 8} more (see Excel)</li>` : ''}</ul></div>` : '<div class="note" style="margin-top:10px">No exceptions.</div>'}`;
  }

  function reconHtml(res, side) {
    const order = ['Matched', 'Value mismatch', 'GSTIN differs', 'Only in books', 'Only in books (not in GSTR-1)', 'Only in 2B', 'Only in GSTR-1'];
    const cls = (k) => k === 'Matched' ? 'ok' : /mismatch|differs/.test(k) ? 'warn' : 'err';
    const rows = Object.entries(res.summary).sort((a, b) => order.indexOf(a[0]) - order.indexOf(b[0]));
    const issues = res.rows.filter(r => r.status !== 'Matched').slice(0, 12);
    return `<table class="tbl" style="margin-top:10px"><thead><tr><th>Status</th><th class="n">Docs</th><th class="n">Tax (books)</th><th class="n">Tax (${side === 'purchase' ? '2B' : 'GSTR-1'})</th></tr></thead><tbody>
      ${rows.map(([k, v]) => `<tr><td><span class="st ${cls(k)}">${esc(k)}</span></td><td class="n">${v.count}</td><td class="n">${inr(v.booksTax)}</td><td class="n">${inr(v.portalTax)}</td></tr>`).join('')}
      </tbody></table>
      ${side === 'sales' && st.r1 && st.r1.b2cs ? `<p class="small" style="margin:8px 0 0">B2CS in GSTR-1: taxable ₹${inr(st.r1.b2cs.txval)}, tax ₹${inr(st.r1.b2cs.igst + st.r1.b2cs.cgst + st.r1.b2cs.sgst)} · Books (unregistered sales, net): taxable ₹${inr(b2csBooks().txval)}, tax ₹${inr(b2csBooks().tax)}</p>` : ''}
      ${issues.length ? `<div class="tbl-wrap" style="margin-top:10px;max-height:260px"><table class="tbl"><thead><tr><th>Status</th><th>Party</th><th>Invoice</th><th class="n">Tax diff</th></tr></thead><tbody>
        ${issues.map(r => { const b = r.b || {}, p = r.p || {}; const d = (r.b ? b.igst + b.cgst + b.sgst : 0) - (r.p ? p.igst + p.cgst + p.sgst : 0);
          return `<tr><td><span class="st ${cls(r.status)}">${esc(r.status)}</span></td><td>${esc(b.name || p.name || b.gstin || p.gstin || '')}</td><td>${esc(b.num || p.num || '')}</td><td class="n">${inr(d)}</td></tr>`; }).join('')}
      </tbody></table></div>${res.rows.filter(r => r.status !== 'Matched').length > 12 ? '<p class="muted small">Full list in the Excel download.</p>' : ''}` : ''}`;
  }
  function b2csBooks() {
    const L = (st.docs || []).filter(d => !d.cancelled && !d.gstin && !d.export && (d.kind === 'sales' || d.kind === 'credit'));
    const own = ((client() || {}).gstin || '').slice(0, 2);
    return L.filter(d => !(d.kind === 'sales' && d.pos !== own && d.total > 100000)).reduce((a, d) => {
      const s = d.kind === 'credit' ? -1 : 1; a.txval += s * d.txval; a.tax += s * (d.igst + d.cgst + d.sgst); return a;
    }, { txval: 0, tax: 0 });
  }

  function threeBHtml() {
    const w = st.threeB;
    const r = (l, a) => a ? `<tr><td>${l}</td><td class="n">${inr(a.txval)}</td><td class="n">${inr(a.igst)}</td><td class="n">${inr(a.cgst)}</td><td class="n">${inr(a.sgst)}</td><td class="n">${inr(a.cess)}</td></tr>` : '';
    return `<div class="tbl-wrap" style="margin-top:10px"><table class="tbl"><thead><tr><th>Table</th><th class="n">Taxable</th><th class="n">IGST</th><th class="n">CGST</th><th class="n">SGST</th><th class="n">Cess</th></tr></thead><tbody>
      ${r('3.1(a) Outward taxable', w.a)}${r('3.1(b) Zero rated', w.b)}${r('3.1(c) Nil / exempt', w.c)}${r('3.1(d) Inward RCM', w.d)}
      ${st.twoB ? r('4A(1) Imports (2B)', w.itc.imports) + r('4A(3) RCM (books)', w.booksRcm) + r('4A(4) ISD (2B)', w.itc.isd) + r('4A(5) All other ITC (2B)', w.itc.other) + r('Not available as per 2B', w.itc.notAvail) : ''}
      ${r('ITC as per books', w.booksItc)}
      </tbody></table></div>
      ${Object.keys(w.inter).length ? `<p class="small" style="margin:8px 0 0">3.2 inter-state to unregistered: ${Object.entries(w.inter).map(([k, v]) => `${esc(G.stateName(k) || k)} ₹${inr(v.txval)}`).join(' · ')}</p>` : ''}`;
  }

  /* ---------- actions ---------- */
  async function fetchTally() {
    const c = client();
    if (!st.company) { st.error = 'Type the company name exactly as it appears in TallyPrime (or use “List open companies”).'; return render(); }
    if (st.from > st.to) { st.error = '“From” month is after “To” month.'; return render(); }
    st.error = ''; st.status = 'Connecting to Tally…'; st.docs = null; st.gstr1 = null; st.recon2b = null; st.reconR1 = null; st.threeB = null;
    render();
    try {
      const t = GSTTally.Tally(st.port);
      st.docs = await t.documents(st.company, `${st.from}-01`, monthEnd(st.to), { ownStateCode: (c && c.gstin || '').slice(0, 2) },
        (msg) => { st.status = msg; const n = $('#work .note'); if (n) n.textContent = msg; });
      st.status = `Read ${st.docs.filter(d => !d.cancelled).length} GST vouchers from “${st.company}” (${st.from} to ${st.to}).`;
      if (c && c.tally.company !== st.company) { c.tally.company = st.company; App.saveProfiles(); }
    } catch (e) { st.error = e.message; st.status = ''; }
    render();
  }

  async function listCompanies() {
    st.error = ''; st.status = 'Asking Tally for open companies…'; render();
    try {
      st.companies = await GSTTally.Tally(st.port).companies();
      st.status = st.companies.length ? `Open in Tally: ${st.companies.join(', ')}` : 'Tally is reachable but no company is open.';
      if (!st.company && st.companies.length === 1) st.company = st.companies[0];
    } catch (e) { st.error = e.message; st.status = ''; }
    render();
  }

  async function readJsonFiles(files) {
    const out = [];
    for (const f of files) { try { out.push({ name: f.name, json: JSON.parse(await f.text()) }); } catch (e) { App.toast(`${f.name} is not valid JSON`); } }
    return out;
  }
  async function load2B(files) {
    const got = await readJsonFiles(files);
    if (!got.length) return;
    const parsed = got.map(g => W.parse2B(g.json));
    const c = client();
    const wrong = parsed.find(p => p.gstin && c && c.gstin && p.gstin !== c.gstin);
    if (wrong && !confirm(`This 2B is for ${wrong.gstin}, but the client is ${c.gstin}. Use it anyway?`)) return;
    st.twoB = { gstin: parsed[0].gstin, docs: parsed.flatMap(p => p.docs) };
    st.twoBFiles = got.map(g => g.name);
    st.recon2b = null;
    App.toast(`Loaded ${st.twoB.docs.length} documents from GSTR-2B`);
    render();
  }
  async function loadR1(files) {
    const got = await readJsonFiles(files);
    if (!got.length) return;
    st.r1 = W.parseGSTR1(got[0].json);
    st.r1File = got[0].name;
    st.reconR1 = null;
    App.toast(`Loaded ${st.r1.docs.length} invoices/notes from GSTR-1`);
    render();
  }
  function dropZone(zoneSel, inputSel, handler) {
    const z = $(zoneSel), i = $(inputSel);
    if (!z || !i) return;
    z.addEventListener('click', () => i.click());
    i.addEventListener('change', () => { handler(Array.from(i.files)); i.value = ''; });
    z.addEventListener('dragover', (e) => { e.preventDefault(); z.classList.add('over'); });
    z.addEventListener('dragleave', () => z.classList.remove('over'));
    z.addEventListener('drop', (e) => { e.preventDefault(); z.classList.remove('over'); handler(Array.from(e.dataTransfer.files)); });
  }
  function downloadJson(name, obj) {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([JSON.stringify(obj)], { type: 'application/json' }));
    a.download = name; document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 3000);
  }

  function wire() {
    const on = (sel, ev, fn) => { const e = $(sel); if (e) e.addEventListener(ev, fn); };
    on('#w-client', 'change', (e) => {
      st.clientId = e.target.value; const c = client(); st.company = (c && c.tally.company) || '';
      st.docs = null; st.twoB = null; st.twoBFiles = []; st.r1 = null; st.r1File = ''; st.status = ''; st.error = '';
      saveSettings(); render();
    });
    on('#w-company', 'input', (e) => { st.company = e.target.value; });
    on('#w-port', 'change', (e) => { st.port = +e.target.value.replace(/\D/g, '') || 9000; saveSettings(); });
    on('#w-from', 'change', (e) => { st.from = e.target.value; if (st.to < st.from) st.to = st.from; render(); });
    on('#w-to', 'change', (e) => { st.to = e.target.value; render(); });
    on('#w-tol', 'change', (e) => { st.tolerance = +e.target.value || 0; saveSettings(); });
    on('#w-list', 'click', listCompanies);
    on('#w-fetch', 'click', fetchTally);
    on('#w-reg', 'click', () => XLSXW.save(`Registers_${fileBase()}.xlsx`, W.registers(st.docs)));
    on('#w-r1', 'click', () => {
      const c = client();
      if (!c || !c.gstin) { App.toast('Add the client GSTIN first'); return; }
      const [y, m] = st.from.split('-');
      st.gstr1 = W.buildGSTR1(st.docs, { gstin: c.gstin, fp: `${m}${y}` });
      render();
    });
    on('#w-r1dl', 'click', () => { const c = client(); const [y, m] = st.from.split('-'); downloadJson(`GSTR1_${c.gstin}_${m}${y}.json`, st.gstr1.json); });
    on('#w-r1x', 'click', () => XLSXW.save(`GSTR1_exceptions_${fileBase()}.xlsx`, [{ name: 'Exceptions', rows: [['Date', 'Voucher no.', 'Party', 'GSTIN', 'Issue'],
      ...st.gstr1.exceptions.map(e => [e.doc.date || '', e.doc.number || '', e.doc.party || '', e.doc.gstin || '', e.msg])] }]));
    dropZone('#w-2b-drop', '#w-2b', load2B);
    dropZone('#w-r1-drop', '#w-r1f', loadR1);
    on('#w-rec2b', 'click', () => {
      const books = st.docs.filter(d => !d.cancelled && (d.kind === 'purchase' || d.kind === 'debit') && !d.rcm);
      st.recon2b = W.reconcile(books, st.twoB.docs.filter(p => p.section === 'B2B' || p.section === 'B2BA' || p.section === 'CDNR' || p.section === 'CDNRA' || p.section === 'ECOM'), { side: 'purchase', tolerance: st.tolerance });
      render();
    });
    on('#w-rec2bx', 'click', () => XLSXW.save(`2B_reconciliation_${fileBase()}.xlsx`, W.reconSheets(st.recon2b, 'purchase')));
    on('#w-recr1', 'click', () => {
      const own = ((client() || {}).gstin || '').slice(0, 2);
      const books = st.docs.filter(d => !d.cancelled && !d.export && (d.kind === 'sales' || d.kind === 'credit') && (d.gstin || (d.kind === 'sales' && d.pos !== own && d.total > 100000)));
      st.reconR1 = W.reconcile(books, st.r1.docs, { side: 'sales', tolerance: st.tolerance });
      render();
    });
    on('#w-recr1x', 'click', () => XLSXW.save(`GSTR1_reconciliation_${fileBase()}.xlsx`, W.reconSheets(st.reconR1, 'sales')));
    on('#w-3b', 'click', () => { st.threeB = W.threeB(st.docs, st.twoB, (client() || {}).gstin); render(); });
    on('#w-3bx', 'click', () => XLSXW.save(`GSTR3B_working_${fileBase()}.xlsx`, W.threeBSheet(st.threeB, st.twoB)));
  }

  let ready = false;
  document.addEventListener('gstf-view', async (e) => {
    if (e.detail !== 'work') return;
    if (!ready) { await loadSettings(); ready = true; }
    render();
  });
})();
