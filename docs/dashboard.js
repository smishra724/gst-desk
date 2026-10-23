import { CONFIG } from './config.js';
import { Auth, friendly } from './auth.js';

const $ = (s) => document.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const FILE = { GSTR1_PDF: 'GSTR-1 PDF', GSTR1_JSON: 'GSTR-1 JSON', GSTR2B_XLSX: '2B Excel', GSTR2B_JSON: '2B JSON', GSTR3B_PDF: '3B PDF' };
const PILL = { downloaded: 'ok', requested: 'warn', running: 'warn', failed: 'err', skipped: 'idle', pending: 'idle', done: 'ok', active: 'warn', login: 'warn' };
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const period = (p) => { const [y, m] = p.split('-'); return `${MON[+m - 1]} ${y}`; };

let data = null, extOk = false, search = '';

/* ---------- talk to the extension (via its bridge content script) ---------- */
let seq = 0;
const waiting = new Map();
window.addEventListener('message', (e) => {
  if (e.source !== window || !e.data || e.data.gstdesk !== 'ext') return;
  if (e.data.event === 'changed' || e.data.event === 'ready') { refresh(); return; }
  const w = waiting.get(e.data.id);
  if (w) { waiting.delete(e.data.id); e.data.ok ? w.res(e.data.data) : w.rej(new Error(e.data.error)); }
});
function ask(action, extra = {}, timeout = 1500) {
  const id = ++seq;
  return new Promise((res, rej) => {
    waiting.set(id, { res, rej });
    window.postMessage({ gstdesk: 'page', id, action, ...extra }, location.origin);
    setTimeout(() => { if (waiting.has(id)) { waiting.delete(id); rej(new Error('timeout')); } }, timeout);
  });
}
let refreshing = false;
async function refresh() {
  if (refreshing) return;
  refreshing = true;
  try { data = await ask('summary'); extOk = true; } catch (_) { extOk = !!document.documentElement.getAttribute('data-gstdesk-extension') && extOk; if (!extOk) data = null; }
  refreshing = false;
  render();
}
const openExt = (hash) => ask('open', { hash }).catch(() => alert('Open GST Desk from the extension icon in Chrome.'));

/* ---------- due dates (monthly filers) ---------- */
function dueDates() {
  const now = new Date(); now.setHours(0, 0, 0, 0);
  const out = [];
  for (let k = 0; k < 2; k++) {
    const y = now.getFullYear(), m = now.getMonth() + k; // due month
    const prev = new Date(y, m - 1, 1);
    const p = `${MON[prev.getMonth()]} ${prev.getFullYear()}`;
    out.push({ d: new Date(y, m, 11), what: `GSTR-1 for ${p}` });
    out.push({ d: new Date(y, m, 14), what: `GSTR-2B for ${p} available` });
    out.push({ d: new Date(y, m, 20), what: `GSTR-3B for ${p}` });
  }
  return out.filter(x => x.d >= now).slice(0, 4).map(x => ({ ...x, days: Math.round((x.d - now) / 86400000) }));
}

/* ---------- render ---------- */
function render() {
  const chip = $('#ext-chip');
  chip.className = 'chip ' + (extOk ? 'on' : 'off');
  $('#ext-text').textContent = extOk ? `Extension connected · v${data.version}` : 'Extension not detected';
  const app = $('#app');
  const first = (window.__user && (window.__user.displayName || window.__user.email || '').split(/[ @]/)[0]) || '';

  const install = `
    <div class="notice"><div><b>GST Desk extension not found in this browser.</b><br>Install it to see your clients, downloads and queue here.</div>
      <div class="actions"><a class="btn primary" href="${esc(CONFIG.extensionZip)}" download>⬇ Download extension</a><a class="btn" href="index.html#download">How to install</a></div></div>`;

  const dd = dueDates().map(x => `<li><span>${esc(x.what)}</span><span class="when ${x.days <= 3 ? 'soon' : ''}">${x.d.getDate()} ${MON[x.d.getMonth()]} · ${x.days === 0 ? 'today' : x.days === 1 ? 'tomorrow' : `in ${x.days} days`}</span></li>`).join('');
  const dueCard = `<section class="card due"><header><h3>Upcoming due dates</h3><span class="muted small">monthly filers</span></header><div class="body"><ul>${dd}</ul>
    <p class="muted small" style="margin:10px 0 0">QRMP filers have different dates. Check the GST portal for extensions.</p></div></section>`;

  if (!extOk) {
    app.innerHTML = `<div class="hello"><div><h1>Hello${first ? ', ' + esc(first) : ''}</h1><p>Your GST Desk dashboard</p></div></div>${install}
      <div class="grid2"><section class="card"><div class="empty"><h3>Your clients will appear here</h3><p>After installing, add clients in GST Desk (click its icon in Chrome), then come back to this page.</p></div></section>${dueCard}</div>`;
    return;
  }

  const C = data.clients;
  const reg = C.filter(c => c.status === 'registered').length;
  const pw = C.filter(c => c.passwordSaved).length;
  const ready = C.filter(c => !c.toFix).length;
  const monthAgo = new Date(Date.now() - 30 * 86400000).toISOString();
  const recent = data.downloads.filter(d => d.at >= monthAgo).length;
  const q = data.queue;
  const allJobs = q ? q.items.flatMap(i => i.jobs) : [];
  const doneJobs = allJobs.filter(j => ['downloaded', 'requested', 'failed', 'skipped'].includes(j.status)).length;

  const list = C.filter(c => !search || [c.name, c.gstin, c.state, c.tallyCompany].join(' ').toLowerCase().includes(search))
    .sort((a, b) => a.name.localeCompare(b.name));

  const qCard = q ? `<section class="card"><header><h3>Download queue</h3><span class="pill ${PILL[q.status === 'done' ? 'done' : q.status === 'running' ? 'running' : 'idle'] || 'idle'}">${esc(q.status)}</span></header><div class="body">
      <div class="bar"><i style="width:${allJobs.length ? Math.round(doneJobs / allJobs.length * 100) : 0}%"></i></div>
      <p class="small muted" style="margin:6px 0 4px">${doneJobs} of ${allJobs.length} files · started ${esc(new Date(q.created).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' }))}</p>
      ${q.items.map(it => `<div class="q-client"><div class="t"><span>${esc(it.name)}</span><span class="pill ${PILL[it.status] || 'idle'}">${esc(it.status === 'login' ? 'waiting for CAPTCHA' : it.status)}</span></div>
        <div class="q-files">${it.jobs.map(j => `<span class="pill ${PILL[j.status] || 'idle'}" title="${esc(j.filename || j.note)}">${esc(FILE[j.file] || j.file)} · ${esc(period(j.period))}</span>`).join('')}</div></div>`).join('')}
    </div></section>` : `<section class="card"><header><h3>Download queue</h3></header><div class="empty"><p>No downloads queued.</p><button class="btn primary" data-open="#downloads">Start downloading returns</button></div></section>`;

  app.innerHTML = `
    <div class="hello"><div><h1>Hello${first ? ', ' + esc(first) : ''}</h1><p>${C.length} client${C.length === 1 ? '' : 's'} in GST Desk on this computer</p></div>
      <div class="actions"><button class="btn" data-open="#clients">+ Add client</button><button class="btn" data-open="#work">Tally &amp; GST work</button><button class="btn primary" data-open="#downloads">Download returns</button></div></div>

    <div class="kpis">
      <div class="kpi"><div class="k">Clients</div><div class="v">${C.length}</div><div class="s">${reg} registered · ${C.length - reg} new registration</div></div>
      <div class="kpi"><div class="k">Logins saved</div><div class="v">${pw}</div><div class="s">${C.length - pw ? `${C.length - pw} without a password` : 'all clients ready to log in'}</div></div>
      <div class="kpi"><div class="k">Profiles complete</div><div class="v">${ready}</div><div class="s">${C.length - ready ? `${C.length - ready} need details` : 'nothing missing'}</div></div>
      <div class="kpi"><div class="k">Files downloaded</div><div class="v">${recent}</div><div class="s">in the last 30 days</div></div>
    </div>

    <div class="grid2">
      <div>
        <section class="card"><header><h3>Clients</h3><input class="search" id="search" type="search" placeholder="Search name, GSTIN, state…" value="${esc(search)}" aria-label="Search clients"></header>
          ${C.length ? `<div class="tw"><table><thead><tr><th>Client</th><th>GSTIN</th><th>State</th><th>Login</th><th>Tally</th><th>Status</th></tr></thead><tbody>
            ${list.map(c => `<tr><td><b>${esc(c.name)}</b><div class="muted small">${esc(c.constitution)}</div></td>
              <td class="mono">${esc(c.gstin || '—')}</td><td>${esc(c.state || '—')}</td>
              <td>${c.passwordSaved ? '<span class="pill ok">saved</span>' : c.username ? '<span class="pill warn">no password</span>' : '<span class="pill idle">—</span>'}</td>
              <td class="small">${esc(c.tallyCompany || '—')}</td>
              <td>${c.toFix ? `<span class="pill err">${c.toFix} to fix</span>` : c.status === 'new' ? '<span class="pill warn">new registration</span>' : '<span class="pill ok">ready</span>'}</td></tr>`).join('')}
            ${list.length ? '' : '<tr><td colspan="6" class="muted">No client matches your search.</td></tr>'}
          </tbody></table></div>` : `<div class="empty"><h3>No clients yet</h3><p>Add your first client in GST Desk.</p><button class="btn primary" data-open="#clients">Open GST Desk</button></div>`}
        </section>

        <section class="card"><header><h3>Recent downloads</h3><span class="muted small">saved in Downloads › GST Desk</span></header>
          ${data.downloads.length ? `<div class="tw" style="max-height:320px"><table><thead><tr><th>When</th><th>Client</th><th>Return</th><th>Period</th></tr></thead><tbody>
            ${data.downloads.slice(0, 25).map(d => `<tr><td class="small">${esc(new Date(d.at).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' }))}</td><td>${esc(d.client)}</td>
              <td>${esc(d.ret)} <span class="muted small">${esc(d.kind)}</span></td><td>${esc(period(d.period))}</td></tr>`).join('')}
          </tbody></table></div>` : '<div class="empty"><p>Nothing downloaded yet.</p></div>'}
        </section>
      </div>
      <div>${qCard}${dueCard}</div>
    </div>`;

  const s = $('#search');
  if (s) s.addEventListener('input', (e) => { search = e.target.value.trim().toLowerCase(); const pos = e.target.selectionStart; render(); const n = $('#search'); n.focus(); n.setSelectionRange(pos, pos); });
  app.querySelectorAll('[data-open]').forEach(b => b.addEventListener('click', () => openExt(b.dataset.open)));
}

/* ---------- start ---------- */
(async function init() {
  let user;
  try { user = await Auth.current(); } catch (e) { $('#app').innerHTML = `<div class="notice"><div>${esc(friendly(e))}</div><a class="btn" href="index.html">Back to sign in</a></div>`; return; }
  if (!user) { location.replace('index.html'); return; }
  window.__user = user;
  const name = user.displayName || user.email;
  $('#uname').textContent = user.displayName || 'Signed in';
  $('#uemail').textContent = user.email || '';
  $('#avatar').textContent = (name || '?').trim().slice(0, 1).toUpperCase();
  $('#signout').addEventListener('click', async () => { const a = await Auth.load(); await a.signOut(); location.replace('index.html'); });
  await refresh();
  setTimeout(() => { if (!extOk) refresh(); }, 1500);
})();
