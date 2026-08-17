# One-time Flutter project setup.
#
# The lib/ tree is already written. This generates the android/ and ios/
# platform folders around it, then patches the two things Flutter does not set
# up for you: the runtime permissions this app needs, and permission to talk to
# a plain-HTTP local server.
#
# Run once, after Flutter is installed:
#   powershell -ExecutionPolicy Bypass -File scripts\setup-mobile.ps1

$ErrorActionPreference = 'Stop'

$mobile = Join-Path $PSScriptRoot '..\mobile' | Resolve-Path
Write-Host "Setting up $mobile" -ForegroundColor Cyan

if (-not (Get-Command flutter -ErrorAction SilentlyContinue)) {
  Write-Host "flutter is not on PATH. Install it first, then open a NEW terminal." -ForegroundColor Red
  exit 1
}

# --- 1. Generate platform folders -----------------------------------------
# `flutter create` on an existing directory adds only what is missing. It will
# not touch lib/ except main.dart, which we back up and restore.
$mainDart = Join-Path $mobile 'lib\main.dart'
$backup = Join-Path $env:TEMP 'zonal_main_backup.dart'
if (Test-Path $mainDart) { Copy-Item $mainDart $backup -Force }

Push-Location $mobile
try {
  flutter create --project-name zonal --org edu.campus --platforms android,web .
  if (-not $?) { throw "flutter create failed" }
} finally {
  Pop-Location
}

if (Test-Path $backup) {
  Copy-Item $backup $mainDart -Force
  Remove-Item $backup -Force
  Write-Host "  restored lib/main.dart" -ForegroundColor DarkGray
}

# --- 2. Patch AndroidManifest.xml -----------------------------------------
$manifest = Join-Path $mobile 'android\app\src\main\AndroidManifest.xml'
if (-not (Test-Path $manifest)) { throw "AndroidManifest.xml not found at $manifest" }

$xml = Get-Content $manifest -Raw

$permissions = @'
    <uses-permission android:name="android.permission.INTERNET"/>
    <uses-permission android:name="android.permission.CAMERA"/>
    <uses-permission android:name="android.permission.ACCESS_FINE_LOCATION"/>
    <uses-permission android:name="android.permission.ACCESS_COARSE_LOCATION"/>
    <uses-permission android:name="android.permission.RECORD_AUDIO"/>
    <uses-permission android:name="android.permission.READ_MEDIA_IMAGES"/>
    <uses-permission android:name="android.permission.READ_MEDIA_VIDEO"/>
'@

if ($xml -notmatch 'android.permission.ACCESS_FINE_LOCATION') {
  $xml = $xml -replace '(<manifest[^>]*>)', "`$1`r`n$permissions"
  Write-Host "  added runtime permissions" -ForegroundColor Green
} else {
  Write-Host "  permissions already present" -ForegroundColor DarkGray
}

# Android 9+ blocks plain HTTP. The dev backend is http://localhost:4000, so
# without this every API call fails with an opaque socket error.
if ($xml -notmatch 'usesCleartextTraffic') {
  # The replacement string must be built first. Writing
  #   -replace 'a', 'b' + "c"
  # makes PowerShell read the concatenation as a third argument to -replace.
  $replacement = '$1android:usesCleartextTraffic="true" '
  $xml = $xml -replace '(<application\s)', $replacement
  Write-Host "  enabled cleartext HTTP (local dev only)" -ForegroundColor Green
} else {
  Write-Host "  cleartext HTTP already enabled" -ForegroundColor DarkGray
}

Set-Content -Path $manifest -Value $xml -Encoding utf8

# --- 3. Bump minSdk -------------------------------------------------------
# The audio recorder needs API 23. Flutter's default is lower on older
# templates, and the build error it produces is not obvious.
$gradleKts = Join-Path $mobile 'android\app\build.gradle.kts'
$gradle = Join-Path $mobile 'android\app\build.gradle'

if (Test-Path $gradleKts) {
  $g = Get-Content $gradleKts -Raw
  if ($g -match 'minSdk\s*=\s*flutter\.minSdkVersion') {
    $g = $g -replace 'minSdk\s*=\s*flutter\.minSdkVersion', 'minSdk = 23'
    Set-Content -Path $gradleKts -Value $g -Encoding utf8
    Write-Host "  minSdk set to 23" -ForegroundColor Green
  }
} elseif (Test-Path $gradle) {
  $g = Get-Content $gradle -Raw
  if ($g -match 'minSdkVersion\s+flutter\.minSdkVersion') {
    $g = $g -replace 'minSdkVersion\s+flutter\.minSdkVersion', 'minSdkVersion 23'
    Set-Content -Path $gradle -Value $g -Encoding utf8
    Write-Host "  minSdk set to 23" -ForegroundColor Green
  }
}

# --- 4. Dependencies ------------------------------------------------------
Push-Location $mobile
try {
  flutter pub get
} finally {
  Pop-Location
}

Write-Host ""
Write-Host "Setup complete. Next:" -ForegroundColor Cyan
Write-Host "  scripts\dev.ps1        starts the backend + tunnels the port + runs the app"
