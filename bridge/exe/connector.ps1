# CA Desk Bridge - run by CA-Desk-Bridge.exe (hidden). Installs/starts CA Desk Bridge: the tray app that connects
# CA Desk to Tally + DSC and keeps the CA Desk Suite (GST Desk) browser extension installed and up to date.
# Per Windows user, no admin rights.
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Windows.Forms
$title = 'CA Desk Bridge'
$dir = Join-Path $env:LOCALAPPDATA 'CADeskBridge'
$payload = $env:CADESK_PAYLOAD
$self = $env:CADESK_EXE
$exe = Join-Path $dir 'CA-Desk-Bridge.exe'
$oldExe = Join-Path $dir 'CA-Desk-Connector.exe'
$startMenu = Join-Path ([Environment]::GetFolderPath('Programs')) 'CA Desk Bridge.lnk'
$oldMenu = Join-Path ([Environment]::GetFolderPath('Programs')) 'CA Desk Connector.lnk'
$startup = Join-Path ([Environment]::GetFolderPath('Startup')) 'CA Desk Bridge.lnk'
$uninstKey = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\CADeskBridge'
function Say([string]$m, [string]$icon = 'Information') { [void][System.Windows.Forms.MessageBox]::Show($m, $title, 'OK', $icon) }
function Test-Running { try { $m = [Threading.Mutex]::OpenExisting('CADeskBridge'); $m.Dispose(); return $true } catch { return $false } }
function Stop-Bridge {
  Get-CimInstance Win32_Process -Filter "Name='powershell.exe'" -ErrorAction SilentlyContinue |
    Where-Object { $_.CommandLine -like '*CADeskBridge*bridge.ps1*' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
  for ($i = 0; $i -lt 20 -and (Test-Running); $i++) { Start-Sleep -Milliseconds 250 }
}
function Get-Ver([string]$file) {
  if (-not (Test-Path -LiteralPath $file)) { return '' }
  $m = [regex]::Match([IO.File]::ReadAllText($file), "\`$AppVersion = '([^']+)'"); return $(if ($m.Success) { $m.Groups[1].Value } else { '' })
}
function Test-Newer([string]$a, [string]$b) {
  if (-not $a) { return $false }; if (-not $b) { return $true }
  $x = ($a.Split('.') + @('0', '0', '0'))[0..2] | ForEach-Object { [int]$_ }
  $y = ($b.Split('.') + @('0', '0', '0'))[0..2] | ForEach-Object { [int]$_ }
  for ($i = 0; $i -lt 3; $i++) { if ($x[$i] -ne $y[$i]) { return ($x[$i] -gt $y[$i]) } }
  return $false
}
function Get-Manifest([string]$folder) {
  $m = Join-Path $folder 'manifest.json'
  if ($folder -and (Test-Path -LiteralPath $m)) { try { return (Get-Content -Raw -LiteralPath $m | ConvertFrom-Json) } catch { } }
  return $null
}
function Find-ChromeExtension {   # the unpacked GST Desk / CA Desk Suite folder Chrome already loads (keeps its clients + saved passwords)
  $found = @()
  foreach ($ud in @((Join-Path $env:LOCALAPPDATA 'Google\Chrome\User Data'), (Join-Path $env:LOCALAPPDATA 'Microsoft\Edge\User Data'))) {
    if (-not (Test-Path -LiteralPath $ud)) { continue }
    foreach ($pf in Get-ChildItem -LiteralPath $ud -Directory -ErrorAction SilentlyContinue) {
      foreach ($fn in 'Secure Preferences', 'Preferences') {
        $f = Join-Path $pf.FullName $fn; if (-not (Test-Path -LiteralPath $f)) { continue }
        try { $txt = [IO.File]::ReadAllText($f) } catch { continue }
        foreach ($m in [regex]::Matches($txt, '"path"\s*:\s*"([A-Za-z]:\\\\[^"]+)"')) {
          $pth = $m.Groups[1].Value.Replace('\\', '\')
          $man = Get-Manifest $pth
          if ($man -and ([string]$man.name -match 'GST Desk|CA Desk Suite') -and -not ($found -contains $pth)) { $found += $pth }
        }
      }
    }
  }
  return $found
}
function Save-Url([string]$url, [string]$path) {
  $d = Split-Path -Parent $path; if (-not (Test-Path -LiteralPath $d)) { New-Item -ItemType Directory -Force -Path $d | Out-Null }
  $w = New-Object System.Net.WebClient; $w.Headers['Cache-Control'] = 'no-cache'; $w.DownloadFile($url + '?t=' + [DateTime]::UtcNow.Ticks, $path)
}
function Install-Extension([string]$to) {   # downloads the latest CA Desk Suite into $to (only when it is missing or older)
  try { [Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12 } catch { }
  $w = New-Object System.Net.WebClient; $w.Encoding = [Text.Encoding]::UTF8
  $v = $w.DownloadString('https://smishra724.github.io/gst-desk/bridge/version.json?t=' + [DateTime]::UtcNow.Ticks) | ConvertFrom-Json
  $have = Get-Manifest $to
  if ($have -and -not (Test-Newer ([string]$v.extensionVersion) ([string]$have.version))) { return [string]$have.version }
  $stage = Join-Path $env:TEMP ('cadesk-ext-' + [Guid]::NewGuid().ToString('N').Substring(0, 8))
  foreach ($f in @($v.extensionFiles)) { Save-Url ([string]$v.extensionBase + $f) (Join-Path $stage $f) }
  foreach ($f in @($v.extensionFiles)) { $dst = Join-Path $to $f; $dd = Split-Path -Parent $dst; if (-not (Test-Path -LiteralPath $dd)) { New-Item -ItemType Directory -Force -Path $dd | Out-Null }; Copy-Item -LiteralPath (Join-Path $stage $f) -Destination $dst -Force }
  Remove-Item -Recurse -Force -LiteralPath $stage -ErrorAction SilentlyContinue
  return [string]$v.extensionVersion
}
function Start-Bridge { Start-Process -FilePath 'wscript.exe' -ArgumentList "`"$(Join-Path $dir 'launcher.vbs')`"" }

try {
  if ($env:MODE -eq '/uninstall') {
    if ([System.Windows.Forms.MessageBox]::Show('Remove CA Desk Bridge from this computer?', $title, 'YesNo', 'Question') -ne 'Yes') { return }
    Stop-Bridge
    Remove-Item -LiteralPath $startMenu, $oldMenu, $startup -Force -ErrorAction SilentlyContinue
    Remove-Item -LiteralPath $uninstKey -Recurse -Force -ErrorAction SilentlyContinue
    $cfg = $null; try { $cfg = Get-Content -Raw -LiteralPath (Join-Path $dir 'config.json') | ConvertFrom-Json } catch { }
    Remove-Item -Recurse -Force -LiteralPath $dir -ErrorAction SilentlyContinue
    if (Test-Path -LiteralPath $dir) {   # this program is still running from there: remove the folder once it closes
      $q = $dir.Replace('"', '')
      Start-Process -WindowStyle Hidden -FilePath 'cmd.exe' -ArgumentList "/c for /l %i in (1,1,900) do (rmdir /s /q `"$q`" 2>nul & if not exist `"$q`" exit) & ping -n 2 127.0.0.1 >nul"
    }
    $extra = $(if ($cfg -and $cfg.extDir -and -not ($cfg.extDir -like "$dir*")) { "`n`nThe browser extension folder was left as it is:`n$($cfg.extDir)" } else { '' })
    Say ("CA Desk Bridge has been removed." + $extra + "`n`nIf you no longer need the browser extension, remove CA Desk Suite in chrome://extensions.")
    return
  }

  $first = -not (Test-Path -LiteralPath (Join-Path $dir 'bridge.ps1'))
  New-Item -ItemType Directory -Force -Path $dir | Out-Null
  $newVer = Get-Ver (Join-Path $payload 'bridge.ps1'); $curVer = Get-Ver (Join-Path $dir 'bridge.ps1')
  $upgrade = (Test-Newer $newVer $curVer)
  if ($upgrade -and -not $first) { Stop-Bridge }
  if ($first -or $upgrade) { Copy-Item -LiteralPath (Join-Path $payload 'bridge.ps1') -Destination (Join-Path $dir 'bridge.ps1') -Force }
  foreach ($f in 'launcher.vbs', 'icon.ico') { if (-not (Test-Path -LiteralPath (Join-Path $dir $f))) { Copy-Item -LiteralPath (Join-Path $payload $f) -Destination (Join-Path $dir $f) -Force } }
  if ($self -and ($self -ne $exe)) { try { Copy-Item -LiteralPath $self -Destination $exe -Force } catch { } }
  if (Test-Path -LiteralPath $oldExe) { Remove-Item -LiteralPath $oldExe -Force -ErrorAction SilentlyContinue }

  # The browser extension (GST Desk): reuse the folder Chrome already loads, else install a fresh copy
  $cfgFile = Join-Path $dir 'config.json'
  $cfg = $null; try { $cfg = Get-Content -Raw -LiteralPath $cfgFile | ConvertFrom-Json } catch { }
  $extDir = $(if ($cfg -and $cfg.extDir -and $cfg.connectorOnly -ne $true -and (Get-Manifest ([string]$cfg.extDir))) { [string]$cfg.extDir } else { '' })
  $inChrome = @(Find-ChromeExtension)
  if (-not $extDir -and $inChrome.Count) { $extDir = $inChrome[0] }
  if (-not $extDir) { $extDir = Join-Path $dir 'extension' }
  $loaded = ($inChrome -contains $extDir)
  $auto = $false; if ($cfg -and $cfg.auto -eq $true) { $auto = $true }
  $cfgChanged = -not ($cfg -and [string]$cfg.extDir -eq $extDir -and $cfg.connectorOnly -ne $true)
  if ($cfgChanged) { if (-not $first) { Stop-Bridge }; [IO.File]::WriteAllText($cfgFile, ([pscustomobject]@{ extDir = $extDir; auto = $auto; connectorOnly = $false } | ConvertTo-Json)) }
  $extVer = ''; $extErr = ''
  try { $extVer = Install-Extension $extDir } catch { $extErr = $_.Exception.Message }

  $lnkOk = $false; try { $lnkOk = ((New-Object -ComObject WScript.Shell).CreateShortcut($startMenu).TargetPath -eq $exe) } catch { }
  if ($first -or $upgrade -or -not $lnkOk) {
    $sh = New-Object -ComObject WScript.Shell
    Remove-Item -LiteralPath $oldMenu -Force -ErrorAction SilentlyContinue
    foreach ($p in @($startMenu, $startup)) {
      $l = $sh.CreateShortcut($p); $l.TargetPath = $exe; $l.Arguments = $(if ($p -eq $startup) { '/startup' } else { '' })
      $l.IconLocation = (Join-Path $dir 'icon.ico'); $l.WorkingDirectory = $dir; $l.Description = 'CA Desk Bridge'; $l.Save()
    }
    New-Item -Path $uninstKey -Force | Out-Null
    $props = @{ DisplayName = 'CA Desk Bridge'; DisplayVersion = $(if ($upgrade -or $first) { $newVer } else { $curVer }); Publisher = 'SM Consultancy'
      DisplayIcon = (Join-Path $dir 'icon.ico'); InstallLocation = $dir; UninstallString = "`"$exe`" /uninstall"; URLInfoAbout = 'https://smishra724.github.io/ca-desk/' }
    foreach ($k in $props.Keys) { New-ItemProperty -Path $uninstKey -Name $k -Value $props[$k] -PropertyType String -Force | Out-Null }
    foreach ($k in 'NoModify', 'NoRepair') { New-ItemProperty -Path $uninstKey -Name $k -Value 1 -PropertyType DWord -Force | Out-Null }
  }

  $wasRunning = Test-Running
  if (-not $wasRunning) { Start-Bridge }
  $quiet = ($env:CADESK_STARTUP -eq '1')
  if ($extErr) {
    if (-not $quiet) { Say "CA Desk Bridge is running (Tally + DSC), but the GST Desk extension could not be downloaded:`n$extErr`n`nCheck the internet connection and open CA-Desk-Bridge.exe again." 'Warning' }
  } elseif (-not $loaded -and -not $quiet) {
    try { Set-Clipboard -Value $extDir } catch { }
    try { Start-Process 'chrome.exe' 'chrome://extensions' } catch { }
    Say "CA Desk Bridge v$newVer is installed and running (icon near the clock).`n`nGST Desk (CA Desk Suite v$extVer) is ready in:`n$extDir`n`nOne last step in Chrome, only this once (chrome://extensions has opened):`n  1. Turn on Developer mode (top right).`n  2. Click Load unpacked, press Ctrl+V in the folder box (the path is copied) and click Select Folder.`n  3. Reload CA Desk (Ctrl + F5).`n`nFrom then on the Bridge keeps GST Desk up to date by itself. Your clients and GST logins come back from Masters automatically."
  } elseif ($first -or $upgrade -or $cfgChanged) {
    Say "CA Desk Bridge v$newVer is installed and running (icon near the clock).`n`nIt connects CA Desk to Tally and DSC tokens and keeps GST Desk (CA Desk Suite v$extVer, already in Chrome) up to date.`nIf Chrome still shows an older version, click the reload arrow on CA Desk Suite in chrome://extensions once."
  } elseif ($wasRunning -and -not $quiet) {
    Say "CA Desk Bridge is already running - its icon is near the clock (it may be under the ^ arrow).`n`nRight-click the icon for Update now, Open CA Desk and Exit."
  }
} catch {
  Say ("CA Desk Bridge could not start:`n`n" + $_.Exception.Message) 'Warning'
  exit 1
}
