# FlowScale AI OS -- Windows uninstall script
# Stops running processes, runs the NSIS uninstaller, and removes app data.
#Requires -Version 5.1
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

# ─── colours ──────────────────────────────────────────────────────────────────
function Write-Info    { param($msg) Write-Host "[flowscale] $msg" -ForegroundColor Cyan }
function Write-Success { param($msg) Write-Host "[v] $msg"         -ForegroundColor Green }
function Write-Warn    { param($msg) Write-Host "[!] $msg"         -ForegroundColor Yellow }

# ─── config ───────────────────────────────────────────────────────────────────
$APP_NAME      = "FlowScale AI OS"
$APP_ID        = "flowscale-aios"
# Default NSIS install location (electron-builder allowToChangeInstallationDirectory)
$INSTALL_DIR   = Join-Path $env:LOCALAPPDATA "Programs\$APP_NAME"
$UNINSTALLER   = Join-Path $INSTALL_DIR "Uninstall $APP_NAME.exe"
# Electron app data (config, logs, cache)
$APP_DATA      = Join-Path $env:APPDATA $APP_ID
$APP_DATA_LOCAL= Join-Path $env:LOCALAPPDATA $APP_ID
# FlowScale output / DB data
$FLOWSCALE_DIR = Join-Path $env:USERPROFILE ".flowscale"

# ─── header ───────────────────────────────────────────────────────────────────
Write-Host ""
Write-Host "FlowScale AI OS -- Uninstall (Windows)" -ForegroundColor White
Write-Host "----------------------------------------"
Write-Host ""

# ─── 1. stop running processes ────────────────────────────────────────────────
Write-Info "Stopping running processes..."

# Kill the Electron app by process name
Get-Process -Name "FlowScale AI OS" -ErrorAction SilentlyContinue | Stop-Process -Force
Get-Process -Name "flowscale-aios"  -ErrorAction SilentlyContinue | Stop-Process -Force

# Kill anything holding port 14173 (Next.js standalone server)
$portPids = (netstat -ano | Select-String ":14173\s" | ForEach-Object {
    ($_ -split '\s+')[-1]
} | Sort-Object -Unique)
foreach ($p in $portPids) {
    if ($p -match '^\d+$' -and $p -ne '0') {
        Stop-Process -Id ([int]$p) -Force -ErrorAction SilentlyContinue
    }
}

Start-Sleep -Seconds 1
Write-Success "Processes stopped."

# ─── 2. run NSIS uninstaller ──────────────────────────────────────────────────
if (Test-Path $UNINSTALLER) {
    Write-Info "Running uninstaller: $UNINSTALLER"
    # /S = silent uninstall (NSIS flag)
    Start-Process -FilePath $UNINSTALLER -ArgumentList "/S" -Wait
    Write-Success "App uninstalled."
} elseif (Test-Path $INSTALL_DIR) {
    Write-Warn "Uninstaller not found at expected path -- removing install dir directly."
    Remove-Item -Recurse -Force $INSTALL_DIR
    Write-Success "Install directory removed."
} else {
    Write-Warn "Install directory not found ($INSTALL_DIR) -- skipping."
}

# ─── 3. remove app data (Electron config / logs / cache) ──────────────────────
if (Test-Path $APP_DATA) {
    Write-Info "Removing Electron app data ($APP_DATA)..."
    Remove-Item -Recurse -Force $APP_DATA
    Write-Success "App data removed."
} else {
    Write-Warn "No app data found at $APP_DATA -- skipping."
}

if (Test-Path $APP_DATA_LOCAL) {
    Write-Info "Removing Electron local app data ($APP_DATA_LOCAL)..."
    Remove-Item -Recurse -Force $APP_DATA_LOCAL
    Write-Success "Local app data removed."
} else {
    Write-Warn "No local app data found at $APP_DATA_LOCAL -- skipping."
}

# ─── 4. remove FlowScale output / database ────────────────────────────────────
if (Test-Path $FLOWSCALE_DIR) {
    Write-Info "Removing FlowScale data (~\.flowscale)..."
    $confirm = Read-Host "  This will also delete your tools, executions, and outputs. Continue? [y/N]"
    if ($confirm -match '^[Yy]$') {
        Remove-Item -Recurse -Force $FLOWSCALE_DIR
        Write-Success "FlowScale data removed."
    } else {
        Write-Warn "Skipped removal of $FLOWSCALE_DIR (kept)."
    }
} else {
    Write-Warn "No FlowScale data found at $FLOWSCALE_DIR -- skipping."
}

Write-Host ""
Write-Success "FlowScale AI OS has been fully uninstalled."
Write-Host ""
