// GST Desk website settings.
// Accounts use Firebase Authentication (free). Paste your Firebase web app config below –
// see "Setting up accounts" in the repository README. These values are public by design;
// security comes from Firebase's authorised-domain list.
export const CONFIG = {
  firebase: {
    apiKey: '',
    authDomain: '',
    projectId: '',
    appId: ''
  },
  // Built-in sign-in used until Firebase is set up. Only a salted PBKDF2 hash is stored here.
  // Ask to change the password and a new hash is generated.
  localAccounts: [
    { email: 'smishra724@gmail.com', name: 'Owner', salt: '8df3e42f8f238438fb2a99d031f4967a', hash: 'ffbe05d7273a872b4d508248380a9e80dd73ac2a137fd20e517a4bf01bb912ea', iterations: 200000 }
  ],
  // Name of the extension zip in this folder
  extensionZip: 'gst-desk.zip',
  extensionVersion: '2.6.0',
  // After publishing on the Chrome Web Store, paste the listing link here – the site then shows a one-click “Add to Chrome”.
  storeUrl: '',
  repo: 'https://github.com/smishra724/gst-desk'
};
