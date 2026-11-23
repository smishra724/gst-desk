@echo off
rem CA Desk Bridge - setup. Installs for this Windows user only (no admin rights needed).
rem It installs the CA Desk Bridge tray app (like a DSC utility) and the CA Desk Suite browser extension,
rem and keeps both up to date from then on. Uninstall: run this file with  /uninstall
title CA Desk Bridge setup
powershell -NoProfile -ExecutionPolicy Bypass -Command "$env:MODE='%~1'; $t=Get-Content -Raw -LiteralPath '%~f0'; iex $t.Substring($t.LastIndexOf('#PS'+'BEGIN#')+9)"
echo.
pause
exit /b
#PSBEGIN#
$ErrorActionPreference = 'Stop'
try { [Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12 } catch { }
Add-Type -AssemblyName System.Windows.Forms
$dir = Join-Path $env:LOCALAPPDATA 'CADeskBridge'
$base = 'https://smishra724.github.io/gst-desk/bridge/'
$startMenu = Join-Path ([Environment]::GetFolderPath('Programs')) 'CA Desk Bridge.lnk'
$startup = Join-Path ([Environment]::GetFolderPath('Startup')) 'CA Desk Bridge.lnk'
$uninstKey = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\CADeskBridge'

function Stop-Bridge {
  Get-CimInstance Win32_Process -Filter "Name='powershell.exe'" -ErrorAction SilentlyContinue |
    Where-Object { $_.CommandLine -like '*CADeskBridge*bridge.ps1*' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
}
function Get-File([string]$url, [string]$path) {
  $d = Split-Path -Parent $path; if (-not (Test-Path -LiteralPath $d)) { New-Item -ItemType Directory -Force -Path $d | Out-Null }
  $w = New-Object System.Net.WebClient; $w.Headers['Cache-Control'] = 'no-cache'
  $w.DownloadFile($url + '?t=' + [DateTime]::UtcNow.Ticks, $path)
}
function Get-Manifest([string]$folder) {
  $m = Join-Path $folder 'manifest.json'
  if (Test-Path -LiteralPath $m) { try { return (Get-Content -Raw -LiteralPath $m | ConvertFrom-Json) } catch { } }
  return $null
}

if ($env:MODE -eq '/uninstall') {
  Stop-Bridge
  Remove-Item -LiteralPath $startMenu, $startup -Force -ErrorAction SilentlyContinue
  $cfg = $null; try { $cfg = Get-Content -Raw -LiteralPath (Join-Path $dir 'config.json') | ConvertFrom-Json } catch { }
  Remove-Item -LiteralPath $uninstKey -Recurse -Force -ErrorAction SilentlyContinue
  Remove-Item -Recurse -Force -LiteralPath $dir -ErrorAction SilentlyContinue
  if (Test-Path -LiteralPath $dir) {   # this setup program itself is still running from there: remove it once it closes
    $q = $dir.Replace('"', '')
    Start-Process -WindowStyle Hidden -FilePath 'cmd.exe' -ArgumentList "/c for /l %i in (1,1,900) do (rmdir /s /q `"$q`" 2>nul & if not exist `"$q`" exit) & ping -n 2 127.0.0.1 >nul"
  }
  Write-Host 'CA Desk Bridge removed.' -ForegroundColor Green
  if ($cfg -and $cfg.extDir -and -not ($cfg.extDir -like "$dir*")) { Write-Host "Your extension folder was left as it is: $($cfg.extDir)" }
  Write-Host 'If you no longer need the extension, remove "CA Desk Suite" in chrome://extensions.'
  return
}

Write-Host 'Installing CA Desk Bridge…' -ForegroundColor Cyan
Stop-Bridge
New-Item -ItemType Directory -Force -Path $dir | Out-Null
$w = New-Object System.Net.WebClient; $w.Encoding = [Text.Encoding]::UTF8
$v = $w.DownloadString($base + 'version.json?t=' + [DateTime]::UtcNow.Ticks) | ConvertFrom-Json
foreach ($f in @($v.files)) { Write-Host "  $f"; Get-File ($base + $f) (Join-Path $dir $f) }

# Extension folder: keep the one Chrome already uses (so GST Desk clients and saved passwords stay), or a fresh copy
$cfgFile = Join-Path $dir 'config.json'
$cfg = $null; try { $cfg = Get-Content -Raw -LiteralPath $cfgFile | ConvertFrom-Json } catch { }
$extDir = $(if ($cfg -and $cfg.extDir) { [string]$cfg.extDir } else { '' })
$fresh = $false
if (-not $extDir -or -not (Get-Manifest $extDir)) {
  $ans = [System.Windows.Forms.MessageBox]::Show("Is GST Desk / CA Desk Suite already added in Chrome on this computer?`n`nYes - choose that extension's folder (chrome://extensions -> CA Desk Suite -> Details -> Source). Your GST Desk clients and saved passwords stay.`nNo - a fresh copy is installed.", 'CA Desk Bridge', 'YesNo', 'Question')
  if ($ans -eq 'Yes') {
    $dlg = New-Object System.Windows.Forms.FolderBrowserDialog
    $dlg.Description = 'Choose the folder of CA Desk Suite / GST Desk (the one loaded in chrome://extensions)'
    while ($true) {
      if ($dlg.ShowDialog() -ne 'OK') { break }
      $m = Get-Manifest $dlg.SelectedPath
      if ($m -and ($m.name -match 'GST Desk|CA Desk Suite')) { $extDir = $dlg.SelectedPath; break }
      [void][System.Windows.Forms.MessageBox]::Show('That folder does not contain GST Desk / CA Desk Suite (manifest.json). Choose the folder shown under Details -> Source in chrome://extensions.', 'CA Desk Bridge')
    }
  }
  if (-not $extDir) { $extDir = Join-Path $dir 'extension'; $fresh = $true }
}
Write-Host "Extension folder: $extDir"
$n = 0; foreach ($f in @($v.extensionFiles)) { $n++; Get-File ([string]$v.extensionBase + $f) (Join-Path $extDir $f) }
Write-Host "  $n extension files (v$($v.extensionVersion))"
$auto = $false; if ($cfg -and $cfg.auto -eq $true) { $auto = $true }
[IO.File]::WriteAllText($cfgFile, ([pscustomobject]@{ extDir = $extDir; auto = $auto } | ConvertTo-Json))

# Start menu + start with Windows
$sh = New-Object -ComObject WScript.Shell
foreach ($p in @($startMenu, $startup)) {
  $l = $sh.CreateShortcut($p); $l.TargetPath = 'wscript.exe'; $l.Arguments = "`"$(Join-Path $dir 'launcher.vbs')`""
  $l.IconLocation = (Join-Path $dir 'icon.ico'); $l.WorkingDirectory = $dir; $l.Description = 'CA Desk Bridge'; $l.Save()
}
Start-Process -FilePath 'wscript.exe' -ArgumentList "`"$(Join-Path $dir 'launcher.vbs')`""

# Settings -> Apps (uninstall entry) when installed from CA-Desk-Bridge-Setup.exe
try {
  $exe = Join-Path $dir 'CA-Desk-Bridge-Setup.exe'
  if ($env:SETUP_EXE -and (Test-Path -LiteralPath $env:SETUP_EXE) -and ($env:SETUP_EXE -ne $exe)) { Copy-Item -LiteralPath $env:SETUP_EXE -Destination $exe -Force }
  if (Test-Path -LiteralPath $exe) {
    New-Item -Path $uninstKey -Force | Out-Null
    $props = @{ DisplayName = 'CA Desk Bridge'; DisplayVersion = [string]$v.version; Publisher = 'SM Consultancy'; DisplayIcon = (Join-Path $dir 'icon.ico');
      InstallLocation = $dir; UninstallString = "`"$exe`" /uninstall"; URLInfoAbout = 'https://smishra724.github.io/ca-desk/' }
    foreach ($k in $props.Keys) { New-ItemProperty -Path $uninstKey -Name $k -Value $props[$k] -PropertyType String -Force | Out-Null }
    foreach ($k in 'NoModify', 'NoRepair') { New-ItemProperty -Path $uninstKey -Name $k -Value 1 -PropertyType DWord -Force | Out-Null }
  }
} catch { }

Write-Host ''
Write-Host "CA Desk Bridge v$($v.version) is installed and running (icon near the clock)." -ForegroundColor Green
if ($fresh) {
  Set-Clipboard -Value $extDir
  Write-Host ''
  Write-Host 'One last step in Chrome (only this once):' -ForegroundColor Yellow
  Write-Host '  1. chrome://extensions opens now. Turn on "Developer mode" (top right).'
  Write-Host '  2. Click "Load unpacked", press Ctrl+V in the folder box (the path is copied) and choose Select Folder:'
  Write-Host "     $extDir"
  Write-Host '  3. If an older "GST Desk" or "CA Desk Helper" is listed, remove it (first use Export in GST Desk if you want its data).'
  try { Start-Process 'chrome.exe' 'chrome://extensions' } catch { Write-Host '  (Open Chrome and type chrome://extensions in the address bar.)' }
} else {
  Write-Host 'The extension already in Chrome is now kept up to date by CA Desk Bridge.'
  Write-Host 'In chrome://extensions click the reload arrow on CA Desk Suite once.'
}
Write-Host ''
Write-Host 'Updates: right-click the CA Desk Bridge icon -> Update now, or CA Desk -> Settings -> Update now.'
