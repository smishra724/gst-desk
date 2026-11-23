# CA Desk Bridge (Windows)

A small desktop helper for CA Desk / GST Desk — installed once, like a DSC utility (WD ProxKey, HyperPKI):

- sits in the system tray and starts with Windows;
- **Update now** (tray menu, or CA Desk → Settings) downloads the new CA Desk Suite extension in the background;
  the extension restarts itself within a minute — no folders, no Reload;
- optional *Update automatically in the background* (tray menu);
- lets CA Desk read from Tally and see DSC certificates on this computer (only `127.0.0.1`, only CA Desk / the extension).

**One installer:** `CA-Desk-Bridge.exe` — double-click to install and start. It connects CA Desk to Tally + DSC, finds the
GST Desk / CA Desk Suite folder Chrome already loads (or downloads a fresh copy and opens chrome://extensions for the
one-time Load unpacked), and keeps it up to date. Run it again any time; `/uninstall` (or Settings → Apps) removes it.
(`CA-Desk-Connector.exe` is the same file under its old name.)

**Older console installer:** download `CA-Desk-Bridge-Setup.exe` and double-click it (per user, no admin). It is not code-signed, so SmartScreen may say
"Windows protected your PC" → More info → Run anyway. (`CA-Desk-Bridge-Setup.zip` with the `.cmd` does the same.)
Uninstall: Settings → Apps → CA Desk Bridge → Uninstall, or `CA-Desk-Bridge-Setup.exe /uninstall`.

The .exe is a small launcher (`exe/setup.c`) with the installer script from `CA-Desk-Bridge-Setup.cmd` embedded.
Rebuild: `MINGW=/path/to/llvm-mingw python3 tools/build_exe.py` (or set MINGW when running `tools/release.py`).

Files: `bridge.ps1` (the app, Windows PowerShell 5.1), `launcher.vbs` (starts it without a window), `icon.ico`,
`version.json` (written by `tools/release.py`: app files + extension files the Bridge downloads).
