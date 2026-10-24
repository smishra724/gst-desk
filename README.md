# GST Desk

A Chrome extension for GST practitioners in India:

- **Client master** – GSTIN, portal login (password encrypted with a master password), Tally company, and full registration details.
- **GST registration** – fills the new-registration forms on reg.gst.gov.in (including the Rule 14A option) and attaches the client's saved documents; you type every CAPTCHA/OTP and submit yourself.
- **File registration autopilot** – one click in a client opens the GST portal and types everything in: Part A, then (after your CAPTCHA/OTP) saves the TRN, logs in with it, opens the application and fills every tab – adding each promoter, attaching documents, picking HSN/SAC codes and clicking Save & Continue. It stops at Verification for you to tick the declaration and submit with DSC/EVC.
- **Dropdowns from the portal** – district lists are read from the portal's New Registration page; ward / commissionerate / division / range lists are read from the Principal Place of Business tab. HSN/SAC codes show their description (portal search, or the portal's HSN directory Excel).
- **Documents** – upload PAN, Aadhaar, photos, incorporation certificate, address proof etc. once per client. Photos are resized to the portal's 100 KB limit, and details (PAN, names, DOB, CIN, incorporation date, address PIN, IFSC) are read from text PDFs to fill the client form.
- **Bulk return downloads** – GSTR-1 (PDF/JSON), GSTR-2B (Excel/JSON) and GSTR-3B (PDF) for many clients and months; you type one CAPTCHA per client. Files are saved as `Downloads/GST Desk/<Client>/<FY>/…`.
- **Tally import** – reads TallyPrime over the ODBC/XML port (9000).
- **GST work** – sales/purchase registers, GSTR-1 JSON, GSTR-3B working, GSTR-2B and GSTR-1 reconciliation with Excel reports.

All client data stays in your browser. Nothing is sent to any server other than the GST portal and your own Tally.

## Website: sign-in + dashboard

`docs/` is a GitHub Pages site: **https://smishra724.github.io/gst-desk/**

- **Login page** – email/password accounts (Firebase) and the extension download button.
- **Dashboard** – clients, saved logins, download queue progress, recent files and due dates, read live from the GST Desk extension installed in the same Chrome (read-only; passwords never leave the extension).

### Turn on the website (once)
1. Repo **Settings → Pages** → Source: *Deploy from a branch* → Branch `main`, folder `/docs` → Save.

### Setting up accounts (once, free)
1. Go to <https://console.firebase.google.com> → **Add project** (Analytics not needed).
2. **Build → Authentication → Get started → Sign-in method → Email/Password → Enable**.
3. **Authentication → Settings → Authorised domains → Add domain**: `smishra724.github.io`.
4. **Project settings (gear) → Your apps → Web (`</>`)** → register an app → copy `apiKey`, `authDomain`, `projectId`, `appId`.
5. Paste them into `docs/config.js` and commit. Sign-up and sign-in now work.

## Install the extension

1. Download `gst-desk.zip` from the website's sign-in page (or `docs/gst-desk.zip` here) and unzip it.
2. Open `chrome://extensions`, turn on **Developer mode**, click **Load unpacked** and pick the unzipped `gst-desk` folder (or `extension/` if you cloned the repo).
3. Chrome → Settings → Downloads → turn off *Ask where to save each file*.
4. TallyPrime: F1 → Settings → Connectivity → Client/Server: *Both*, Enable ODBC *Yes*, Port *9000*.

Full usage notes: [`extension/README.txt`](extension/README.txt).

## Notes

- Filing/submitting returns (EVC/DSC) is always done by you.
- If the GST portal changes a button, the extension asks you to click it once and remembers it.
- Check generated GSTR-1 JSON in the GST offline tool before uploading.
