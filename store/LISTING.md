# Chrome Web Store submission – GST Desk

Everything needed to publish GST Desk so the website's button becomes a one-click **Add to Chrome**, and updates install automatically.

## 1. Developer account (once)
1. Go to <https://chrome.google.com/webstore/devconsole> and sign in with your Google account.
2. Pay the one-time US$5 registration fee and verify your email.

## 2. Upload
1. **New item** → upload `docs/gst-desk.zip` (the extension zip from this repo).
2. Fill in the listing with the text below and upload the images in this folder.
3. **Privacy** tab: paste the privacy policy URL and the permission justifications below.
4. **Distribution**: Public (or *Unlisted* if only people with the link should find it).
5. **Submit for review** (usually a few days for a new extension).

## 3. After approval
Copy the store link (looks like `https://chromewebstore.google.com/detail/gst-desk/<id>`) and paste it into:
- `docs/config.js` → `storeUrl`
- `docs/version.json` → `storeUrl`

The website then shows **Add to Chrome** / **Update in Web Store**, and Chrome keeps everyone updated.
To publish a new version later: raise `version` in `extension/manifest.json`, rebuild the zip, upload it in the developer console.

> Note: the Web Store version gets a different extension ID from the unpacked one. Before switching, use **Export** in the unpacked GST Desk, then **Import** in the Web Store version.

---

## Listing text

**Name:** GST Desk – Registration, Returns & Tally

**Summary (132 chars max):**
Client master, GST registration filling, bulk GSTR-1/2B/3B downloads, Tally import and GSTR-2B reconciliation for GST practitioners.

**Category:** Productivity (Workflow & Planning)  **Language:** English (India)

**Description:**
GST Desk is a toolkit for GST practitioners and accountants in India.

• Client master – GSTIN, constitution, promoters, addresses, HSN/SAC and portal logins (passwords encrypted with your master password).
• Documents – upload PAN, Aadhaar, photos, incorporation certificate and address proof once. Photos are resized to the portal's 100 KB limit and details are read from text PDFs to fill the client form.
• GST registration – fills the new-registration tabs on the GST portal, including the Rule 14A option, and attaches saved documents. You enter every CAPTCHA and OTP and submit yourself.
• Bulk return downloads – GSTR-1 (PDF/JSON), GSTR-2B (Excel/JSON) and GSTR-3B (PDF) for many clients and months. Type one CAPTCHA per client; files are saved as GST Desk/Client/FY/…
• TallyPrime – reads sales, purchases and notes over Tally's ODBC/XML port (9000).
• GST work – sales/purchase registers in Excel, GSTR-1 JSON (B2B, B2CL, B2CS, CDNR, HSN, documents issued), GSTR-3B working, GSTR-2B and GSTR-1 reconciliation reports.

Privacy: all client data stays in your browser. Nothing is sent to the developer.
GST Desk is not affiliated with GSTN or the Government of India.

**Privacy policy URL:** https://smishra724.github.io/gst-desk/docs/privacy.html
(if GitHub Pages serves the `/docs` folder instead: https://smishra724.github.io/gst-desk/privacy.html)

## Single purpose
Helps GST practitioners prepare and manage GST registration and return work for their clients: client records, portal form filling, return downloads and reconciliation with Tally.

## Permission justifications
- **storage** – saves client records, settings and download history locally.
- **unlimitedStorage** – client documents (PDF/JPEG) are stored locally for uploading to the portal.
- **downloads** – names downloaded GST returns into per-client folders.
- **Host: https://*.gst.gov.in/*** – fills registration forms and downloads returns on the GST portal when the user asks.
- **Host: http://localhost/*, http://127.0.0.1/*** – reads accounting data from TallyPrime running on the user's computer.
- **Host: https://smishra724.github.io/*** – checks for the latest version and links the GST Desk web dashboard.
- **Remote code:** No. All code is inside the package.

## Data usage disclosures (tick in the console)
- Collects: *Personally identifiable information* and *Authentication information* – **stored locally only, not transmitted to the developer**.
- I do not sell or transfer user data to third parties; not used for unrelated purposes; not used for credit-worthiness or lending.

## Images in this folder
- `icon-128.png` – store icon
- `screenshot-1…5-*.png` – 1280×800 screenshots
- `promo-tile-440x280.png` – small promo tile
