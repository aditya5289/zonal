# Day-to-day dev launcher.
#
#   powershell -ExecutionPolicy Bypass -File scripts\dev.ps1
#
# Starts the API, tunnels port 4000 down the USB cable to the phone, and runs
# the app. The tunnel is the important part: the phone's `localhost` is the
# phone, so without `adb reverse` the app cannot see the server at all.
#
# Re-run this whenever you unplug and replug the phone.

param(
  [switch]$NoApp,      # start the backend and the tunnel only
  [switch]$Web         # run the admin dashboard in Chrome instead of the phone
)

$ErrorActionPreference = 'Stop'

$root = Join-Path $PSScriptRoot '..' | Resolve-Path
$backend = Join-Path $root 'backend'
$mobile = Join-Path $root 'mobile'

# --- 1. Backend -----------------------------------------------------------
Write-Host "Starting the API on http://localhost:4000 ..." -ForegroundColor Cyan
Start-Process powershell -ArgumentList @(
  '-NoExit', '-Command', "Set-Location '$backend'; npm run dev"
)

# --- 2. USB tunnel --------------------------------------------------------
if (-not $Web) {
  if (Get-Command adb -ErrorAction SilentlyContinue) {
    $devices = (adb devices | Select-String -Pattern "`tdevice$")

    if ($devices) {
      adb reverse tcp:4000 tcp:4000
      Write-Host "Tunnelled phone:4000 -> pc:4000 over USB" -ForegroundColor Green
    } else {
      Write-Host "No authorised phone found." -ForegroundColor Yellow
      Write-Host "  - USB debugging on?  Settings > Developer options"
      Write-Host "  - USB mode set to File transfer, not Charging only?"
      Write-Host "  - Accepted the 'Allow USB debugging' prompt on the phone?"
      Write-Host "  Run 'adb devices' - it should say 'device', not 'unauthorized'."
    }
  } else {
    Write-Host "adb is not on PATH - install Android Studio's platform-tools." -ForegroundColor Yellow
  }
}

# --- 3. App ---------------------------------------------------------------
if ($NoApp) {
  Write-Host "Backend and tunnel are up. Skipping the app." -ForegroundColor Cyan
  exit 0
}

Push-Location $mobile
try {
  if ($Web) {
    # Chrome cannot use adb reverse, so point it straight at the host.
    flutter run -d chrome --dart-define=API_BASE_URL=http://localhost:4000
  } else {
    flutter run
  }
} finally {
  Pop-Location
}
