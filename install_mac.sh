#!/usr/bin/env bash
# FlowScale AI OS — source install & launch script
# Clones the repo, installs all dependencies, builds, and starts the app.
set -euo pipefail

# ─── colours ──────────────────────────────────────────────────────────────────
RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'
CYAN='\033[0;36m'; BOLD='\033[1m'; RESET='\033[0m'

info()    { echo -e "${CYAN}${BOLD}[flowscale]${RESET} $*"; }
success() { echo -e "${GREEN}${BOLD}[✓]${RESET} $*"; }
warn()    { echo -e "${YELLOW}${BOLD}[!]${RESET} $*"; }
die()     { echo -e "${RED}${BOLD}[✗] ERROR:${RESET} $*" >&2; exit 1; }

# ─── config ───────────────────────────────────────────────────────────────────
REPO_URL="git@github.com:FlowScale-AI/flowscale-eios.git"
REPO_DIR="${FLOWSCALE_DIR:-flowscale-aios}"
WEB_PORT=14173
NODE_MIN=20
PNPM_REQ="9.15.0"

# ─── helpers ──────────────────────────────────────────────────────────────────
require_cmd() { command -v "$1" &>/dev/null || die "'$1' is required. $2"; }

version_gte() {
  # true if $1 >= $2 (pure bash, no sort -V needed — macOS compatible)
  local IFS=. i
  local -a v1=($1) v2=($2)
  for ((i = 0; i < ${#v2[@]}; i++)); do
    [[ -z ${v1[i]:-} ]] && v1[i]=0
    ((10#${v1[i]} > 10#${v2[i]})) && return 0
    ((10#${v1[i]} < 10#${v2[i]})) && return 1
  done
  return 0
}

kill_port() {
  # macOS uses lsof; Linux uses fuser
  local port=$1
  if command -v fuser &>/dev/null; then
    fuser -k "${port}/tcp" 2>/dev/null || true
  elif command -v lsof &>/dev/null; then
    lsof -ti ":${port}" 2>/dev/null | xargs kill -9 2>/dev/null || true
  fi
}

wait_for_port() {
  local port=$1 timeout=${2:-90} elapsed=0
  info "Waiting for web server on port $port…"
  while ! nc -z 127.0.0.1 "$port" 2>/dev/null; do
    sleep 1; elapsed=$((elapsed + 1))
    [[ $elapsed -ge $timeout ]] && die "Web server did not come up within ${timeout}s."
  done
  success "Web server is ready on port $port."
}

# ─── header ───────────────────────────────────────────────────────────────────
echo ""
echo -e "${BOLD}FlowScale AI OS — Setup${RESET}"
echo "────────────────────────────────────────"
echo ""

# ─── 1. system requirements ───────────────────────────────────────────────────
info "Checking system requirements…"

require_cmd git  "Install git: https://git-scm.com/downloads"
require_cmd node "Install Node.js ≥ $NODE_MIN: https://nodejs.org/"
require_cmd nc   "Install netcat. Linux: sudo apt install netcat-openbsd / sudo dnf install nmap-ncat. macOS: built-in, should already be present."

NODE_VER=$(node -e 'process.stdout.write(process.versions.node)')
version_gte "$NODE_VER" "$NODE_MIN" \
  || die "Node.js $NODE_MIN+ required, found $NODE_VER. Upgrade at https://nodejs.org/"
success "Node.js $NODE_VER"

# ─── 2. pnpm ──────────────────────────────────────────────────────────────────
if command -v pnpm &>/dev/null; then
  PNPM_VER=$(pnpm --version)
  success "pnpm $PNPM_VER"
else
  warn "pnpm not found — installing via corepack…"
  if ! command -v corepack &>/dev/null; then
    npm install -g "pnpm@$PNPM_REQ" || die "Failed to install pnpm."
  else
    corepack enable
    corepack prepare "pnpm@$PNPM_REQ" --activate
  fi
  success "pnpm $(pnpm --version)"
fi

# ─── 3. Electron Linux system deps ────────────────────────────────────────────
if [[ "$(uname -s)" == "Linux" ]]; then
  info "Installing Electron system dependencies…"
  if command -v apt-get &>/dev/null; then
    sudo apt-get install -y \
      libgtk-3-0 libnss3 libxss1 libasound2 \
      libatk-bridge2.0-0 libdrm2 libgbm1 libxkbcommon0 \
      2>/dev/null || warn "Some packages may already be installed."
  elif command -v dnf &>/dev/null; then
    sudo dnf install -y \
      gtk3 nss libXScrnSaver alsa-lib \
      at-spi2-atk libdrm mesa-libgbm libxkbcommon \
      2>/dev/null || warn "Some packages may already be installed."
  elif command -v pacman &>/dev/null; then
    sudo pacman -S --needed --noconfirm \
      gtk3 nss libxss alsa-lib at-spi2-atk libdrm mesa libxkbcommon \
      2>/dev/null || warn "Some packages may already be installed."
  else
    warn "Unknown package manager — skipping Electron system deps."
    warn "If the app fails to launch, install GTK3/NSS/ALSA for your distro."
  fi
fi

# ─── 4. clone ─────────────────────────────────────────────────────────────────
if [[ -d "$REPO_DIR/.git" ]]; then
  warn "Repository already exists at './$REPO_DIR' — skipping clone."
  cd "$REPO_DIR"
  info "Pulling latest changes…"
  git pull --ff-only || warn "Could not pull latest changes (uncommitted local changes?)."
else
  info "Cloning $REPO_URL → ./$REPO_DIR"
  git clone --branch mvp "$REPO_URL" "$REPO_DIR"
  cd "$REPO_DIR"
fi

# ─── 5. install node_modules ──────────────────────────────────────────────────
info "Installing Node.js dependencies…"
pnpm install --frozen-lockfile

# ─── 6. build all packages (turbo respects dependency order) ──────────────────
info "Building all packages…"
pnpm build

# ─── 8. platform-specific launch ─────────────────────────────────────────────
OS="$(uname -s)"

if [[ "$OS" == "Darwin" ]]; then
  # macOS: package as a proper .app bundle and install to /Applications.
  # The packaged app bundles its own Next.js standalone server (via
  # extraResources in electron-builder.yml), so no external web server needed.
  # The package:mac script automatically rebuilds native modules (e.g.
  # better-sqlite3) for Electron's Node.js ABI before bundling.
  APP_NAME="FlowScale AI OS"
  APP_BUNDLE="/Applications/${APP_NAME}.app"

  if [[ ! -d "$APP_BUNDLE" ]]; then
    info "Packaging macOS app bundle…"
    pnpm --filter @flowscale/aios-desktop package:mac
    RELEASE_APP="apps/desktop/release/mac/${APP_NAME}.app"
    # electron-builder puts it in mac-arm64/ on Apple Silicon
    [[ -d "$RELEASE_APP" ]] || RELEASE_APP="apps/desktop/release/mac-arm64/${APP_NAME}.app"
    [[ -d "$RELEASE_APP" ]] \
      || die "App bundle not found after packaging. Check electron-builder output."
    info "Installing to /Applications…"
    cp -R "$RELEASE_APP" "/Applications/"
    success "Installed ${APP_NAME} to /Applications."
  else
    info "${APP_NAME}.app already exists in /Applications — skipping packaging."
  fi

  echo ""
  success "All set. Launching FlowScale AI OS…"
  echo ""

  open "$APP_BUNDLE"
else
  # Linux / WSL: start web server in background and run Electron directly

  # Free the port if something else is already using it
  if (command -v fuser &>/dev/null && fuser "${WEB_PORT}/tcp" &>/dev/null 2>&1) || \
     (command -v lsof  &>/dev/null && lsof -ti ":${WEB_PORT}" &>/dev/null 2>&1); then
    warn "Port $WEB_PORT is in use — stopping existing process…"
    kill_port "$WEB_PORT"
    sleep 1
  fi

  info "Starting Next.js server on port $WEB_PORT…"
  pnpm --filter @flowscale/aios-web start &
  WEB_PID=$!

  # Kill the web server when this script exits for any reason
  cleanup() {
    if kill -0 "$WEB_PID" 2>/dev/null; then
      info "Stopping web server (pid $WEB_PID)…"
      kill "$WEB_PID"
    fi
  }
  trap cleanup EXIT INT TERM

  wait_for_port "$WEB_PORT" 90

  ELECTRON_BIN="apps/desktop/node_modules/.bin/electron"
  [[ -x "$ELECTRON_BIN" ]] \
    || die "Electron binary not found at $ELECTRON_BIN — did pnpm install succeed?"

  # WSL display check
  if grep -qiE "microsoft|wsl" /proc/version 2>/dev/null; then
    if [[ -z "${DISPLAY:-}" ]] && [[ -z "${WAYLAND_DISPLAY:-}" ]]; then
      die "WSL detected but no display found.\nOn Windows 11 WSL2, WSLg should provide a display automatically.\nOn Windows 10, install VcXsrv and run: export DISPLAY=:0"
    fi
  fi

  echo ""
  success "All set. Launching FlowScale AI OS…"
  echo ""

  "$ELECTRON_BIN" apps/desktop/dist/main.js

  # Electron has exited — trap will clean up the web server
fi
