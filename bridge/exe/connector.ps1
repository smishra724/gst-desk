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
$deskLnk = Join-Path ([Environment]::GetFolderPath('Desktop')) 'CA Desk.lnk'
$deskMenu = Join-Path ([Environment]::GetFolderPath('Programs')) 'CA Desk.lnk'
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
    if ([System.Windows.Forms.MessageBox]::Show("Remove CA Desk Bridge from this computer?`n`nThis also removes the CA Desk window and the GST Desk data kept in it (your Masters stay in CA Desk).", $title, 'YesNo', 'Question') -ne 'Yes') { return }
    Stop-Bridge
    Get-CimInstance Win32_Process -Filter "Name='chrome.exe'" -ErrorAction SilentlyContinue | Where-Object { $_.ExecutablePath -like "$dir*" } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
    Remove-Item -LiteralPath $startMenu, $oldMenu, $startup, $deskLnk, $deskMenu -Force -ErrorAction SilentlyContinue
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

  # GST Desk (CA Desk Suite) files - the Bridge loads them into the CA Desk window itself; nothing to add to Chrome
  $cfgFile = Join-Path $dir 'config.json'
  $cfg = $null; try { $cfg = Get-Content -Raw -LiteralPath $cfgFile | ConvertFrom-Json } catch { }
  $extDir = $(if ($cfg -and $cfg.extDir -and (Get-Manifest ([string]$cfg.extDir))) { [string]$cfg.extDir } else { Join-Path $dir 'extension' })
  $auto = $false; if ($cfg -and $cfg.auto -eq $true) { $auto = $true }
  if (-not ($cfg -and [string]$cfg.extDir -eq $extDir -and $cfg.connectorOnly -ne $true)) { [IO.File]::WriteAllText($cfgFile, ([pscustomobject]@{ extDir = $extDir; auto = $auto; connectorOnly = $false } | ConvertTo-Json)) }
  $extErr = ''
  if ($first -or $upgrade -or -not (Get-Manifest $extDir)) { try { [void](Install-Extension $extDir) } catch { $extErr = $_.Exception.Message } }

  $lnkOk = $false; try { $lnkOk = ((New-Object -ComObject WScript.Shell).CreateShortcut($startMenu).TargetPath -eq $exe) } catch { }
  $deskOk = Test-Path -LiteralPath $deskLnk
  if ($first -or $upgrade -or -not $lnkOk -or -not $deskOk) {
    $sh = New-Object -ComObject WScript.Shell
    Remove-Item -LiteralPath $oldMenu -Force -ErrorAction SilentlyContinue
    foreach ($p in @($startMenu, $startup)) {
      $l = $sh.CreateShortcut($p); $l.TargetPath = $exe; $l.Arguments = $(if ($p -eq $startup) { '/startup' } else { '' })
      $l.IconLocation = (Join-Path $dir 'icon.ico'); $l.WorkingDirectory = $dir; $l.Description = 'CA Desk Bridge'; $l.Save()
    }
    foreach ($p in @($deskLnk, $deskMenu)) {   # "CA Desk" = open CA Desk (with GST Desk) in its own window
      $l = $sh.CreateShortcut($p); $l.TargetPath = $exe; $l.Arguments = '/open'
      $l.IconLocation = (Join-Path $dir 'icon.ico'); $l.WorkingDirectory = $dir; $l.Description = 'CA Desk'; $l.Save()
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
  if ($quiet) { return }
  # GST Desk runs inside your normal Chrome (new tab, already signed in to CA Desk). Chrome lets an extension in only by hand, once.
  $inChrome = $false
  foreach ($ud in @((Join-Path $env:LOCALAPPDATA 'Google\Chrome\User Data'))) {
    if (-not (Test-Path -LiteralPath $ud)) { continue }
    foreach ($pf in Get-ChildItem -LiteralPath $ud -Directory -ErrorAction SilentlyContinue) {
      foreach ($fn in 'Secure Preferences', 'Preferences') {
        $f = Join-Path $pf.FullName $fn
        if (Test-Path -LiteralPath $f) { try { if ([IO.File]::ReadAllText($f).Replace('\\', '\').IndexOf($extDir, [StringComparison]::OrdinalIgnoreCase) -ge 0) { $inChrome = $true } } catch { } }
      }
    }
  }
  if ($extErr) { Say "CA Desk Bridge is running, but GST Desk could not be downloaded:`n$extErr`n`nCheck the internet connection and run CA-Desk-Bridge.exe again." 'Warning'; return }
  if (-not $inChrome) {
    try { Set-Clipboard -Value $extDir } catch { }
    try { Start-Process 'chrome.exe' 'chrome://extensions' } catch { }
    Say "CA Desk Bridge v$newVer is installed and running (icon near the clock).`n`nLast step, only once - add GST Desk to your Chrome (chrome://extensions has opened):`n  1. Turn on Developer mode (top right).`n  2. Click Load unpacked, press Ctrl+V (the folder path is copied) and click Select Folder.`n  3. Reload CA Desk (Ctrl + F5).`n`nGST Desk then opens in a new tab, already signed in, and the Bridge keeps it up to date by itself."
    return
  }
  if ($first -or $upgrade) { Say "CA Desk Bridge v$newVer is installed and running (icon near the clock). GST Desk in your Chrome is kept up to date by itself." }
  elseif ($env:CADESK_OPEN -eq '1' -or $wasRunning) { Start-Process 'https://smishra724.github.io/ca-desk/' }
} catch {
  Say ("CA Desk Bridge could not start:`n`n" + $_.Exception.Message) 'Warning'
  exit 1
}
