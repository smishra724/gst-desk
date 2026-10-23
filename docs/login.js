import { CONFIG } from './config.js';
import { Auth, friendly, configured, localMode } from './auth.js';
import { mountMenu } from './nav.js';

const $ = (s) => document.querySelector(s);
let mode = 'in';

$('#ver').textContent = `Version ${CONFIG.extensionVersion}`;
mountMenu([
  { icon: '→', label: 'Sign in', href: '#', onClick: () => { document.getElementById('email').focus(); } },
  { icon: '📦', label: 'Download extension', hint: `Version ${CONFIG.extensionVersion}`, href: CONFIG.extensionZip, download: true },
  { icon: '?', label: 'How to install', href: '#download' },
  { icon: '🧾', label: 'GST portal', href: 'https://www.gst.gov.in/', external: true },
  { icon: '⌘', label: 'GitHub', href: CONFIG.repo, external: true }
], { into: document.querySelector('.hero .logo'), light: true });
$('#dl-btn').href = CONFIG.extensionZip;
$('#gh-btn').href = CONFIG.repo;

function say(text, kind = 'err') { $('#msg').innerHTML = text ? `<div class="msg ${kind}">${text}</div>` : ''; }
const esc = (s) => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

function setMode(m) {
  mode = m;
  $('#tab-in').setAttribute('aria-selected', String(m === 'in'));
  $('#tab-up').setAttribute('aria-selected', String(m === 'up'));
  $('#name-f').hidden = m !== 'up';
  $('#forgot-row').hidden = m !== 'in';
  $('#title').textContent = m === 'in' ? 'Welcome back' : 'Create your account';
  $('#subtitle').textContent = m === 'in' ? 'Sign in to your GST Desk dashboard.' : 'Free. Takes a few seconds.';
  $('#submit').textContent = m === 'in' ? 'Sign in' : 'Create account';
  $('#password').autocomplete = m === 'in' ? 'current-password' : 'new-password';
  $('#switch-line').innerHTML = m === 'in' ? 'New here? <button class="linkbtn" id="to-up">Create an account</button>' : 'Already have an account? <button class="linkbtn" id="to-in">Sign in</button>';
  const t = $('#to-up') || $('#to-in');
  t.addEventListener('click', () => setMode(m === 'in' ? 'up' : 'in'));
  say('');
}
$('#tab-in').addEventListener('click', () => setMode('in'));
$('#tab-up').addEventListener('click', () => setMode('up'));
$('#to-up').addEventListener('click', () => setMode('up'));
$('#show').addEventListener('click', () => { const p = $('#password'); p.type = p.type === 'password' ? 'text' : 'password'; $('#show').textContent = p.type === 'password' ? 'Show' : 'Hide'; });

$('#forgot').addEventListener('click', async () => {
  const email = $('#email').value.trim();
  if (!email) { say('Type your email above, then click “Forgot password?” again.', 'info'); $('#email').focus(); return; }
  try { const a = await Auth.load(); await a.reset(email); say(`A password reset link was sent to <b>${esc(email)}</b>. Check your inbox (and spam).`, 'ok'); }
  catch (e) { say(friendly(e)); }
});

$('#form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const email = $('#email').value.trim(), pw = $('#password').value, name = $('#name').value.trim();
  if (!email || !pw) { say('Enter your email and password.'); return; }
  if (mode === 'up' && pw.length < 6) { say('Use at least 6 characters for the password.'); return; }
  const b = $('#submit');
  b.disabled = true; b.textContent = mode === 'in' ? 'Signing in…' : 'Creating account…';
  try {
    const a = await Auth.load();
    if (mode === 'in') await a.signIn(email, pw); else await a.signUp(name, email, pw);
    location.href = 'dashboard.html';
  } catch (err) {
    say(friendly(err));
    b.disabled = false; b.textContent = mode === 'in' ? 'Sign in' : 'Create account';
  }
});

(async function init() {
  if (localMode() && !window.__GSTDESK_TEST_AUTH__) {
    document.querySelector('.tabs').hidden = true;
    $('#switch-line').hidden = true;
    $('#forgot-row').hidden = true;
  } else if (!configured() && !window.__GSTDESK_TEST_AUTH__) {
    say('Accounts are not switched on for this site yet. The owner needs to add the Firebase settings in <code>docs/config.js</code> (see the README). You can still download the extension.', 'info');
    $('#submit').disabled = true;
    return;
  }
  try { if (await Auth.current()) location.replace('dashboard.html'); } catch (e) { say(friendly(e)); }
})();
