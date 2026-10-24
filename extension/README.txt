GST DESK – Chrome extension (v2)
================================
Client master · GST registration filling · Bulk GSTR-1 / 2B / 3B downloads ·
Tally import (port 9000) · GSTR-1 JSON · GSTR-3B working · Reconciliation

All data (clients, logins, Tally data) stays inside this Chrome profile.
Portal passwords are encrypted with your master password.

INSTALL / UPGRADE
1. Unzip to a permanent folder (e.g. Documents\gst-desk).
2. Chrome → chrome://extensions → Developer mode ON → "Load unpacked" → choose the folder.
   Upgrading from v1: remove the old "GST Registration Filler" first; export a backup
   from it before removing if you saved clients. Then Import the backup here.
3. Pin the extension. Click its icon to open GST Desk.
4. Chrome Settings → Downloads → turn OFF "Ask where to save each file".

CLIENTS TAB
- One record per client: GSTIN, portal username, password (encrypted), Tally company name.
- First time you save a password you create a MASTER PASSWORD. Type it once each time
  Chrome starts (button "Unlock passwords" at the top). It cannot be recovered.
- "Import all details from GST portal" (card 2): enter the GST ID and GST password,
  click the button, type the CAPTCHA and LOGIN. GST Desk opens the client's profile,
  reads every tab and fills the client master – legal/trade name, PAN, constitution,
  dates, CIN, jurisdiction, business address, activities, HSN/SAC, partners/directors
  (with DIN) and the authorised signatory. Empty fields are filled straight away; for
  fields that already hold something different you tick what to replace. Masked
  details (email/mobile shown as ****) are not copied. Everything read is shown in a
  review box first – untick anything wrong and click "Save ticked details". If something
  is picked up wrongly, click "Save what was read" on the portal and send that file. On any other portal page
  (e.g. Amendment of non-core fields – look only, don't save) click "Read this page too".
- "Applying for new registration" shows the full registration form (Part A, promoters,
  address, HSN…). The panel on reg.gst.gov.in fills those pages – as in v1.

DOWNLOAD RETURNS TAB
1. Tick clients, the financial year and months, and the files you want:
   GSTR-1 summary PDF, GSTR-1 JSON, GSTR-2B Excel, GSTR-2B JSON, GSTR-3B PDF.
2. Start downloads → the portal opens with username & password filled.
3. Type the CAPTCHA and click LOGIN. (OTP if the portal asks.)
4. GST Desk opens the returns dashboard, picks each month, downloads every file,
   logs out and fills the next client's login. You type the next CAPTCHA, and so on.
5. Files are saved to Downloads\GST Desk\<Client>\FY 2026-27\GSTR2B_042026_Details.xlsx …
- If the portal changed a button and GST Desk can't find it, the panel (bottom-left)
  says so. Click that button once yourself – it's remembered for every client.
- GSTR-1 JSON is prepared by the portal on request. If it isn't ready the file shows
  "requested": come back after 20–30 minutes and press "Download requested JSON now".
- GST Desk checks the GSTIN shown on the portal matches the client, and pauses if not.

TALLY & GST WORK TAB
Setup in TallyPrime (once): F1 Help → Settings → Connectivity →
  Client/Server configuration → TallyPrime acts as: Both · Enable ODBC: Yes · Port: 9000.
  Restart TallyPrime and open the company.
1. Pick the client, type/choose the Tally company, pick the months → Read from Tally.
2. Export sales/purchase/credit/debit note registers to Excel.
3. Build GSTR-1 JSON (one month): B2B, B2CL, B2CS, CDNR/CDNUR, HSN (B2B & B2C split),
   documents issued. Exports/SEZ and items without HSN are listed as exceptions.
   Open the JSON in the GST offline tool to check before uploading.
4. GSTR-2B reconciliation: choose the 2B JSON(s) → matched / value mismatch /
   only in books / only in 2B / GSTIN differs, with an Excel report.
   Invoice numbers are matched smartly (INV-0045 = INV45; FY prefixes ignored).
5. GSTR-3B working: 3.1(a)–(d), 3.2 from books; 4A ITC from 2B; books vs 2B ITC.
6. GSTR-1 reconciliation: choose the GSTR-1 JSON downloaded from the portal →
   compares invoice-wise (B2B, B2CL, notes) and B2CS in total.

GOOD TO KNOW
- Filing/submitting returns (EVC/DSC) is always done by you.
- Tally classification: Sales/Purchase/Credit Note/Debit Note voucher types (and
  types created under them). GST tax ledgers need "GST" type with the duty head set.
  Purchases use "Supplier Invoice No." (Reference) for matching with 2B.
- Rates come from the stock item GST details; for accounting invoices the effective
  rate is used and odd rates are flagged.
