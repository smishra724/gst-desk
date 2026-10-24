/* "Download returns" tab: build the queue and watch it run. */
(function () {
  'use strict';
  const G = window.GSTR, K = G.KEYS, App = window.GSTApp;
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
  const esc = App.esc;
  const LOGIN = 'https://services.gst.gov.in/services/login';
  const FILES = [
    ['GSTR1_PDF', 'GSTR-1 summary (PDF)'], ['GSTR1_JSON', 'GSTR-1 details (JSON)'],
    ['GSTR2B_XLSX', 'GSTR-2B (Excel)'], ['GSTR2B_JSON', 'GSTR-2B (JSON)'], ['GSTR3B_PDF', 'GSTR-3B filed (PDF)']
  ];
  const LABEL = Object.fromEntries(FILES);
  const MONTHS = G.MONTHS; // April → March
  const MNUM = [4, 5, 6, 7, 8, 9, 10, 11, 12, 1, 2, 3];

  const state = { sel: new Set(), files: new Set(['GSTR1_PDF', 'GSTR2B_XLSX', 'GSTR2B_JSON', 'GSTR3B_PDF']), months: new Set(), fy: currentFY() };
  function currentFY() { const d = new Date(); const y = d.getMonth() >= 3 ? d.getFullYear() : d.getFullYear() - 1; return y; }
  const fyLabel = (y) => `${y}-${String((y + 1) % 100).padStart(2, '0')}`;
  const periodOf = (fy, i) => { const m = MNUM[i]; const y = m >= 4 ? fy : fy + 1; return `${y}-${String(m).padStart(2, '0')}`; };
  const statusClass = (s) => ({ downloaded: 'ok', requested: 'warn', failed: 'err', skipped: 'idle', running: 'warn', pending: 'idle' }[s] || 'idle');

  // last completed month by default
  (function () { const d = new Date(); d.setDate(1); d.setMonth(d.getMonth() - 1); const m = d.getMonth() + 1; state.fy = m >= 4 ? d.getFullYear() : d.getFullYear() - 1; state.months.add(MNUM.indexOf(m)); })();

  async function render() {
    const root = $('#downloads');
    const clients = App.profiles.filter(p => p.status === 'registered' || p.gstin);
    const q = (await chrome.storage.local.get(K.queue))[K.queue];
    const log = ((await chrome.storage.local.get(K.downloads))[K.downloads] || []).slice(0, 30);
    const vs = await GSTVault.state();
    const running = q && (q.status === 'running' || q.status === 'paused');

    root.innerHTML = `
      <h2>Download returns</h2>
      <p class="lead">Pick clients, months and files. GST Desk opens the portal, fills each client's username and password, and waits for you to type the CAPTCHA. After you log in it downloads everything for that client, logs out and moves to the next one.</p>
      ${vs === 'locked' ? `<div class="note warn" style="margin-bottom:12px">Saved passwords are locked. <button class="link" id="dl-unlock">Unlock now</button> (tick “Remember” so it isn’t asked again) so logins fill automatically.</div>` : ''}
      <div class="cols3">
        <section class="card"><header><h3>1 · Clients</h3><span class="hint">${clients.length} with GSTIN</span></header><div class="body">
          ${clients.length ? `<label class="small" style="display:flex;gap:6px;margin-bottom:6px"><input type="checkbox" id="dl-all"${state.sel.size && state.sel.size === clients.length ? ' checked' : ''}> Select all</label>
          <div class="pick">${clients.map(p => `<label><input type="checkbox" data-client="${p.id}"${state.sel.has(p.id) ? ' checked' : ''}> ${esc(G.displayName(p))}
            <span class="sub">${p.portal.passwordEnc ? '' : '⚠ no password · '}${esc(p.gstin || 'no GSTIN')}</span></label>`).join('')}</div>`
            : '<p class="muted">Add GSTIN and portal username to a client on the Clients tab first.</p>'}
        </div></section>
        <section class="card"><header><h3>2 · Months</h3>
          <select id="dl-fy" aria-label="Financial year">${[0, 1, 2, 3, 4].map(i => { const y = currentFY() - i; return `<option value="${y}"${y === state.fy ? ' selected' : ''}>FY ${fyLabel(y)}</option>`; }).join('')}</select></header>
          <div class="body"><label class="small" style="display:flex;gap:6px;margin-bottom:8px"><input type="checkbox" id="dl-allm"${state.months.size === 12 ? ' checked' : ''}> Whole year</label>
          <div class="months">${MONTHS.map((m, i) => `<label><input type="checkbox" data-month="${i}"${state.months.has(i) ? ' checked' : ''}> ${m.slice(0, 3)} ${MNUM[i] >= 4 ? state.fy : state.fy + 1}</label>`).join('')}</div>
        </div></section>
        <section class="card"><header><h3>3 · Files</h3></header><div class="body"><div class="opts">
          ${FILES.map(([k, l]) => `<label><input type="checkbox" data-file="${k}"${state.files.has(k) ? ' checked' : ''}> ${l}</label>`).join('')}
          <p class="muted small" style="margin:6px 0 0">GSTR-1 JSON is prepared by the portal on request; if it isn't ready, the file is marked “requested” – queue it again after 20–30 minutes.</p>
        </div></div></section>
      </div>
      <div class="row end" style="margin:4px 0 18px">
        <span class="muted small" id="dl-count"></span>
        <button class="primary" id="dl-start">${running ? 'Replace queue and start' : 'Start downloads'}</button>
      </div>

      ${q ? queueHtml(q) : ''}

      <section class="card"><header><h3>Where files go</h3></header><div class="body">
        <p class="small" style="margin:0 0 6px">Chrome's Downloads folder → <b>GST Desk / Client name / FY / GSTR2B_042025_Details.xlsx</b>, and so on.</p>
        <p class="small muted" style="margin:0">If Chrome asks where to save every file, turn off <i>Settings → Downloads → Ask where to save each file</i> so the queue isn't interrupted.</p>
        ${log.length ? `<div class="tbl-wrap" style="margin-top:10px;max-height:240px"><table class="tbl"><thead><tr><th>When</th><th>Client</th><th>Return</th><th>Period</th><th>Saved as</th></tr></thead><tbody>
          ${log.map(l => `<tr><td>${esc(new Date(l.at).toLocaleString())}</td><td>${esc(l.client)}</td><td>${esc(l.ret)} ${esc(l.kind)}</td><td>${esc(l.period)}</td><td>${esc(l.file)}</td></tr>`).join('')}</tbody></table></div>` : ''}
      </div></section>`;
    wire(clients);
    count();
  }

  function queueHtml(q) {
    const all = q.items.flatMap(i => i.jobs.map(j => ({ i, j })));
    const n = (s) => all.filter(x => x.j.status === s).length;
    const st = { running: 'Running', paused: 'Paused', done: 'Finished', stopped: 'Stopped' }[q.status] || q.status;
    return `<section class="card"><header><h3>Current queue · ${st}</h3>
      <div class="row">
        ${q.status === 'running' ? '<button data-q="pause">Pause</button>' : ''}
        ${q.status === 'paused' || q.status === 'stopped' ? '<button class="primary" data-q="resume">Resume</button>' : ''}
        ${n('failed') ? '<button data-q="retry">Retry failed</button>' : ''}
        ${n('requested') ? '<button data-q="requested">Download requested JSON now</button>' : ''}
        <button data-q="portal">Open portal</button>
        ${q.status !== 'running' ? '<button class="danger" data-q="clear">Clear</button>' : '<button class="danger" data-q="stop">Stop</button>'}
      </div></header><div class="body">
      <div class="stats" style="margin-bottom:10px">
        <div class="stat"><div class="k">Downloaded</div><div class="v">${n('downloaded')}</div></div>
        <div class="stat"><div class="k">Waiting</div><div class="v">${n('pending') + n('running')}</div></div>
        <div class="stat"><div class="k">Requested (JSON)</div><div class="v">${n('requested')}</div></div>
        <div class="stat"><div class="k">Failed / skipped</div><div class="v">${n('failed') + n('skipped')}</div></div>
      </div>
      <div class="tbl-wrap"><table class="tbl"><thead><tr><th>Client</th><th>Period</th><th>File</th><th>Status</th><th>Note / saved as</th></tr></thead><tbody>
      ${all.map(({ i, j }) => `<tr><td>${esc(i.name)}</td><td>${esc(j.period)}</td><td>${esc(LABEL[j.file])}</td>
        <td><span class="st ${statusClass(j.status)}">${esc(j.status)}</span></td><td class="small">${esc(j.filename || j.note || '')}</td></tr>`).join('')}
      </tbody></table></div></div></section>`;
  }

  function count() {
    const n = state.sel.size * state.months.size * state.files.size;
    const el = $('#dl-count');
    if (el) el.textContent = n ? `${n} file${n > 1 ? 's' : ''} for ${state.sel.size} client${state.sel.size > 1 ? 's' : ''}` : 'Pick at least one client, month and file';
    const b = $('#dl-start');
    if (b) b.disabled = !n;
  }

  function wire(clients) {
    const on = (sel, ev, fn) => { const e = $(sel); if (e) e.addEventListener(ev, fn); };
    on('#dl-unlock', 'click', async () => { await App.ensureUnlocked(); render(); });
    on('#dl-all', 'change', (e) => { state.sel = e.target.checked ? new Set(clients.map(c => c.id)) : new Set(); render(); });
    on('#dl-allm', 'change', (e) => { state.months = e.target.checked ? new Set(MONTHS.map((_, i) => i)) : new Set(); render(); });
    on('#dl-fy', 'change', (e) => { state.fy = +e.target.value; render(); });
    $$('[data-client]').forEach(c => c.addEventListener('change', () => { c.checked ? state.sel.add(c.dataset.client) : state.sel.delete(c.dataset.client); count(); }));
    $$('[data-month]').forEach(c => c.addEventListener('change', () => { c.checked ? state.months.add(+c.dataset.month) : state.months.delete(+c.dataset.month); count(); }));
    $$('[data-file]').forEach(c => c.addEventListener('change', () => { c.checked ? state.files.add(c.dataset.file) : state.files.delete(c.dataset.file); count(); }));
    on('#dl-start', 'click', start);
    $$('[data-q]').forEach(b => b.addEventListener('click', () => queueAction(b.dataset.q)));
  }

  async function start() {
    const old = (await chrome.storage.local.get(K.queue))[K.queue];
    if (old && (old.status === 'running' || old.status === 'paused') && !confirm('A queue is already in progress. Replace it?')) return;
    const chosen = App.profiles.filter(p => state.sel.has(p.id));
    const noPw = chosen.filter(p => !p.portal.passwordEnc);
    if (noPw.length && !confirm(`${noPw.map(G.displayName).join(', ')} ${noPw.length > 1 ? 'have' : 'has'} no saved password yet – type it once on the GST login page and GST Desk saves it for next time. Continue?`)) return;
    if (chosen.some(p => p.portal.passwordEnc) && !(await App.ensureUnlocked())) return;
    if ((await GSTVault.state()) === 'none') await App.ensureUnlocked();   // so passwords typed on the portal can be saved
    const months = Array.from(state.months).sort((a, b) => a - b);
    const files = FILES.map(f => f[0]).filter(f => state.files.has(f));
    let n = 0;
    const q = {
      id: G.uid(), created: new Date().toISOString(), status: 'running', cur: { item: 0 },
      items: chosen.map(p => ({
        clientId: p.id, name: G.displayName(p), gstin: p.gstin, status: 'pending',
        jobs: months.flatMap(mi => files.map(f => ({ id: `j${++n}`, file: f, period: periodOf(state.fy, mi), status: 'pending', step: 0 })))
      }))
    };
    await chrome.storage.local.set({ [K.queue]: q });
    chrome.tabs.create({ url: LOGIN });
    App.toast('Queue started – type the CAPTCHA on the portal tab');
    render();
  }

  async function queueAction(a) {
    const q = (await chrome.storage.local.get(K.queue))[K.queue];
    if (!q) return;
    if (a === 'portal') { chrome.tabs.create({ url: LOGIN }); return; }
    if (a === 'clear') { await chrome.storage.local.remove(K.queue); return render(); }
    if (a === 'pause') q.status = 'paused';
    if (a === 'stop') q.status = 'stopped';
    if (a === 'resume') { q.status = 'running'; q.dismissed = false; }
    if (a === 'retry' || a === 'requested') {
      const want = a === 'retry' ? 'failed' : 'requested';
      let first = -1;
      q.items.forEach((it, idx) => {
        let any = false;
        it.jobs.forEach(j => {
          if (j.status === want) {
            j.status = 'pending'; j.step = 0; j.note = '';
            if (want === 'requested') j.file = 'GSTR1_JSON';
            any = true;
          }
        });
        if (any) { it.status = 'pending'; if (first < 0) first = idx; }
      });
      if (first >= 0) { q.cur.item = first; q.status = 'running'; q.dismissed = false; chrome.tabs.create({ url: LOGIN }); }
    }
    await chrome.storage.local.set({ [K.queue]: q });
    render();
  }

  chrome.storage.onChanged.addListener((ch, area) => {
    if (area === 'local' && (ch[K.queue] || ch[K.downloads]) && !$('#view-downloads').hidden) render();
  });
  document.addEventListener('gstf-view', (e) => { if (e.detail === 'downloads') render(); });
})();
