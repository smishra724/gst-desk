// Is GST Desk installed in this browser, and is it current?
import { CONFIG } from './config.js';
const cmp = (a, b) => { const x = String(a).split('.').map(Number), y = String(b).split('.').map(Number); for (let i = 0; i < 3; i++) if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) - (y[i] || 0); return 0; };

export function extensionState(timeout = 1200) {
  return new Promise((res) => {
    const done = () => {
      const v = document.documentElement.getAttribute('data-gstdesk-extension');
      if (!v) return res({ installed: false, latest: CONFIG.extensionVersion });
      res({ installed: true, version: v, latest: CONFIG.extensionVersion, outdated: cmp(CONFIG.extensionVersion, v) > 0 });
    };
    if (document.documentElement.getAttribute('data-gstdesk-extension')) return done();
    const t = setTimeout(done, timeout);
    window.addEventListener('message', function on(e) { if (e.source === window && e.data && e.data.gstdesk === 'ext' && e.data.event === 'ready') { clearTimeout(t); window.removeEventListener('message', on); done(); } });
  });
}

const STEPS_NEW = `<ol><li>Unzip the download to a folder you'll keep (e.g. Documents\\gst-desk).</li><li>Open <code>chrome://extensions</code> and turn on <b>Developer mode</b>.</li><li>Click <b>Load unpacked</b> and choose the unzipped <b>gst-desk</b> folder.</li><li>Come back to this page – it will show “Installed”.</li></ol>`;
const STEPS_UPDATE = `<ol><li>Download the update and unzip it.</li><li>Copy everything from the new <b>gst-desk</b> folder <b>into your existing GST Desk folder</b>, replacing the files.</li><li>In GST Desk click <b>Reload GST Desk</b> (or the ↻ on its card in <code>chrome://extensions</code>).</li></ol><p class="warnline">Don't remove the extension to update – removing it deletes the clients saved in it.</p>`;

// Renders the install / update / installed card into `el`.
export async function renderInstallCard(el, { dark = false, onOpen } = {}) {
  const s = await extensionState();
  const store = CONFIG.storeUrl;
  const zip = CONFIG.extensionZip;
  const btnCls = dark ? 'btn primary' : 'btn primary';
  if (s.installed && !s.outdated) {
    el.innerHTML = `<h2>✓ GST Desk is installed</h2><div class="small sub">Version ${s.version} · up to date</div>
      <div class="row">${onOpen ? '<button class="btn primary" id="ext-open">Open GST Desk</button>' : ''}<a class="btn ghost" href="${CONFIG.repo}" target="_blank" rel="noopener">View on GitHub</a></div>`;
  } else if (s.installed) {
    el.innerHTML = `<h2>Update GST Desk to ${s.latest}</h2><div class="small sub">You have version ${s.version}${store ? ' – the Web Store updates it automatically' : ''}.</div>
      <div class="row">${store ? `<a class="${btnCls}" href="${store}" target="_blank" rel="noopener">Update in Chrome Web Store</a>` : `<a class="${btnCls}" href="${zip}" download="gst-desk-${s.latest}.zip">⬇ Download update ${s.latest}</a>`}</div>
      ${store ? '' : STEPS_UPDATE}`;
  } else {
    el.innerHTML = `<h2>Get the Chrome extension</h2><div class="small sub">Works in Google Chrome or Microsoft Edge on Windows or Mac · Version ${s.latest}</div>
      <div class="row">${store ? `<a class="${btnCls}" href="${store}" target="_blank" rel="noopener">Add to Chrome – free</a>` : `<a class="${btnCls}" id="dl-btn" href="${zip}" download>⬇ Download GST Desk extension</a>`}
        <a class="btn ghost" href="${CONFIG.repo}" target="_blank" rel="noopener">View on GitHub</a></div>
      ${store ? '<div class="small sub">One click – Chrome installs it and keeps it updated.</div>' : STEPS_NEW}
      <div class="small sub" style="margin-top:6px">Already have an older GST Desk (before 2.1)? It can't be detected here – use the download above and follow the update steps in it.</div>`;
  }
  const o = el.querySelector('#ext-open');
  if (o && onOpen) o.addEventListener('click', onOpen);
  return s;
}
