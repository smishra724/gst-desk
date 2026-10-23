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
  'auth/operation-not-allowed': 'Email/password sign-in is not switched on in Firebase yet.'
};
export const friendly = (e) => FRIENDLY[e && e.code] || (e && e.message ? e.message.replace(/^Firebase:\s*/, '') : 'Something went wrong.');

export const configured = () => !!(CONFIG.firebase && CONFIG.firebase.apiKey && CONFIG.firebase.authDomain);

async function load() {
  if (api) return api;
  if (window.__GSTDESK_TEST_AUTH__) { api = window.__GSTDESK_TEST_AUTH__; return api; } // used only by automated tests
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
