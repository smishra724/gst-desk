# CA Desk Bridge - the desktop helper for CA Desk and GST Desk (works like a DSC utility such as WD ProxKey):
#  - sits in the Windows system tray and starts with Windows
#  - keeps the CA Desk Suite browser extension up to date: "Update now" downloads the new version in the
#    background and the extension restarts itself within a minute
#  - lets CA Desk (https://smishra724.github.io) talk to Tally and see DSC tokens on this computer
#  - opens CA Desk + the GST portal in its own browser window (Chrome for Testing, with GST Desk built in), so
#    nothing has to be added to your normal Chrome
# It listens only on 127.0.0.1 (this computer) and answers only CA Desk / the extension.
# Windows PowerShell 5.1 compatible.
param([switch]$NoTray, [int]$Port = 47731, [string]$Root = '', [string]$Base = 'https://smishra724.github.io/gst-desk/bridge/')

$ErrorActionPreference = 'Stop'
$AppVersion = '1.3.2'
if (-not $Root) { $Root = Split-Path -Parent $MyInvocation.MyCommand.Path }

# one copy only
$created = $false
$mutex = New-Object System.Threading.Mutex($true, 'CADeskBridge', [ref]$created)
if (-not $created) { exit 0 }

$State = [hashtable]::Synchronized(@{
  version = $AppVersion; root = $Root; port = $Port; base = $Base
  latest = $null; updating = $false; progress = ''; lastCheck = ''; lastError = ''; message = ''; updatedTo = ''
  extRunning = ''; extSeen = ''; updateRequested = $false; checkRequested = $true; restart = $false; stop = $false
  browserWanted = $false; browserBusy = $false; browserProgress = ''; browserError = ''; openAfterInstall = ''
})

# ---------- shared helpers (loaded in every thread) ----------
$Lib = @'
$ErrorActionPreference = 'Stop'
try { [Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12 } catch { }
function Get-Config {
  $f = Join-Path $State.root 'config.json'
  if (Test-Path -LiteralPath $f) { try { return (Get-Content -Raw -LiteralPath $f | ConvertFrom-Json) } catch { } }
  return [pscustomobject]@{ extDir = (Join-Path $State.root 'extension'); auto = $false }
}
function Test-ConnectorOnly { return ((Get-Config).connectorOnly -eq $true) }   # installed from CA-Desk-Connector.exe: Tally/DSC connector only, no browser extension
function Get-ExtDir { $c = Get-Config; if ($c.extDir) { return [string]$c.extDir }; return (Join-Path $State.root 'extension') }
function Get-ExtVersion {
  $m = Join-Path (Get-ExtDir) 'manifest.json'
  if (-not (Test-Path -LiteralPath $m)) { return '' }
  try { return [string]((Get-Content -Raw -LiteralPath $m | ConvertFrom-Json).version) } catch { return '' }
}
function Test-Newer([string]$a, [string]$b) {   # is a newer than b
  if (-not $a) { return $false }; if (-not $b) { return $true }
  $x = ($a.Split('.') + @('0', '0', '0'))[0..2] | ForEach-Object { [int]$_ }
  $y = ($b.Split('.') + @('0', '0', '0'))[0..2] | ForEach-Object { [int]$_ }
  for ($i = 0; $i -lt 3; $i++) { if ($x[$i] -ne $y[$i]) { return ($x[$i] -gt $y[$i]) } }
  return $false
}
function New-Web { $w = New-Object System.Net.WebClient; $w.Encoding = [Text.Encoding]::UTF8; $w.Headers['Cache-Control'] = 'no-cache'; return $w }
function Invoke-Check {
  $w = New-Web
  $j = $w.DownloadString($State.base + 'version.json?t=' + [DateTime]::UtcNow.Ticks) | ConvertFrom-Json
  $State.latest = $j
  $State.lastCheck = (Get-Date).ToString('yyyy-MM-dd HH:mm')
  $State.lastError = ''
  return $j
}
function Test-UpdateAvailable {
  $l = $State.latest; if (-not $l) { return $false }
  if (Test-ConnectorOnly) { return (Test-Newer ([string]$l.version) $State.version) }
  return ((Test-Newer ([string]$l.version) $State.version) -or (Test-Newer ([string]$l.extensionVersion) (Get-ExtVersion)))
}
function Save-Url([string]$url, [string]$path) {
  $d = Split-Path -Parent $path; if (-not (Test-Path -LiteralPath $d)) { New-Item -ItemType Directory -Force -Path $d | Out-Null }
  (New-Web).DownloadFile($url + '?t=' + [DateTime]::UtcNow.Ticks, $path)
}
# ---------- the CA Desk window: Chrome for Testing with the GST Desk extension loaded (no Chrome set-up) ----------
function Get-BrowserInfo {
  $f = Join-Path $State.root 'browser.json'
  if (Test-Path -LiteralPath $f) { try { $b = Get-Content -Raw -LiteralPath $f | ConvertFrom-Json; if ($b.exe -and (Test-Path -LiteralPath ([string]$b.exe))) { return $b } } catch { } }
  return $null
}
function Get-LatestBrowserVersion {
  $j = (New-Web).DownloadString('https://googlechromelabs.github.io/chrome-for-testing/last-known-good-versions.json') | ConvertFrom-Json
  return [string]$j.channels.Stable.version
}
function Install-Browser([string]$ver) {
  $State.browserBusy = $true; $State.browserError = ''
  try {
    if (-not $ver) { $State.browserProgress = 'Finding the latest version'; $ver = Get-LatestBrowserVersion }
    $State.browserProgress = 'Downloading the CA Desk window (about 150 MB, first time only)'
    $zip = Join-Path $State.root "browser-$ver.zip"
    (New-Web).DownloadFile("https://storage.googleapis.com/chrome-for-testing-public/$ver/win64/chrome-win64.zip", $zip)
    $State.browserProgress = 'Unpacking'
    $to = Join-Path $State.root "browser-$ver"
    if (Test-Path -LiteralPath $to) { Remove-Item -Recurse -Force -LiteralPath $to }
    Add-Type -AssemblyName System.IO.Compression.FileSystem
    [IO.Compression.ZipFile]::ExtractToDirectory($zip, $to)
    Remove-Item -LiteralPath $zip -Force -ErrorAction SilentlyContinue
    $exe = Join-Path $to 'chrome-win64\chrome.exe'
    if (-not (Test-Path -LiteralPath $exe)) { throw 'chrome.exe is missing in the download' }
    [IO.File]::WriteAllText((Join-Path $State.root 'browser.json'), ([pscustomobject]@{ version = $ver; exe = $exe; dir = $to } | ConvertTo-Json))
    Get-ChildItem -LiteralPath $State.root -Directory -Filter 'browser-*' | Where-Object { $_.FullName -ne $to } | ForEach-Object { Remove-Item -Recurse -Force -LiteralPath $_.FullName -ErrorAction SilentlyContinue }
    return $true
  } catch {
    $State.browserError = 'Could not set up the CA Desk window: ' + $_.Exception.Message
    return $false
  } finally { $State.browserBusy = $false; $State.browserProgress = '' }
}
function Test-PortalUrl([string]$u) { return ($u -match '^https://smishra724\.github\.io/(ca-desk|gst-desk)/' -or $u -match '^https://([a-z0-9-]+\.)*gst\.gov\.in(/|$)') }
function Open-Portal([string]$url) {   # opens the URL in the CA Desk window (sets it up first if needed)
  if (-not $url) { $url = 'https://smishra724.github.io/ca-desk/' }
  $b = Get-BrowserInfo
  if (-not $b) { $State.openAfterInstall = $url; $State.browserWanted = $true; return 'preparing' }
  $prof = Join-Path $State.root 'profile'
  $a = @("--user-data-dir=`"$prof`"", '--no-first-run', '--no-default-browser-check', '--disable-search-engine-choice-screen', '--hide-crash-restore-bubble')
  $ext = Get-ExtDir
  if (Test-Path -LiteralPath (Join-Path $ext 'manifest.json')) { $a += "--load-extension=`"$ext`"" }
  $a += "`"$url`""
  foreach ($k in 'GOOGLE_API_KEY', 'GOOGLE_DEFAULT_CLIENT_ID', 'GOOGLE_DEFAULT_CLIENT_SECRET') { [Environment]::SetEnvironmentVariable($k, 'no', 'Process') }
  Start-Process -FilePath ([string]$b.exe) -ArgumentList ($a -join ' ')
  return 'opened'
}
function Invoke-Update {
  $State.updating = $true; $State.lastError = ''
  try {
    $l = Invoke-Check
    $stage = Join-Path $State.root ('staging-' + [Guid]::NewGuid().ToString('N').Substring(0, 8))
    New-Item -ItemType Directory -Force -Path $stage | Out-Null
    # 1. download everything first (nothing changes if the download breaks)
    $extBase = [string]$l.extensionBase
    $extFiles = $(if (Test-ConnectorOnly) { @() } else { @($l.extensionFiles) })
    $n = 0; $all = $extFiles.Count + @($l.files).Count
    foreach ($f in $extFiles) { $n++; $State.progress = "Downloading $n of $all"; Save-Url ($extBase + $f) (Join-Path (Join-Path $stage 'ext') $f) }
    foreach ($f in @($l.files)) { $n++; $State.progress = "Downloading $n of $all"; Save-Url ($State.base + $f) (Join-Path (Join-Path $stage 'app') $f) }
    # 2. put the extension files in place (the extension restarts itself when it sees the new version)
    $State.progress = 'Installing'
    $ext = Get-ExtDir
    foreach ($f in $extFiles) {
      $dst = Join-Path $ext $f; $dd = Split-Path -Parent $dst
      if (-not (Test-Path -LiteralPath $dd)) { New-Item -ItemType Directory -Force -Path $dd | Out-Null }
      Copy-Item -LiteralPath (Join-Path (Join-Path $stage 'ext') $f) -Destination $dst -Force
    }
    # 3. the app itself: replace files; restart if the program changed
    $restart = $false
    foreach ($f in @($l.files)) {
      $src = Join-Path (Join-Path $stage 'app') $f; $dst = Join-Path $State.root $f
      $same = (Test-Path -LiteralPath $dst) -and ((Get-FileHash -LiteralPath $src).Hash -eq (Get-FileHash -LiteralPath $dst).Hash)
      if (-not $same) { Copy-Item -LiteralPath $src -Destination $dst -Force; if ($f -eq 'bridge.ps1') { $restart = $true } }
    }
    Remove-Item -Recurse -Force -LiteralPath $stage -ErrorAction SilentlyContinue
    try { $b = Get-BrowserInfo; if ($b) { $lv = Get-LatestBrowserVersion; if (Test-Newer $lv ([string]$b.version)) { $State.progress = 'Updating the CA Desk window'; [void](Install-Browser $lv) } } } catch { }
    $State.updatedTo = [string]$l.extensionVersion
    $State.message = $(if ($extFiles.Count) { "Updated: extension v$($l.extensionVersion)" + $(if ($restart) { ", CA Desk Bridge v$($l.version)" } else { '' }) } elseif ($restart) { "Updated to v$($l.version)" } else { 'Already up to date' })
    $State.progress = ''
    if ($restart) { $State.restart = $true }
  } catch {
    $State.lastError = 'Update failed: ' + $_.Exception.Message
    $State.progress = ''
  } finally { $State.updating = $false }
}
'@

# ---------- small web server on 127.0.0.1 (no admin rights needed) ----------
$Server = @'
. ([scriptblock]::Create($Lib))
$listener = New-Object System.Net.Sockets.TcpListener([System.Net.IPAddress]::Loopback, $State.port)
$listener.Start()
$State.listening = $true
function Send-Resp($stream, [int]$code, [string]$ctype, [byte[]]$body, $hdrs) {
  $reason = @{ 200 = 'OK'; 204 = 'No Content'; 400 = 'Bad Request'; 403 = 'Forbidden'; 404 = 'Not Found'; 500 = 'Server Error'; 502 = 'Bad Gateway' }[$code]
  $h = "HTTP/1.1 $code $reason`r`nContent-Type: $ctype`r`nContent-Length: $($body.Length)`r`nConnection: close`r`nCache-Control: no-store`r`n"
  foreach ($k in $hdrs.Keys) { $h += "${k}: $($hdrs[$k])`r`n" }
  $hb = [Text.Encoding]::ASCII.GetBytes($h + "`r`n")
  $stream.Write($hb, 0, $hb.Length); if ($body.Length) { $stream.Write($body, 0, $body.Length) }; $stream.Flush()
}
function Json($o) { return [Text.Encoding]::UTF8.GetBytes(($o | ConvertTo-Json -Depth 6 -Compress)) }
while (-not $State.stop) {
  if (-not $listener.Pending()) { Start-Sleep -Milliseconds 100; continue }
  $client = $listener.AcceptTcpClient()
  try {
    $client.ReceiveTimeout = 15000; $client.SendTimeout = 60000
    $stream = $client.GetStream()
    # read the request head
    $buf = New-Object byte[] 65536; $head = New-Object System.Collections.Generic.List[byte]; $end = -1
    while ($end -lt 0) {
      $n = $stream.Read($buf, 0, $buf.Length); if ($n -le 0) { break }
      for ($i = 0; $i -lt $n; $i++) { $head.Add($buf[$i]) }
      $s = [Text.Encoding]::ASCII.GetString($head.ToArray()); $end = $s.IndexOf("`r`n`r`n")
    }
    if ($end -lt 0) { $client.Close(); continue }
    $all = $head.ToArray(); $text = [Text.Encoding]::ASCII.GetString($all, 0, $end)
    $lines = $text -split "`r`n"; $first = $lines[0] -split ' '
    $method = $first[0]; $target = $first[1]
    $H = @{}; foreach ($ln in $lines[1..($lines.Count - 1)]) { $p = $ln.IndexOf(':'); if ($p -gt 0) { $H[$ln.Substring(0, $p).Trim().ToLower()] = $ln.Substring($p + 1).Trim() } }
    $len = 0; if ($H['content-length']) { $len = [int]$H['content-length'] }
    $body = New-Object System.Collections.Generic.List[byte]
    for ($i = $end + 4; $i -lt $all.Length; $i++) { $body.Add($all[$i]) }
    while ($body.Count -lt $len) { $n = $stream.Read($buf, 0, [Math]::Min($buf.Length, $len - $body.Count)); if ($n -le 0) { break }; for ($i = 0; $i -lt $n; $i++) { $body.Add($buf[$i]) } }
    $origin = [string]$H['origin']
    $okOrigin = (-not $origin) -or ($origin -eq 'https://smishra724.github.io') -or ($origin -like 'chrome-extension://*') -or ($origin -match '^http://(localhost|127\.0\.0\.1)(:\d+)?$')
    $cors = @{}
    if ($origin -and $okOrigin) { $cors['Access-Control-Allow-Origin'] = $origin; $cors['Vary'] = 'Origin'; $cors['Access-Control-Allow-Methods'] = 'GET, POST, OPTIONS'; $cors['Access-Control-Allow-Headers'] = 'Content-Type'; $cors['Access-Control-Allow-Private-Network'] = 'true' }
    if (-not $okOrigin) { Send-Resp $stream 403 'text/plain' ([Text.Encoding]::ASCII.GetBytes('not allowed')) @{}; $client.Close(); continue }
    $path = $target.Split('?')[0]; $query = @{}
    if ($target.Contains('?')) { foreach ($kv in $target.Split('?', 2)[1].Split('&')) { $p = $kv.Split('=', 2); if ($p.Count -eq 2) { $query[[Uri]::UnescapeDataString($p[0])] = [Uri]::UnescapeDataString($p[1]) } } }
    if ($method -eq 'OPTIONS') { Send-Resp $stream 204 'text/plain' (New-Object byte[] 0) $cors; $client.Close(); continue }
    switch ($path) {
      '/status' {
        $ev = Get-ExtVersion
        Send-Resp $stream 200 'application/json' (Json ([ordered]@{ app = 'CA Desk Bridge'; version = $State.version; extensionVersion = $ev; extensionRunning = $State.extRunning; extensionSeen = $State.extSeen
          connectorOnly = (Test-ConnectorOnly); extensionFolder = (Get-ExtDir); latest = $(if ($State.latest) { [ordered]@{ version = [string]$State.latest.version; extensionVersion = [string]$State.latest.extensionVersion; notes = [string]$State.latest.notes } } else { $null })
          browser = $(if ($bi = Get-BrowserInfo) { [ordered]@{ installed = $true; version = [string]$bi.version } } else { [ordered]@{ installed = $false } }); browserBusy = $State.browserBusy; browserProgress = $State.browserProgress; browserError = $State.browserError
          updateAvailable = (Test-UpdateAvailable); updating = $State.updating; progress = $State.progress; lastCheck = $State.lastCheck; lastError = $State.lastError; message = $State.message })) $cors
      }
      '/ext' {   # the extension asks about once a minute: is there a newer version in its folder?
        if ($query['running']) { $State.extRunning = $query['running']; $State.extSeen = (Get-Date).ToString('yyyy-MM-dd HH:mm:ss') }
        Send-Resp $stream 200 'application/json' (Json ([ordered]@{ version = (Get-ExtVersion); bridge = $State.version })) $cors
      }
      '/open' {   # open CA Desk / the GST portal in the CA Desk window
        $u = [string]$query['url']
        if ($u -and -not (Test-PortalUrl $u)) { Send-Resp $stream 403 'application/json' (Json @{ ok = $false; error = 'not allowed' }) $cors; break }
        $r = Open-Portal $u
        Send-Resp $stream 200 'application/json' (Json @{ ok = $true; state = $r }) $cors
      }
      '/update' { if (-not $State.updating) { $State.updateRequested = $true }; Send-Resp $stream 200 'application/json' (Json @{ started = $true }) $cors }
      '/check' { $State.checkRequested = $true; Send-Resp $stream 200 'application/json' (Json @{ ok = $true }) $cors }
      '/tally' {   # read from Tally on this computer (Import only from CA Desk, which asks you first)
        $xml = [Text.Encoding]::UTF8.GetString($body.ToArray())
        $port = 9000; if ($query['port'] -match '^\d{2,5}$') { $port = [int]$query['port'] }
        $isExport = $xml -match '<TALLYREQUEST>\s*Export'
        $isImport = $xml -match '<TALLYREQUEST>\s*Import Data\s*</TALLYREQUEST>'
        if (-not ($isExport -or ($isImport -and $origin -eq 'https://smishra724.github.io'))) { Send-Resp $stream 403 'application/json' (Json @{ ok = $false; error = 'only export requests are allowed' }) $cors; break }
        try {
          $w = New-Object System.Net.WebClient; $w.Headers['Content-Type'] = 'text/xml;charset=utf-8'
          $resp = $w.UploadData("http://127.0.0.1:$port", 'POST', [Text.Encoding]::UTF8.GetBytes($xml))
          Send-Resp $stream 200 'application/octet-stream' $resp $cors
        } catch { Send-Resp $stream 502 'application/json' (Json @{ ok = $false; error = "Tally is not answering on port ${port}: $($_.Exception.Message)" }) $cors }
      }
      '/dsc' {   # certificates Windows can see (a plugged-in DSC token registers its certificate here) - read only
        $list = @()
        try { foreach ($c in Get-ChildItem Cert:\CurrentUser\My) { if ($c.HasPrivateKey) { $list += [ordered]@{ thumb = $c.Thumbprint; subject = $c.Subject; issuer = $c.Issuer; from = $c.NotBefore.ToString('yyyy-MM-dd'); to = $c.NotAfter.ToString('yyyy-MM-dd') } } } } catch { }
        Send-Resp $stream 200 'application/json' (Json @{ ok = $true; certs = $list }) $cors
      }
      default {
        $html = "<!doctype html><meta charset=utf-8><title>CA Desk Bridge</title><body style='font:15px system-ui;margin:40px'><h2>CA Desk Bridge v$($State.version) is running</h2><p>Browser extension in <code>$([Net.WebUtility]::HtmlEncode((Get-ExtDir)))</code>: v$(Get-ExtVersion)</p><p>Open <a href='https://smishra724.github.io/ca-desk/'>CA Desk</a> - Settings shows updates.</p>"
        Send-Resp $stream 200 'text/html; charset=utf-8' ([Text.Encoding]::UTF8.GetBytes($html)) $cors
      }
    }
  } catch { } finally { try { $client.Close() } catch { } }
}
$listener.Stop()
'@

# ---------- background worker: checks for updates every 6 hours, runs "Update now" ----------
$Worker = @'
. ([scriptblock]::Create($Lib))
$next = Get-Date
while (-not $State.stop) {
  try {
    if ($State.browserWanted -and -not $State.browserBusy) {
      $State.browserWanted = $false
      if (-not (Get-BrowserInfo)) {
        if (-not (Test-Path -LiteralPath (Join-Path (Get-ExtDir) 'manifest.json'))) { try { $State.updateRequested = $true; Invoke-Update; $State.updateRequested = $false } catch { } }
        if ((Install-Browser '') -and $State.openAfterInstall) { $u = $State.openAfterInstall; $State.openAfterInstall = ''; [void](Open-Portal $u) }
      } elseif ($State.openAfterInstall) { $u = $State.openAfterInstall; $State.openAfterInstall = ''; [void](Open-Portal $u) }
    }
    if ($State.updateRequested) { $State.updateRequested = $false; Invoke-Update }
    elseif ($State.checkRequested -or (Get-Date) -ge $next) {
      $State.checkRequested = $false; $next = (Get-Date).AddHours(6)
      try { Invoke-Check | Out-Null } catch { $State.lastError = 'Could not check for updates: ' + $_.Exception.Message }
      if ((Get-Config).auto -eq $true -and (Test-UpdateAvailable)) { Invoke-Update }   # fully automatic only if switched on in the tray menu
    }
  } catch { $State.lastError = $_.Exception.Message }
  Start-Sleep -Milliseconds 700
}
'@

function Start-Thread([string]$code) {
  $rs = [runspacefactory]::CreateRunspace(); $rs.Open()
  $rs.SessionStateProxy.SetVariable('State', $State); $rs.SessionStateProxy.SetVariable('Lib', $Lib)
  $ps = [powershell]::Create(); $ps.Runspace = $rs; [void]$ps.AddScript($code); [void]$ps.BeginInvoke()
  return $ps
}
. ([scriptblock]::Create($Lib))
$srv = Start-Thread $Server
$wrk = Start-Thread $Worker

function Restart-Self {
  $State.stop = $true; Start-Sleep -Milliseconds 800
  try { $mutex.ReleaseMutex() } catch { }
  $launcher = Join-Path $Root 'launcher.vbs'
  if (Test-Path -LiteralPath $launcher) { Start-Process -FilePath 'wscript.exe' -ArgumentList "`"$launcher`"" }
  else { Start-Process -FilePath 'powershell.exe' -ArgumentList "-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$Root\bridge.ps1`"" }
}

if ($NoTray) {   # used for testing: no tray icon, just the server and the updater
  while (-not $State.stop) { if ($State.restart) { $State.stop = $true }; Start-Sleep -Milliseconds 300 }
  exit 0
}

# ---------- system tray (kept as text so it is only compiled on Windows) ----------
$Tray = @'
# ---------- system tray ----------
Add-Type -AssemblyName System.Windows.Forms, System.Drawing
[System.Windows.Forms.Application]::EnableVisualStyles()
$icon = New-Object System.Windows.Forms.NotifyIcon
$ico = Join-Path $Root 'icon.ico'
$icon.Icon = $(if (Test-Path -LiteralPath $ico) { New-Object System.Drawing.Icon($ico) } else { [System.Drawing.SystemIcons]::Application })
$icon.Text = "CA Desk Bridge v$AppVersion"
$icon.Visible = $true
$menu = New-Object System.Windows.Forms.ContextMenuStrip
$miTitle = $menu.Items.Add("CA Desk Bridge v$AppVersion"); $miTitle.Enabled = $false
$miExt = $menu.Items.Add('Extension: …'); $miExt.Enabled = $false
[void]$menu.Items.Add((New-Object System.Windows.Forms.ToolStripSeparator))
$miUpdate = $menu.Items.Add('Update now'); $miUpdate.Font = New-Object System.Drawing.Font($miUpdate.Font, [System.Drawing.FontStyle]::Bold)
$miCheck = $menu.Items.Add('Check for updates')
$miAuto = New-Object System.Windows.Forms.ToolStripMenuItem('Update automatically in the background'); [void]$menu.Items.Add($miAuto)
[void]$menu.Items.Add((New-Object System.Windows.Forms.ToolStripSeparator))
$miDesk = $menu.Items.Add('Open CA Desk')
$miFolder = $menu.Items.Add('Open extension folder')
$miStart = New-Object System.Windows.Forms.ToolStripMenuItem('Start with Windows'); [void]$menu.Items.Add($miStart)
[void]$menu.Items.Add((New-Object System.Windows.Forms.ToolStripSeparator))
$miExit = $menu.Items.Add('Exit')
$icon.ContextMenuStrip = $menu
if (Test-ConnectorOnly) { $miExt.Visible = $false; $miFolder.Visible = $false }
$exe = Join-Path $Root 'CA-Desk-Bridge.exe'; if (-not (Test-Path -LiteralPath $exe)) { $exe = Join-Path $Root 'CA-Desk-Connector.exe' }

$startupLnk = Join-Path ([Environment]::GetFolderPath('Startup')) 'CA Desk Bridge.lnk'
function Set-Startup([bool]$on) {
  if ($on) {
    $sh = New-Object -ComObject WScript.Shell; $l = $sh.CreateShortcut($startupLnk)
    if (Test-Path -LiteralPath $exe) { $l.TargetPath = $exe; $l.Arguments = '/startup' } else { $l.TargetPath = 'wscript.exe'; $l.Arguments = "`"$(Join-Path $Root 'launcher.vbs')`"" }
    $l.IconLocation = $ico; $l.WorkingDirectory = $Root; $l.Save()
  }
  else { Remove-Item -LiteralPath $startupLnk -Force -ErrorAction SilentlyContinue }
}
function Set-Auto([bool]$on) {
  $f = Join-Path $Root 'config.json'; $c = Get-Config
  $c | Add-Member -NotePropertyName auto -NotePropertyValue $on -Force
  [IO.File]::WriteAllText($f, ($c | ConvertTo-Json))
}
$miUpdate.add_Click({ $State.updateRequested = $true; $icon.ShowBalloonTip(3000, 'CA Desk Bridge', 'Updating in the background…', 'Info') })
$miCheck.add_Click({ $State.checkRequested = $true })
$miAuto.add_Click({ Set-Auto (-not $miAuto.Checked) })
function Open-Desk { if ((Open-Portal '') -eq 'preparing') { $icon.ShowBalloonTip(5000, 'CA Desk Bridge', 'Setting up the CA Desk window (first time only, about 150 MB). It opens by itself when ready.', 'Info') } }
$miDesk.add_Click({ Open-Desk })
$miFolder.add_Click({ Start-Process 'explorer.exe' (Get-ExtDir) })
$miStart.add_Click({ Set-Startup (-not (Test-Path -LiteralPath $startupLnk)) })
$miExit.add_Click({ $State.stop = $true; $icon.Visible = $false; [System.Windows.Forms.Application]::Exit() })
$icon.add_MouseClick({ param($s, $e) if ($e.Button -eq [System.Windows.Forms.MouseButtons]::Left) { Open-Desk } })

$script:lastAvail = $false; $script:lastMsg = ''; $script:lastErr = ''; $script:lastBErr = ''   # script: scope - the timer handler runs in its own scope
$timer = New-Object System.Windows.Forms.Timer; $timer.Interval = 1500
$timer.add_Tick({
  $ev = Get-ExtVersion; $avail = Test-UpdateAvailable
  $miExt.Text = "Extension v$ev" + $(if ($State.extRunning -and $State.extRunning -ne $ev) { " (Chrome is running v$($State.extRunning))" } else { '' })
  $miAuto.Checked = ((Get-Config).auto -eq $true)
  $miStart.Checked = (Test-Path -LiteralPath $startupLnk)
  if ($State.updating) { $miUpdate.Text = "Updating… $($State.progress)"; $miUpdate.Enabled = $false }
  elseif ($avail) { $miUpdate.Text = "Update now (v$(if (Test-ConnectorOnly) { $State.latest.version } else { $State.latest.extensionVersion }) available)"; $miUpdate.Enabled = $true }
  else { $miUpdate.Text = 'Up to date' + $(if ($State.lastCheck) { " (checked $($State.lastCheck))" } else { '' }); $miUpdate.Enabled = $false }
  $tip = "CA Desk Bridge v$AppVersion - " + $(if ($State.updating) { 'updating' } elseif ($avail) { 'update available' } else { 'up to date' })
  if ($tip.Length -gt 63) { $tip = $tip.Substring(0, 63) }
  $icon.Text = $tip
  if ($avail -and -not $script:lastAvail -and -not $State.updating) { $icon.ShowBalloonTip(5000, 'CA Desk Bridge', "A new version is ready (v$(if (Test-ConnectorOnly) { $State.latest.version } else { $State.latest.extensionVersion })). Right-click the tray icon → Update now.", 'Info') }
  $script:lastAvail = $avail
  if ($State.message -and $State.message -ne $script:lastMsg) { $icon.ShowBalloonTip(4000, 'CA Desk Bridge', $State.message + $(if (Test-ConnectorOnly) { '.' } else { '. The extension restarts by itself within a minute.' }), 'Info'); $script:lastMsg = $State.message }
  if ($State.browserError -and $State.browserError -ne $script:lastBErr) { $icon.ShowBalloonTip(5000, 'CA Desk Bridge', $State.browserError, 'Warning'); $script:lastBErr = $State.browserError }
  if ($State.browserBusy) { $miDesk.Text = "Open CA Desk ($($State.browserProgress)…)" } else { $miDesk.Text = 'Open CA Desk' }
  if ($State.lastError -and $State.lastError -ne $script:lastErr) { $icon.ShowBalloonTip(5000, 'CA Desk Bridge', $State.lastError, 'Warning'); $script:lastErr = $State.lastError }
  if ($State.restart) { $timer.Stop(); $icon.Visible = $false; Restart-Self; [System.Windows.Forms.Application]::Exit() }
})
$timer.Start()
[System.Windows.Forms.Application]::Run()
$State.stop = $true
$icon.Dispose()
'@
. ([scriptblock]::Create($Tray))
