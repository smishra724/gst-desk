# CA Desk Connector - run by CA-Desk-Connector.exe (hidden). Installs/starts CA Desk Bridge in connector-only
# mode (Tally + DSC for CA Desk; no browser extension). Per Windows user, no admin rights.
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Windows.Forms
$title = 'CA Desk Connector'
$dir = Join-Path $env:LOCALAPPDATA 'CADeskBridge'
$payload = $env:CADESK_PAYLOAD
$self = $env:CADESK_EXE
$exe = Join-Path $dir 'CA-Desk-Connector.exe'
$startMenu = Join-Path ([Environment]::GetFolderPath('Programs')) 'CA Desk Connector.lnk'
$oldMenu = Join-Path ([Environment]::GetFolderPath('Programs')) 'CA Desk Bridge.lnk'
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
function Start-Bridge { Start-Process -FilePath 'wscript.exe' -ArgumentList "`"$(Join-Path $dir 'launcher.vbs')`"" }

try {
  if ($env:MODE -eq '/uninstall') {
    if ([System.Windows.Forms.MessageBox]::Show('Remove CA Desk Connector from this computer?', $title, 'YesNo', 'Question') -ne 'Yes') { return }
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
    Say ("CA Desk Connector has been removed." + $extra)
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
  $cfgFile = Join-Path $dir 'config.json'
  if (-not (Test-Path -LiteralPath $cfgFile)) { [IO.File]::WriteAllText($cfgFile, ([pscustomobject]@{ extDir = ''; auto = $false; connectorOnly = $true } | ConvertTo-Json)) }

  if ($first -or $upgrade -or -not (Test-Path -LiteralPath $startMenu)) {
    $sh = New-Object -ComObject WScript.Shell
    Remove-Item -LiteralPath $oldMenu -Force -ErrorAction SilentlyContinue
    foreach ($p in @($startMenu, $startup)) {
      $l = $sh.CreateShortcut($p); $l.TargetPath = $exe; $l.Arguments = $(if ($p -eq $startup) { '/startup' } else { '' })
      $l.IconLocation = (Join-Path $dir 'icon.ico'); $l.WorkingDirectory = $dir; $l.Description = 'CA Desk Connector'; $l.Save()
    }
    New-Item -Path $uninstKey -Force | Out-Null
    $props = @{ DisplayName = 'CA Desk Connector'; DisplayVersion = $(if ($upgrade -or $first) { $newVer } else { $curVer }); Publisher = 'SM Consultancy'
      DisplayIcon = (Join-Path $dir 'icon.ico'); InstallLocation = $dir; UninstallString = "`"$exe`" /uninstall"; URLInfoAbout = 'https://smishra724.github.io/ca-desk/' }
    foreach ($k in $props.Keys) { New-ItemProperty -Path $uninstKey -Name $k -Value $props[$k] -PropertyType String -Force | Out-Null }
    foreach ($k in 'NoModify', 'NoRepair') { New-ItemProperty -Path $uninstKey -Name $k -Value 1 -PropertyType DWord -Force | Out-Null }
  }

  $wasRunning = Test-Running
  if (-not $wasRunning) { Start-Bridge }
  if ($first) {
    Say "CA Desk Connector v$newVer is installed and running.`n`n- Its icon sits near the clock (it may be under the ^ arrow).`n- It starts with Windows by itself.`n- It connects CA Desk to Tally and DSC tokens on this computer.`n`nOpen CA Desk -> Settings. If Chrome asks to let the site reach apps on this device, click Allow."
  } elseif ($upgrade) {
    Say "CA Desk Connector updated to v$newVer and running."
  } elseif ($wasRunning -and $env:CADESK_STARTUP -ne '1') {
    Say "CA Desk Connector is already running - its icon is near the clock (it may be under the ^ arrow).`n`nRight-click the icon for Update now, Open CA Desk and Exit."
  }
} catch {
  Say ("CA Desk Connector could not start:`n`n" + $_.Exception.Message) 'Warning'
  exit 1
}
