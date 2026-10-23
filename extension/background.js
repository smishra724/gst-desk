/* Service worker: opens the manager, hands saved logins to the portal runner,
   and names downloaded return files into GST Desk/<Client>/<FY>/ folders. */
importScripts('schema.js', 'vault.js');
const G = self.GSTR;
const K = G.KEYS;
const EXPECT = 'gstf_expect';

chrome.action.onClicked.addListener(() => chrome.tabs.create({ url: chrome.runtime.getURL('manager.html') }));

const safe = (s) => String(s || '').replace(/[\\/:*?"<>|]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 60) || 'Client';
const fyOf = (period) => { const [y, m] = period.split('-').map(Number); return m >= 4 ? `FY ${y}-${String((y + 1) % 100).padStart(2, '0')}` : `FY ${y - 1}-${String(y % 100).padStart(2, '0')}`; };
const mmyyyy = (period) => { const [y, m] = period.split('-'); return `${m}${y}`; };

chrome.runtime.onMessage.addListener((msg, sender, reply) => {
  (async () => {
    if (!msg || !msg.type) return reply({});
    if (msg.type === 'open-manager') {
      await chrome.tabs.create({ url: chrome.runtime.getURL('manager.html' + (msg.hash || '')) });
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
