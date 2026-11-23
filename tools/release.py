#!/usr/bin/env python3
"""Build everything that GitHub Pages serves for an update:
extension/files.json, docs/version.json + docs/config.js version, docs/gst-desk.zip (Load-unpacked zip),
bridge/version.json (what CA Desk Bridge downloads) and bridge/CA-Desk-Bridge-Setup.zip (the installer).
Usage: python3 tools/release.py "release notes"   (version comes from extension/manifest.json)"""
import json, os, re, sys, zipfile, io
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
os.chdir(ROOT)
notes = sys.argv[1] if len(sys.argv) > 1 else ''
v = json.load(open('extension/manifest.json'))['version']
files = sorted(os.path.relpath(os.path.join(r, f), 'extension').replace(os.sep, '/') for r, _, fs in os.walk('extension') for f in fs if f != 'files.json')
json.dump({'version': v, 'files': files}, open('extension/files.json', 'w'))
c = open('docs/config.js').read()
c = re.sub(r"extensionVersion: '[^']*'", f"extensionVersion: '{v}'", c)
open('docs/config.js', 'w').write(c)
old = json.load(open('docs/version.json'))
json.dump({'version': v, 'zip': 'gst-desk.zip', 'notes': notes or old.get('notes', ''), 'storeUrl': old.get('storeUrl', '')}, open('docs/version.json', 'w'), indent=2)
# Load-unpacked zip with a gst-desk/ folder inside
with zipfile.ZipFile('docs/gst-desk.zip', 'w', zipfile.ZIP_DEFLATED) as z:
    for f in files: z.write(os.path.join('extension', f), 'gst-desk/' + f)
# Bridge
bv = re.search(r"\$AppVersion = '([^']+)'", open('bridge/bridge.ps1', encoding='utf-8-sig').read()).group(1)
# bridge.ps1: UTF-8 with BOM + CRLF (Windows PowerShell 5.1 reads it right; same bytes as inside the .exe)
_b = open('bridge/bridge.ps1', encoding='utf-8-sig', newline='').read().replace('\r\n', '\n').replace('\n', '\r\n')
open('bridge/bridge.ps1', 'w', encoding='utf-8-sig', newline='').write(_b)
for f in ['CA-Desk-Bridge-Setup.cmd', 'launcher.vbs']:   # Windows line endings
    t = open('bridge/' + f, newline='').read().replace('\r\n', '\n').replace('\n', '\r\n')
    open('bridge/' + f, 'w', newline='').write(t)
json.dump({'version': bv, 'files': ['bridge.ps1', 'launcher.vbs', 'icon.ico'], 'extensionVersion': v,
           'extensionBase': 'https://smishra724.github.io/gst-desk/extension/', 'extensionFiles': files, 'notes': notes or old.get('notes', '')},
          open('bridge/version.json', 'w'), indent=1)
with zipfile.ZipFile('bridge/CA-Desk-Bridge-Setup.zip', 'w', zipfile.ZIP_DEFLATED) as z:
    z.write('bridge/CA-Desk-Bridge-Setup.cmd', 'CA-Desk-Bridge-Setup.cmd')
if os.environ.get('MINGW'):   # also rebuild CA-Desk-Bridge-Setup.exe (embeds the installer script)
    import subprocess; subprocess.check_call([sys.executable, 'tools/build_exe.py'])
print('extension', v, len(files), 'files; bridge', bv)
