<#
  Installs the IPTV Player on a Samsung TV (2020 or newer) from Windows.

  One-time setup (see apps/tizen/README.md): Tizen Studio + "Samsung Certificate Extension",
  a Samsung certificate profile for your TV, and Developer Mode on the TV pointing at this PC.

  Usage (PowerShell):
    .\install.ps1 -TvIp 192.168.1.50                 # downloads the latest build from GitHub
    .\install.ps1 -TvIp 192.168.1.50 -Zip .\tizen-app.zip
    .\install.ps1 -TvIp 192.168.1.50 -Cert mytv      # certificate profile name, default "iptv"
#>
param(
  [Parameter(Mandatory = $true)][string]$TvIp,
  [string]$Cert = 'iptv',
  [string]$Zip = '',
  [string]$TizenStudio = ''
)
$ErrorActionPreference = 'Stop'
$AppId = 'IptvMousa1.IPTVPlayer'
$Release = 'https://github.com/Mohamed-Mossa/web-player/releases/download/tizen-latest/tizen-app.zip'

# Find the Tizen CLI and sdb: Tizen Studio (older) or the newer Tizen SDK used by the VS Code extension.
function Find-Tool([string]$root, [string]$name) {
  if (-not $root -or -not (Test-Path $root)) { return $null }
  $known = @{ 'tizen.bat' = 'tools\ide\bin\tizen.bat'; 'sdb.exe' = 'tools\sdb.exe' }[$name]
  $p = Join-Path $root $known
  if (Test-Path $p) { return $p }
  $hit = Get-ChildItem -Path $root -Filter $name -Recurse -Depth 4 -ErrorAction SilentlyContinue | Select-Object -First 1
  if ($hit) { return $hit.FullName }
  return $null
}
$roots = @($TizenStudio, "$env:USERPROFILE\tizen-studio", 'C:\tizen-studio', "$env:USERPROFILE\tizen-sdk", 'C:\tizen-sdk', "$env:LOCALAPPDATA\tizen-studio", "$env:LOCALAPPDATA\tizen-sdk") | Where-Object { $_ }
$tizen = (Get-Command tizen.bat, tizen -ErrorAction SilentlyContinue | Select-Object -First 1).Source
$sdb = (Get-Command sdb.exe, sdb -ErrorAction SilentlyContinue | Select-Object -First 1).Source
foreach ($r in $roots) {
  if (-not $tizen) { $tizen = Find-Tool $r 'tizen.bat' }
  if (-not $sdb) { $sdb = Find-Tool $r 'sdb.exe' }
}
if (-not $tizen -or -not $sdb) {
  throw 'Could not find the Tizen CLI (tizen.bat) and sdb.exe. Install Tizen Studio or the Tizen SDK, or pass -TizenStudio <its folder>.'
}
Write-Host "Using $tizen"

$work = Join-Path $env:TEMP 'iptv-tizen'
if (Test-Path $work) { Remove-Item -Recurse -Force $work }
New-Item -ItemType Directory -Path $work | Out-Null

if (-not $Zip) {
  $Zip = Join-Path $work 'tizen-app.zip'
  Write-Host "Downloading the latest build..."
  Invoke-WebRequest -Uri $Release -OutFile $Zip
}
$app = Join-Path $work 'app'
Expand-Archive -Path $Zip -DestinationPath $app

Write-Host "Signing with certificate profile '$Cert'..."
& $tizen package -t wgt -s $Cert -- $app
if ($LASTEXITCODE -ne 0) { throw 'Packaging failed (check the certificate profile name in Tizen Studio > Certificate Manager).' }
$wgt = Get-ChildItem -Path $app -Filter *.wgt | Select-Object -First 1
if (-not $wgt) { throw 'No .wgt was produced.' }

Write-Host "Connecting to the TV at $TvIp..."
& $sdb connect $TvIp
$serial = "${TvIp}:26101"
& $sdb -s $serial get-state | Out-Null
if ($LASTEXITCODE -ne 0) { throw "The TV did not accept the connection. Is Developer Mode on, with this PC's IP as the host?" }

Write-Host 'Installing...'
& $tizen install -n $wgt.Name -s $serial -- $app
if ($LASTEXITCODE -ne 0) { throw 'Install failed. If it mentions the certificate, the profile must be a Samsung certificate made for this TV (its DUID).' }
& $tizen run -p $AppId -s $serial
Write-Host 'Done. The app is in the TV''s Apps list as "IPTV Player".'
