# FlowScale AI OS -- source install & launch script
# Clones the repo, installs all dependencies, builds, and runs the installer.
#
# Usage (one-liner from PowerShell as Administrator):
#   irm https://flowscale.ai/install_windows.ps1 | iex
#
#Requires -Version 5.1
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

# ─── colours ──────────────────────────────────────────────────────────────────
function Write-Info    { param($msg) Write-Host "[flowscale] $msg" -ForegroundColor Cyan }
function Write-Success { param($msg) Write-Host "[v] $msg"         -ForegroundColor Green }
function Write-Warn    { param($msg) Write-Host "[!] $msg"         -ForegroundColor Yellow }
function Write-Die     { param($msg) Write-Host "[x] ERROR: $msg"  -ForegroundColor Red; exit 1 }

# ─── config ───────────────────────────────────────────────────────────────────
$REPO_URL  = "https://github.com/FlowScale-AI/flowscale-aios.git"
$REPO_DIR  = if ($env:FLOWSCALE_DIR) { $env:FLOWSCALE_DIR } else { "flowscale-aios" }
$NODE_MIN  = 20
$PNPM_REQ  = "9.15.0"

# ─── helpers ──────────────────────────────────────────────────────────────────
function Require-Cmd {
    param($cmd, $hint)
    if (-not (Get-Command $cmd -ErrorAction SilentlyContinue)) {
        Write-Die "'$cmd' is required. $hint"
    }
}

function Version-Gte {
    param([string]$v1, [string]$v2)
    $a = [version]($v1 -replace '[^0-9.]', '')
    $b = [version]($v2 -replace '[^0-9.]', '')
    return $a -ge $b
}

function Kill-Port {
    param([int]$port)
    $pids = (netstat -ano | Select-String ":$port\s" | ForEach-Object {
        ($_ -split '\s+')[-1]
    } | Sort-Object -Unique)
    foreach ($p in $pids) {
        if ($p -match '^\d+$' -and $p -ne '0') {
            Stop-Process -Id ([int]$p) -Force -ErrorAction SilentlyContinue
        }
    }
}

# ─── header ───────────────────────────────────────────────────────────────────
Write-Host ""
Write-Host "FlowScale AI OS -- Setup" -ForegroundColor White
Write-Host "----------------------------------------"
Write-Host ""

# ─── 1. system requirements ───────────────────────────────────────────────────
Write-Info "Checking system requirements..."

Require-Cmd git  "Install git: https://git-scm.com/downloads"
Require-Cmd node "Install Node.js >= $NODE_MIN: https://nodejs.org/"

$NODE_VER = (node -e 'process.stdout.write(process.versions.node)' 2>&1)
if (-not (Version-Gte $NODE_VER "$NODE_MIN.0.0")) {
    Write-Die "Node.js $NODE_MIN+ required, found $NODE_VER. Upgrade at https://nodejs.org/"
}
Write-Success "Node.js $NODE_VER"

# ─── 2. pnpm ──────────────────────────────────────────────────────────────────
if (Get-Command pnpm -ErrorAction SilentlyContinue) {
    $PNPM_VER = (pnpm --version)
    Write-Success "pnpm $PNPM_VER"
} else {
    Write-Warn "pnpm not found -- installing via npm..."
    npm install -g "pnpm@$PNPM_REQ"
    if ($LASTEXITCODE -ne 0) { Write-Die "Failed to install pnpm." }
    Write-Success "pnpm $(pnpm --version)"
}

# ─── 3. clone or update ───────────────────────────────────────────────────────
# All work happens inside a temp directory so the caller's working directory
# is never changed -- required for safe piped execution (irm ... | iex).
$WORK_DIR = Join-Path $env:TEMP "flowscale-install-$([System.IO.Path]::GetRandomFileName())"
New-Item -ItemType Directory -Path $WORK_DIR | Out-Null

try {
    $REPO_PATH = Join-Path $WORK_DIR $REPO_DIR

    if (Test-Path (Join-Path $REPO_PATH ".git")) {
        Write-Warn "Repository already exists at '$REPO_PATH' -- skipping clone."
        Push-Location $REPO_PATH
        Write-Info "Pulling latest changes..."
        git pull --ff-only
        if ($LASTEXITCODE -ne 0) { Write-Warn "Could not pull latest changes (uncommitted local changes?)." }
        Pop-Location
    } else {
        Write-Info "Cloning $REPO_URL -> $REPO_PATH"
        git clone --branch main $REPO_URL $REPO_PATH
        if ($LASTEXITCODE -ne 0) { Write-Die "git clone failed." }
    }

    # ─── 4. install node_modules ──────────────────────────────────────────────
    Write-Info "Installing Node.js dependencies..."
    Push-Location $REPO_PATH
    pnpm install --frozen-lockfile --reporter=append-only
    if ($LASTEXITCODE -ne 0) { Pop-Location; Write-Die "pnpm install failed." }

    # ─── 5. build all packages ────────────────────────────────────────────────
    Write-Info "Building all packages..."
    pnpm build
    if ($LASTEXITCODE -ne 0) { Pop-Location; Write-Die "pnpm build failed." }

    # ─── 6. package Windows NSIS installer ────────────────────────────────────
    Write-Info "Packaging Windows installer..."
    pnpm --filter "@flowscale/aios-desktop" package:win
    if ($LASTEXITCODE -ne 0) { Pop-Location; Write-Die "Packaging failed. Check electron-builder output." }

    $INSTALLER_SRC = Get-ChildItem -Path "apps\desktop\release" -Filter "*.exe" -ErrorAction SilentlyContinue |
        Where-Object { $_.Name -notlike "Uninstall*" } |
        Sort-Object LastWriteTime -Descending |
        Select-Object -First 1

    if (-not $INSTALLER_SRC) {
        Pop-Location
        Write-Die "Installer .exe not found after packaging. Check electron-builder output."
    }

    # Copy installer out of the repo dir before cleanup
    $INSTALLER_DEST = Join-Path $env:TEMP $INSTALLER_SRC.Name
    Copy-Item -Path $INSTALLER_SRC.FullName -Destination $INSTALLER_DEST -Force
    Write-Success "Installer built: $($INSTALLER_SRC.Name)"
    Pop-Location

    # ─── 7. clean up source dir ───────────────────────────────────────────────
    Write-Info "Removing build directory..."
    Remove-Item -Recurse -Force $WORK_DIR
    Write-Success "Build directory removed."

} catch {
    # Ensure Pop-Location balance and temp cleanup on unexpected errors
    try { Pop-Location } catch {}
    try { Remove-Item -Recurse -Force $WORK_DIR -ErrorAction SilentlyContinue } catch {}
    Write-Die $_.Exception.Message
}

# ─── 8. launch installer ──────────────────────────────────────────────────────
Write-Host ""
Write-Success "All set. Launching FlowScale AI OS installer..."
Write-Host ""

Start-Process -FilePath $INSTALLER_DEST -Wait
Remove-Item -Force $INSTALLER_DEST -ErrorAction SilentlyContinue
