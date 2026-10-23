// Account layer: Firebase email/password sign-in.
import { CONFIG } from './config.js';

const FB = 'https://www.gstatic.com/firebasejs/10.12.2/';
let api = null;

const FRIENDLY = {
  'auth/invalid-email': 'That email address looks wrong.',
  'auth/missing-password': 'Type your password.',
  'auth/invalid-credential': 'Email or password is incorrect.',
  'auth/wrong-password': 'Email or password is incorrect.',
  'auth/user-not-found': 'No account with that email. Create one first.',
  'auth/email-already-in-use': 'An account with this email already exists – sign in instead.',
  'auth/weak-password': 'Use at least 6 characters for the password.',
  'auth/too-many-requests': 'Too many attempts. Wait a few minutes and try again.',
  'auth/network-request-failed': 'No internet connection to the sign-in service.',
  'auth/unauthorized-domain': 'This website address is not allowed in Firebase yet (add it under Authentication → Settings → Authorised domains).',
  'auth/operation-not-allowed': 'Email/password sign-in is not switched on in Firebase yet.',
  'local/signup': 'New accounts open once online accounts (Firebase) are set up. Use the owner login for now.',
  'local/reset': 'Password reset works once online accounts (Firebase) are set up. Ask the site owner for a new password.'
};
export const friendly = (e) => FRIENDLY[e && e.code] || (e && e.message ? e.message.replace(/^Firebase:\s*/, '') : 'Something went wrong.');

export const configured = () => !!(CONFIG.firebase && CONFIG.firebase.apiKey && CONFIG.firebase.authDomain);
export const localMode = () => !configured() && !!(CONFIG.localAccounts && CONFIG.localAccounts.length);

// Built-in owner sign-in (used until Firebase is configured). Session is kept in this browser.
function localApi() {
  const KEY = 'gstdesk_session';
  const listeners = new Set();
  const cur = () => { try { return JSON.parse(localStorage.getItem(KEY) || 'null'); } catch (_) { return null; } };
  const hex = (buf) => Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
  async function hash(pw, acc) {
    const base = await crypto.subtle.importKey('raw', new TextEncoder().encode(pw), 'PBKDF2', false, ['deriveBits']);
    return hex(await crypto.subtle.deriveBits({ name: 'PBKDF2', salt: new TextEncoder().encode(acc.salt), iterations: acc.iterations || 200000, hash: 'SHA-256' }, base, 256));
  }
  const err = (code) => Object.assign(new Error(code), { code });
  return {
    onChange(cb) { listeners.add(cb); setTimeout(() => cb(cur()), 0); return () => listeners.delete(cb); },
    async signIn(email, pw) {
      const acc = CONFIG.localAccounts.find(a => a.email.toLowerCase() === String(email).trim().toLowerCase());
      if (!acc || await hash(pw, acc) !== acc.hash) throw err('auth/invalid-credential');
      const user = { email: acc.email, displayName: acc.name === 'Owner' ? '' : acc.name };
      localStorage.setItem(KEY, JSON.stringify(user));
      listeners.forEach(f => f(user));
    },
    async signUp() { throw err('local/signup'); },
    async reset() { throw err('local/reset'); },
    async signOut() { localStorage.removeItem(KEY); listeners.forEach(f => f(null)); }
  };
}

async function load() {
  if (api) return api;
  if (window.__GSTDESK_TEST_AUTH__) { api = window.__GSTDESK_TEST_AUTH__; return api; } // used only by automated tests
  if (localMode()) { api = localApi(); return api; }
  if (!configured()) throw Object.assign(new Error('Accounts are not set up yet'), { code: 'not-configured' });
  const [{ initializeApp }, A] = await Promise.all([import(FB + 'firebase-app.js'), import(FB + 'firebase-auth.js')]);
  const app = initializeApp(CONFIG.firebase);
  const auth = A.getAuth(app);
  await A.setPersistence(auth, A.browserLocalPersistence);
  api = {
    onChange: (cb) => A.onAuthStateChanged(auth, cb),
    signIn: (email, pw) => A.signInWithEmailAndPassword(auth, email, pw),
    async signUp(name, email, pw) {
      const cred = await A.createUserWithEmailAndPassword(auth, email, pw);
      if (name) await A.updateProfile(cred.user, { displayName: name });
      try { await A.sendEmailVerification(cred.user); } catch (_) { /* optional */ }
      return cred;
    },
    reset: (email) => A.sendPasswordResetEmail(auth, email),
    signOut: () => A.signOut(auth)
  };
  return api;
}

export const Auth = {
  load,
  // Resolves with the signed-in user (or null) once Firebase has checked.
  async current() {
    const a = await load();
    return new Promise((res) => { const off = a.onChange((u) => { if (off) off(); res(u); }); });
  }
};
