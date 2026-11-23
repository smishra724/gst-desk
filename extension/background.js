/* Service worker: opens the manager, hands saved logins to the portal runner,
   and names downloaded return files into GST Desk/<Client>/<FY>/ folders. */
importScripts('schema.js', 'vault.js', 'cad-background.js');   // cad-background.js = CA Desk portal helper (CAPM_* messages)
const G = self.GSTR;
const K = G.KEYS;
const EXPECT = 'gstf_expect';

chrome.action.onClicked.addListener(() => chrome.tabs.create({ url: chrome.runtime.getURL('manager.html') }));

const safe = (s) => String(s || '').replace(/[\\/:*?"<>|]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 60) || 'Client';
const fyOf = (period) => { const [y, m] = period.split('-').map(Number); return m >= 4 ? `FY ${y}-${String((y + 1) % 100).padStart(2, '0')}` : `FY ${y - 1}-${String(y % 100).padStart(2, '0')}`; };
const mmyyyy = (period) => { const [y, m] = period.split('-'); return `${m}${y}`; };

chrome.runtime.onMessage.addListener((msg, sender, reply) => {
  if (msg && typeof msg.type === 'string' && msg.type.startsWith('CAPM_')) return false;   // handled by cad-background.js
  (async () => {
    if (!msg || !msg.type) return reply({});
    if (msg.type === 'open-manager') {
      await chrome.tabs.create({ url: chrome.runtime.getURL('manager.html' + (msg.hash || '')) });
      return reply({ ok: true });
    }
    if (msg.type === 'harvest') {
      const tab = await chrome.tabs.create({ url: 'https://reg.gst.gov.in/registration/', active: false });
      await chrome.storage.local.set({ gstf_harvest: { tabId: tab.id, what: msg.what, at: Date.now() } });
      return reply({ ok: true });
    }
    if (msg.type === 'harvest-check') {
      const h = (await chrome.storage.local.get('gstf_harvest')).gstf_harvest;
      const mine = h && sender.tab && h.tabId === sender.tab.id && Date.now() - h.at < 300000;
      return reply({ what: mine ? h.what : '' });
    }
    if (msg.type === 'harvest-done') {
      await chrome.storage.local.set({ gstf_harvest_result: { ok: msg.ok, count: msg.count || 0, error: msg.error || '', at: Date.now() } });
      await chrome.storage.local.remove('gstf_harvest');
      if (sender.tab && msg.ok) setTimeout(() => chrome.tabs.remove(sender.tab.id).catch(() => {}), 800);
      return reply({ ok: true });
    }
    if (msg.type === 'vault-state') return reply({ state: await self.GSTVault.state() });
    if (msg.type === 'get-login') {
      // Only pages on the GST portal may ask for a login.
      const from = sender && sender.url ? new URL(sender.url).hostname : '';
      if (!/(^|\.)gst\.gov\.in$/.test(from)) return reply({ error: 'not allowed' });
      const r = await chrome.storage.local.get(K.profiles);
      const p = (r[K.profiles] || []).find(x => x.id === msg.clientId);
      if (!p) return reply({ error: 'Client not found' });
      let password = '';
      try { password = await self.GSTVault.decrypt(p.portal && p.portal.passwordEnc); }
      catch (e) { return reply({ username: (p.portal && p.portal.username) || '', error: 'locked' }); }
      return reply({ username: (p.portal && p.portal.username) || '', password });
    }
    // A password typed on the GST login page is remembered for this client once the login works.
    if (msg.type === 'login-typed' || msg.type === 'login-ok') {
      const from = sender && sender.url ? new URL(sender.url).hostname : '';
      if (!/(^|\.)gst\.gov\.in$/.test(from)) return reply({ error: 'not allowed' });
      if (msg.type === 'login-typed') {
        if (!msg.clientId || !msg.password) return reply({});
        await chrome.storage.session.set({ gstf_typed: { clientId: msg.clientId, username: String(msg.username || '').trim(), password: String(msg.password), at: Date.now() } });
        return reply({ ok: true });
      }
      const t = (await chrome.storage.session.get('gstf_typed')).gstf_typed;
      if (!t || t.clientId !== msg.clientId || Date.now() - t.at > 15 * 60000) return reply({});
      await chrome.storage.session.remove('gstf_typed');
      const r = await chrome.storage.local.get(K.profiles);
      const list = r[K.profiles] || [];
      const p = list.find(x => x.id === t.clientId);
      if (!p) return reply({});
      p.portal = p.portal || { username: '', passwordEnc: null };
      if (p.portal.username && t.username && p.portal.username.toLowerCase() !== t.username.toLowerCase()) return reply({ skipped: 'different user' });
      let changed = false;
      if (!p.portal.username && t.username) { p.portal.username = t.username; changed = true; }
      let cur = null;
      try { cur = await self.GSTVault.decrypt(p.portal.passwordEnc); } catch (_) { cur = null; }
      if (cur !== t.password) {
        if ((await self.GSTVault.state()) === 'none') await self.GSTVault.setupAuto();
        try { p.portal.passwordEnc = await self.GSTVault.encrypt(t.password); changed = true; } catch (_) { return reply({ error: 'locked' }); }
      }
      if (changed) { p.updated = new Date().toISOString(); p.portal.changedAt = p.updated; await chrome.storage.local.set({ [K.profiles]: list }); }
      return reply({ saved: changed });
    }
    // Clients sent from CA Desk (one GST Desk client per GSTIN). Existing details are kept; blanks are filled.
    if (msg.type === 'import-clients' || msg.type === 'reload-self' || msg.type === 'export-clients') {
      const from = sender && sender.url ? new URL(sender.url) : null;
      if (!from || from.hostname !== 'smishra724.github.io') return reply({ error: 'not allowed' });
      if (msg.type === 'export-clients') return reply(await exportClients());
      if (msg.type === 'reload-self') { reply({ ok: true }); setTimeout(() => chrome.runtime.reload(), 100); return; }
      return reply(await importClients(msg.clients || [], !!msg.replacePasswords));
    }
    if (msg.type === 'expect-download') {
      await chrome.storage.session.set({ [EXPECT]: { ...msg.info, at: Date.now() } });
      return reply({ ok: true });
    }
    if (msg.type === 'clear-expect') { await chrome.storage.session.remove(EXPECT); return reply({ ok: true }); }
    reply({});
  })();
  return true;
});

function plannedName(ex, origName, mime) {
  let ext = (/\.([a-z0-9]{2,5})$/i.exec(origName || '') || [])[1];
  if (!ext) ext = /pdf/.test(mime) ? 'pdf' : /json/.test(mime) ? 'json' : /sheet|excel/.test(mime) ? 'xlsx' : /zip/.test(mime) ? 'zip' : 'bin';
  return `GST Desk/${safe(ex.client)}/${fyOf(ex.period)}/${ex.ret}_${mmyyyy(ex.period)}_${ex.kind}.${ext.toLowerCase()}`;
}
const isGst = (item) => /gst\.gov\.in/i.test([item.url, item.finalUrl, item.referrer].join(' '));
async function freshExpect() {
  const ex = (await chrome.storage.session.get(EXPECT))[EXPECT];
  return ex && Date.now() - ex.at < 180000 ? ex : null;
}
async function markJob(ex, name, final) {
  const q = (await chrome.storage.local.get(K.queue))[K.queue];
  if (q && ex.jobId) {
    for (const it of q.items) for (const j of it.jobs) if (j.id === ex.jobId && (final || j.status !== 'downloaded')) { j.status = 'downloaded'; j.filename = name; j.note = ''; }
    await chrome.storage.local.set({ [K.queue]: q });
  }
  const log = (await chrome.storage.local.get(K.downloads))[K.downloads] || [];
  if (log.length && log[0].jobId === ex.jobId && log[0].at > new Date(Date.now() - 60000).toISOString()) log[0].file = name;
  else log.unshift({ at: new Date().toISOString(), jobId: ex.jobId, client: ex.client, ret: ex.ret, period: ex.period, kind: ex.kind, file: name });
  await chrome.storage.local.set({ [K.downloads]: log.slice(0, 500) });
}

// A download started from the portal while the runner was waiting for one → that job is done.
chrome.downloads.onCreated.addListener((item) => {
  (async () => {
    const ex = await freshExpect();
    if (!ex || !isGst(item) || ex.createdId) return;
    ex.createdId = item.id;
    await chrome.storage.session.set({ [EXPECT]: ex });
    await markJob(ex, plannedName(ex, item.filename, item.mime));
  })();
});

// Give it a tidy name: GST Desk/<Client>/<FY>/<RET>_<MMYYYY>_<Kind>.<ext>
chrome.downloads.onDeterminingFilename.addListener((item, suggest) => {
  (async () => {
    const ex = await freshExpect();
    if (!ex || !isGst(item) || (ex.createdId !== undefined && ex.createdId !== item.id)) return suggest();
    const name = plannedName(ex, item.filename, item.mime);
    suggest({ filename: name, conflictAction: 'uniquify' });
    await chrome.storage.session.remove(EXPECT);
    await markJob(ex, name, true);
  })();
  return true;
});

/* ---------- clients from CA Desk ---------- */
function constitutionKey(t) {
  t = String(t || '').toLowerCase();
  if (/llp|limited liability/.test(t)) return 'llp';
  if (/public/.test(t)) return 'public_company';
  if (/private|pvt|opc|one person|company/.test(t)) return 'pvt_company';
  if (/partner/.test(t)) return 'partnership';
  return 'proprietorship';
}
async function importClients(list, replacePasswords) {
  const r = await chrome.storage.local.get(K.profiles);
  const profiles = (r[K.profiles] || []).map(G.normalizeProfile);
  if ((await self.GSTVault.state()) === 'none') await self.GSTVault.setupAuto();
  const canEncrypt = (await self.GSTVault.state()) === 'unlocked';
  const out = { added: 0, updated: 0, unchanged: 0, passwords: 0, locked: 0, skipped: 0, ids: {} };
  let anyLinked = false;
  for (const c of list) {
    const gstin = String(c.gstin || '').toUpperCase().replace(/\s/g, '');
    if (!/^\d{2}[A-Z]{5}\d{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/.test(gstin)) { out.skipped++; continue; }
    let p = profiles.find(x => x.gstin === gstin);
    const isNew = !p;
    if (isNew) { p = G.newProfile(constitutionKey(c.constitution)); p.gstin = gstin; p.status = 'registered'; profiles.push(p); }
    const before = JSON.stringify(p);
    const fill = (obj, k, v) => { if (v && !obj[k]) obj[k] = String(v); };
    fill(p, 'nickname', c.name);
    fill(p.partA, 'legalName', c.legalName);
    fill(p.business, 'tradeName', c.tradeName);
    fill(p.partA, 'pan', gstin.slice(2, 12));
    if (!p.partA.state) p.partA.state = G.stateName(gstin.slice(0, 2)) || '';
    fill(p.partA, 'email', c.email);
    if (c.mobile && /^[6-9]\d{9}$/.test(String(c.mobile).replace(/\D/g, '').slice(-10))) fill(p.partA, 'mobile', String(c.mobile).replace(/\D/g, '').slice(-10));
    fill(p.tally, 'company', c.tallyCompany);
    // GST login: CA Desk's copy wins when it was saved later than GST Desk's (or GST Desk has none)
    const gdAt = Date.parse(p.portal.changedAt || '') || 0;
    const caNewer = !!c.credAt && c.credAt > gdAt + 1000;
    let credChanged = false;
    if (c.username && (!p.portal.username || replacePasswords || caNewer) && p.portal.username !== String(c.username).trim()) { p.portal.username = String(c.username).trim(); credChanged = true; }
    if (c.password && (!p.portal.passwordEnc || replacePasswords || caNewer)) {
      if (!canEncrypt) out.locked++;
      else {
        let cur = null; try { cur = await self.GSTVault.decrypt(p.portal.passwordEnc); } catch (_) { cur = null; }
        if (cur !== c.password) { p.portal.passwordEnc = await self.GSTVault.encrypt(String(c.password)); out.passwords++; credChanged = true; }
      }
    }
    if (credChanged) p.portal.changedAt = new Date(c.credAt || Date.now()).toISOString();
    const changed = JSON.stringify({ ...p, caDesk: null }) !== JSON.stringify({ ...JSON.parse(before), caDesk: null });
    if (isNew || changed || !p.caDesk || p.caDesk.cid !== (c.cid || '')) { p.caDesk = { cid: c.cid || '', at: new Date().toISOString() }; anyLinked = true; }
    if (isNew) out.added++; else if (changed) out.updated++; else out.unchanged++;
    if (isNew || changed) p.updated = new Date().toISOString();
    out.ids[gstin] = p.id;
  }
  if (out.added || out.updated || out.passwords || anyLinked) await chrome.storage.local.set({ [K.profiles]: profiles });   // no write (and no "changed" ping) when nothing changed
  return out;
}

// For CA Desk (smishra724.github.io only): GST Desk clients with their GST login, so CA Desk can keep its masters in step.
async function exportClients() {
  const r = await chrome.storage.local.get(K.profiles);
  const unlocked = (await self.GSTVault.state()) === 'unlocked';
  const out = [];
  for (const p of (r[K.profiles] || []).map(G.normalizeProfile)) {
    let password = '';
    if (unlocked && p.portal.passwordEnc) { try { password = await self.GSTVault.decrypt(p.portal.passwordEnc); } catch (_) { password = ''; } }
    out.push({ id: p.id, gstin: p.gstin, name: G.displayName(p), legalName: p.partA.legalName, tradeName: p.business.tradeName, pan: p.partA.pan || (p.gstin || '').slice(2, 12),
      constitution: G.CONSTITUTIONS[p.constitution].label, status: p.status, email: p.partA.email, mobile: p.partA.mobile,
      username: p.portal.username || '', password, changedAt: p.portal.changedAt || '', tallyCompany: p.tally.company || '', caCid: (p.caDesk && p.caDesk.cid) || '' });
  }
  return { clients: out, locked: !unlocked };
}
