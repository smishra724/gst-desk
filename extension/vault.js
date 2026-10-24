/* Password vault: client portal passwords are encrypted with AES-GCM using a key derived
   (PBKDF2-SHA256) from one master password. The unlocked key is kept only in
   chrome.storage.session, which lives in memory and is wiped when Chrome closes. */
(function (root) {
  'use strict';
  const VAULT_KEY = 'gstf_vault';      // {salt, check:{iv,ct}} in storage.local
  const SESSION_KEY = 'gstf_vault_key'; // raw key (base64) in storage.session
  const ITER = 250000;
  const CHECK_TEXT = 'gst-desk-vault-ok';

  const enc = new TextEncoder(), dec = new TextDecoder();
  const b64 = (buf) => { let s = ''; new Uint8Array(buf).forEach(b => { s += String.fromCharCode(b); }); return btoa(s); };
  const unb64 = (s) => Uint8Array.from(atob(s), c => c.charCodeAt(0));

  async function derive(password, saltB64) {
    const base = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveKey']);
    return crypto.subtle.deriveKey({ name: 'PBKDF2', salt: unb64(saltB64), iterations: ITER, hash: 'SHA-256' },
      base, { name: 'AES-GCM', length: 256 }, true, ['encrypt', 'decrypt']);
  }
  async function encryptWith(key, text) {
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, enc.encode(text));
    return { iv: b64(iv), ct: b64(ct) };
  }
  async function decryptWith(key, box) {
    const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unb64(box.iv) }, key, unb64(box.ct));
    return dec.decode(pt);
  }
  async function sessionKey() {
    const r = await chrome.storage.session.get(SESSION_KEY);
    let raw = r[SESSION_KEY];
    if (!raw) {
      // "Remember on this computer": the key is kept in this Chrome profile, so nothing has to be typed after a restart.
      const v = (await chrome.storage.local.get(VAULT_KEY))[VAULT_KEY];
      if (v && v.auto && v.raw) raw = v.raw;
    }
    if (!raw) return null;
    return crypto.subtle.importKey('raw', unb64(raw), 'AES-GCM', true, ['encrypt', 'decrypt']);
  }
  async function keepKey(key) {
    const raw = await crypto.subtle.exportKey('raw', key);
    await chrome.storage.session.set({ [SESSION_KEY]: b64(raw) });
  }

  const Vault = {
    async state() {
      const r = await chrome.storage.local.get(VAULT_KEY);
      if (!r[VAULT_KEY]) return 'none';
      return (await sessionKey()) ? 'unlocked' : 'locked';
    },
    async create(master) {
      if (!master || master.length < 6) throw new Error('Use at least 6 characters');
      const salt = b64(crypto.getRandomValues(new Uint8Array(16)));
      const key = await derive(master, salt);
      const check = await encryptWith(key, CHECK_TEXT);
      await chrome.storage.local.set({ [VAULT_KEY]: { salt, check, iter: ITER } });   // replaces any "remember" key
      await keepKey(key);
    },
    async unlock(master) {
      const r = await chrome.storage.local.get(VAULT_KEY);
      const v = r[VAULT_KEY];
      if (!v) throw new Error('No master password set yet');
      const key = await derive(master, v.salt);
      try {
        if (await decryptWith(key, v.check) !== CHECK_TEXT) throw new Error();
      } catch (_) { throw new Error('Wrong master password'); }
      await keepKey(key);
    },
    async lock() { await chrome.storage.session.remove(SESSION_KEY); },
    // Saved on this computer: passwords are encrypted with a key kept in this Chrome profile – no master password to type.
    async isAuto() { const v = (await chrome.storage.local.get(VAULT_KEY))[VAULT_KEY]; return !!(v && v.auto); },
    async setupAuto() {
      const key = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, true, ['encrypt', 'decrypt']);
      const raw = b64(await crypto.subtle.exportKey('raw', key));
      await chrome.storage.local.set({ [VAULT_KEY]: { auto: true, raw, check: await encryptWith(key, CHECK_TEXT) } });
      await keepKey(key);
    },
    // Turn an unlocked master-password vault into "remember on this computer" (same key, so saved passwords keep working).
    async remember() {
      const r = await chrome.storage.session.get(SESSION_KEY);
      if (!r[SESSION_KEY]) throw new Error('Passwords are locked');
      const v = (await chrome.storage.local.get(VAULT_KEY))[VAULT_KEY] || {};
      await chrome.storage.local.set({ [VAULT_KEY]: { ...v, auto: true, raw: r[SESSION_KEY] } });
    },
    async encrypt(text) {
      const key = await sessionKey();
      if (!key) throw new Error('Passwords are locked');
      return encryptWith(key, text);
    },
    async decrypt(box) {
      if (!box || !box.ct) return '';
      const key = await sessionKey();
      if (!key) throw new Error('Passwords are locked');
      return decryptWith(key, box);
    },
    // Re-encrypt everything with a new master password (needs the vault unlocked).
    async change(newMaster, profiles) {
      const plain = [];
      for (const p of profiles) plain.push(p.portal && p.portal.passwordEnc ? await this.decrypt(p.portal.passwordEnc) : '');
      await this.create(newMaster);
      for (let i = 0; i < profiles.length; i++) if (plain[i]) profiles[i].portal.passwordEnc = await this.encrypt(plain[i]);
      return profiles;
    }
  };
  root.GSTVault = Vault;
})(typeof window !== 'undefined' ? window : globalThis);
