# CA Desk Bridge (Windows)

A small desktop helper for CA Desk / GST Desk — installed once, like a DSC utility (WD ProxKey, HyperPKI):

- sits in the system tray and starts with Windows;
- **Update now** (tray menu, or CA Desk → Settings) downloads the new CA Desk Suite extension in the background;
  the extension restarts itself within a minute — no folders, no Reload;
- optional *Update automatically in the background* (tray menu);
- lets CA Desk read from Tally and see DSC certificates on this computer (only `127.0.0.1`, only CA Desk / the extension).

Install: download `CA-Desk-Bridge-Setup.zip`, unzip, double-click `CA-Desk-Bridge-Setup.cmd` (per user, no admin).
Uninstall: `CA-Desk-Bridge-Setup.cmd /uninstall`.

Files: `bridge.ps1` (the app, Windows PowerShell 5.1), `launcher.vbs` (starts it without a window), `icon.ico`,
`version.json` (written by `tools/release.py`: app files + extension files the Bridge downloads).
