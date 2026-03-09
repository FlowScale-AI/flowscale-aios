#!/usr/bin/env bash
# FlowScale AI OS -- source install & launch script
# Clones the repo, installs all dependencies, builds, and starts the app.
set -euo pipefail

# --- colours ------------------------------------------------------------------
RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'
CYAN='\033[0;36m'; BOLD='\033[1m'; RESET='\033[0m'

info()    { echo -e "${CYAN}${BOLD}[flowscale]${RESET} $*"; }
success() { echo -e "${GREEN}${BOLD}[v]${RESET} $*"; }
warn()    { echo -e "${YELLOW}${BOLD}[!]${RESET} $*"; }
die()     { echo -e "${RED}${BOLD}[x] ERROR:${RESET} $*" >&2; exit 1; }

# ─── config ───────────────────────────────────────────────────────────────────
REPO_URL="https://github.com/FlowScale-AI/flowscale-aios.git"
REPO_DIR="${FLOWSCALE_DIR:-flowscale-aios}"
NODE_MIN=20
PNPM_REQ="9.15.0"

# --- helpers ------------------------------------------------------------------
require_cmd() { command -v "$1" &>/dev/null || die "'$1' is required. $2"; }

version_gte() {
  # true if $1 >= $2 (pure bash, macOS compatible -- no sort -V)
  local IFS=. i
  local -a v1=($1) v2=($2)
  for ((i = 0; i < ${#v2[@]}; i++)); do
    [[ -z ${v1[i]:-} ]] && v1[i]=0
    ((10#${v1[i]} > 10#${v2[i]})) && return 0
    ((10#${v1[i]} < 10#${v2[i]})) && return 1
  done
  return 0
}


# --- header -------------------------------------------------------------------
echo ""
echo -e "${BOLD}FlowScale AI OS -- Setup${RESET}"
echo "----------------------------------------"
echo ""

# --- 1. system requirements ---------------------------------------------------
info "Checking system requirements..."

require_cmd git  "Install git: https://git-scm.com/downloads"
require_cmd node "Install Node.js >= ${NODE_MIN}: https://nodejs.org/"

NODE_VER=$(node -e 'process.stdout.write(process.versions.node)')
version_gte "$NODE_VER" "$NODE_MIN" \
  || die "Node.js ${NODE_MIN}+ required, found ${NODE_VER}. Upgrade at https://nodejs.org/"
success "Node.js ${NODE_VER}"

# --- 2. pnpm ------------------------------------------------------------------
if command -v pnpm &>/dev/null; then
  PNPM_VER=$(pnpm --version)
  success "pnpm ${PNPM_VER}"
else
  warn "pnpm not found -- installing via corepack..."
  if ! command -v corepack &>/dev/null; then
    npm install -g "pnpm@${PNPM_REQ}" || die "Failed to install pnpm."
  else
    corepack enable
    corepack prepare "pnpm@${PNPM_REQ}" --activate
  fi
  success "pnpm $(pnpm --version)"
fi

# --- 3. Electron Linux system deps --------------------------------------------
if [[ "$(uname -s)" == "Linux" ]]; then
  info "Installing Electron system dependencies..."
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
    warn "Unknown package manager -- skipping Electron system deps."
    warn "If the app fails to launch, install GTK3/NSS/ALSA for your distro."
  fi
fi

# --- 4. clone -----------------------------------------------------------------
if [[ -d "$REPO_DIR/.git" ]]; then
  warn "Repository already exists at './${REPO_DIR}' -- skipping clone."
  cd "$REPO_DIR"
  info "Pulling latest changes..."
  git pull --ff-only || warn "Could not pull latest changes (uncommitted local changes?)."
else
  info "Cloning ${REPO_URL} -> ./${REPO_DIR}"
  git clone --branch main "$REPO_URL" "$REPO_DIR"
  cd "$REPO_DIR"
fi

# ─── 5. install node_modules ──────────────────────────────────────────────────
info "Installing Node.js dependencies…"
# --reporter=append-only prevents pnpm's interactive progress bar from hanging
# when the script is piped from curl (no TTY attached to stdin).
pnpm install --frozen-lockfile --reporter=append-only

# --- 6. build all packages (turbo respects dependency order) ------------------
info "Building all packages..."
pnpm build

# --- 7. package AppImage ------------------------------------------------------
APP_NAME="FlowScale AI OS"
APP_ID="flowscale-aios"
INSTALL_DIR="$HOME/.local/share/${APP_ID}"
APPIMAGE_DEST="${INSTALL_DIR}/${APP_NAME}.AppImage"

info "Packaging Linux AppImage..."
pnpm --filter @flowscale/aios-desktop package:linux

APPIMAGE=$(ls apps/desktop/release/*.AppImage 2>/dev/null | head -1)
[[ -n "$APPIMAGE" ]] \
  || die "AppImage not found after packaging. Check electron-builder output."

mkdir -p "$INSTALL_DIR"
cp "$APPIMAGE" "$APPIMAGE_DEST"
chmod +x "$APPIMAGE_DEST"
success "Installed AppImage to ${APPIMAGE_DEST}."

# --- 8. icon ------------------------------------------------------------------
ICON_DIR="$HOME/.local/share/icons/hicolor/256x256/apps"
mkdir -p "$ICON_DIR"
ICON_SRC="apps/desktop/build/icon.png"
if [[ -f "$ICON_SRC" ]]; then
  cp "$ICON_SRC" "${ICON_DIR}/${APP_ID}.png"
fi

# --- 9. .desktop entry --------------------------------------------------------
APPS_DIR="$HOME/.local/share/applications"
mkdir -p "$APPS_DIR"
cat > "${APPS_DIR}/${APP_ID}.desktop" <<DESKTOP
[Desktop Entry]
Name=${APP_NAME}
Exec=${APPIMAGE_DEST} %u
Icon=${APP_ID}
StartupWMClass=${APP_ID}
StartupNotify=false
Terminal=false
Type=Application
Categories=Development;
DESKTOP

command -v update-desktop-database &>/dev/null \
  && update-desktop-database "$APPS_DIR" 2>/dev/null || true
success "App registered in launcher -- ${APP_NAME} will appear in your app menu."

# --- 10. launch ---------------------------------------------------------------
# WSL display check
if grep -qiE "microsoft|wsl" /proc/version 2>/dev/null; then
  if [[ -z "${DISPLAY:-}" ]] && [[ -z "${WAYLAND_DISPLAY:-}" ]]; then
    die "WSL detected but no display found.\nOn Windows 11 WSL2, WSLg provides a display automatically.\nOn Windows 10, install VcXsrv and run: export DISPLAY=:0"
  fi
fi

echo ""
success "All set. Launching FlowScale AI OS..."
echo ""
nohup "$APPIMAGE_DEST" &>/dev/null &
disown
