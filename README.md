# GST Desk

A Chrome extension for GST practitioners in India:

- **Client master** – GSTIN, portal login (password encrypted with a master password), Tally company, and full registration details.
- **GST registration** – fills the new-registration forms on reg.gst.gov.in; you type every CAPTCHA/OTP and submit yourself.
- **Bulk return downloads** – GSTR-1 (PDF/JSON), GSTR-2B (Excel/JSON) and GSTR-3B (PDF) for many clients and months; you type one CAPTCHA per client. Files are saved as `Downloads/GST Desk/<Client>/<FY>/…`.
- **Tally import** – reads TallyPrime over the ODBC/XML port (9000).
- **GST work** – sales/purchase registers, GSTR-1 JSON, GSTR-3B working, GSTR-2B and GSTR-1 reconciliation with Excel reports.

All client data stays in your browser. Nothing is sent to any server other than the GST portal and your own Tally.

## Install

1. Download the latest `gst-desk.zip` from **Releases** (or clone this repo) and unzip it.
2. Open `chrome://extensions`, turn on **Developer mode**, click **Load unpacked** and pick the `extension` folder.
3. Chrome → Settings → Downloads → turn off *Ask where to save each file*.
4. TallyPrime: F1 → Settings → Connectivity → Client/Server: *Both*, Enable ODBC *Yes*, Port *9000*.

Full usage notes: [`extension/README.txt`](extension/README.txt).

## Notes

- Filing/submitting returns (EVC/DSC) is always done by you.
- If the GST portal changes a button, the extension asks you to click it once and remembers it.
- Check generated GSTR-1 JSON in the GST offline tool before uploading.
