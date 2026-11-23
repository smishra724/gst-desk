#!/usr/bin/env python3
"""Build bridge/CA-Desk-Bridge-Setup.exe from bridge/exe/setup.c with the installer script
embedded from bridge/CA-Desk-Bridge-Setup.cmd (the part after #PSBEGIN#).
Needs an llvm-mingw cross toolchain: set MINGW=/path/to/llvm-mingw (folder that holds bin/)."""
import os, re, subprocess, sys
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
mingw = os.environ.get('MINGW')
if not mingw or not os.path.isdir(mingw):
    sys.exit('Set MINGW to the llvm-mingw folder')
cc = os.path.join(mingw, 'bin', 'x86_64-w64-mingw32-clang')
rc = os.path.join(mingw, 'bin', 'x86_64-w64-mingw32-windres')
d = os.path.join(ROOT, 'bridge', 'exe')
t = open(os.path.join(ROOT, 'bridge', 'CA-Desk-Bridge-Setup.cmd'), newline='').read()
script = t[t.rindex('#PSBEGIN#') + 9:].lstrip('\r\n').replace('\r\n', '\n').replace('\n', '\r\n').encode('utf-8')
with open(os.path.join(d, 'script.h'), 'w') as h:
    h.write('static const unsigned char SCRIPT[] = {')
    h.write(','.join(str(b) for b in script))
    h.write('};\n#define SCRIPT_LEN %d\n' % len(script))
bv = re.search(r"\$AppVersion = '([^']+)'", open(os.path.join(ROOT, 'bridge', 'bridge.ps1')).read()).group(1)
a, b, c = (bv.split('.') + ['0', '0'])[:3]
out = os.path.join(ROOT, 'bridge', 'CA-Desk-Bridge-Setup.exe')
res = os.path.join(d, 'setup.res.o')
subprocess.check_call([rc, '-I', d, f'-DVMAJ={a}', f'-DVMIN={b}', f'-DVPAT={c}', f'-DVSTR=\\"{bv}\\"', os.path.join(d, 'setup.rc'), '-O', 'coff', '-o', res], cwd=d)
subprocess.check_call([cc, '-municode', '-Os', '-s', '-static', '-o', out, os.path.join(d, 'setup.c'), res], cwd=d)
os.remove(res); os.remove(os.path.join(d, 'script.h'))
print('built', out, os.path.getsize(out), 'bytes')

# ---- CA-Desk-Connector.exe: connector only (no browser extension) ----
def carr(name, data):
    return 'static const unsigned char %s[] = {%s};\n#define %s_LEN %d\n' % (name, ','.join(str(b) for b in data), name, len(data))
def crlf(path):
    return open(path, newline='').read().replace('\r\n', '\n').replace('\n', '\r\n').encode('utf-8')
B = os.path.join(ROOT, 'bridge')
with open(os.path.join(d, 'payload.h'), 'w') as h:
    h.write(carr('BOOT', crlf(os.path.join(d, 'connector.ps1'))))
    h.write(carr('BRIDGE', crlf(os.path.join(B, 'bridge.ps1'))))
    h.write(carr('LAUNCHER', open(os.path.join(B, 'launcher.vbs'), 'rb').read()))
    h.write(carr('ICON', open(os.path.join(B, 'icon.ico'), 'rb').read()))
out = os.path.join(B, 'CA-Desk-Connector.exe')
subprocess.check_call([rc, '-I', d, f'-DVMAJ={a}', f'-DVMIN={b}', f'-DVPAT={c}', f'-DVSTR=\\"{bv}\\"', os.path.join(d, 'connector.rc'), '-O', 'coff', '-o', res], cwd=d)
subprocess.check_call([cc, '-municode', '-mwindows', '-Os', '-s', '-static', '-o', out, os.path.join(d, 'connector.c'), res, '-lshell32'], cwd=d)
os.remove(res); os.remove(os.path.join(d, 'payload.h'))
print('built', out, os.path.getsize(out), 'bytes')
