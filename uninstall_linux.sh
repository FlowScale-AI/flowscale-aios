#!/usr/bin/env bash
# FlowScale AI OS — Linux uninstall script
# Removes the AppImage, desktop entry, icon, app data, and electron config.
set -euo pipefail

# If run as root (e.g. sudo ./uninstall_linux.sh), re-exec as the real user
# so that $HOME paths resolve correctly, then use sudo only for chattr.
if [[ $EUID -eq 0 ]] && [[ -n "${SUDO_USER:-}" ]]; then
  exec sudo -u "$SUDO_USER" env SUDO_AVAILABLE=1 bash "$0" "$@"
fi

RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'
CYAN='\033[0;36m'; BOLD='\033[1m'; RESET='\033[0m'

info()    { echo -e "${CYAN}${BOLD}[flowscale]${RESET} $*"; }
success() { echo -e "${GREEN}${BOLD}[✓]${RESET} $*"; }
warn()    { echo -e "${YELLOW}${BOLD}[!]${RESET} $*"; }

APP_NAME="FlowScale AI OS"
APP_ID="flowscale-aios"
INSTALL_DIR="$HOME/.local/share/${APP_ID}"
APPIMAGE_DEST="${INSTALL_DIR}/${APP_NAME}.AppImage"
DESKTOP_FILE="$HOME/.local/share/applications/${APP_ID}.desktop"
ICON_FILE="$HOME/.local/share/icons/hicolor/256x256/apps/${APP_ID}.png"

echo ""
echo -e "${BOLD}FlowScale AI OS — Uninstall (Linux)${RESET}"
echo "────────────────────────────────────────"
echo ""

# Kill any running FlowScale processes
info "Stopping running processes…"
# Kill by process name (AppImage sets the comm to the app name)
pkill -f "${APP_NAME}.AppImage" 2>/dev/null || true
# Kill Next.js standalone server on port 14173
if command -v fuser &>/dev/null; then
  fuser -k 14173/tcp 2>/dev/null || true
elif command -v lsof &>/dev/null; then
  lsof -ti TCP:14173 -sTCP:LISTEN 2>/dev/null | xargs kill -9 2>/dev/null || true
fi
sleep 1
success "Processes stopped."

# Remove AppImage + install dir
if [[ -d "$INSTALL_DIR" ]]; then
  info "Removing AppImage and install dir (${INSTALL_DIR})…"
  rm -rf "$INSTALL_DIR"
  success "AppImage removed."
else
  warn "Install dir not found (${INSTALL_DIR}) — skipping."
fi

# Remove .desktop entry
if [[ -f "$DESKTOP_FILE" ]]; then
  info "Removing desktop entry…"
  # Clear immutable flag if set
  if [[ "${SUDO_AVAILABLE:-}" == "1" ]]; then
    sudo chattr -i "$DESKTOP_FILE" 2>/dev/null || true
  else
    chattr -i "$DESKTOP_FILE" 2>/dev/null || true
  fi
  rm -f "$DESKTOP_FILE"
  command -v update-desktop-database &>/dev/null \
    && update-desktop-database "$HOME/.local/share/applications" 2>/dev/null || true
  success "Desktop entry removed."
else
  warn "Desktop entry not found — skipping."
fi

# Remove icon
if [[ -f "$ICON_FILE" ]]; then
  info "Removing icon…"
  rm -f "$ICON_FILE"
  # Refresh icon theme cache if gtk-update-icon-cache is available
  command -v gtk-update-icon-cache &>/dev/null \
    && gtk-update-icon-cache -f -t "$HOME/.local/share/icons/hicolor" 2>/dev/null || true
  success "Icon removed."
else
  warn "Icon not found — skipping."
fi

# Remove Electron config / cache / logs (~/.config/flowscale-aios)
if [[ -d "$HOME/.config/flowscale-aios" ]]; then
  info "Removing Electron config and logs (~/.config/flowscale-aios)…"
  rm -rf "$HOME/.config/flowscale-aios"
  success "Electron config removed."
else
  warn "No Electron config found — skipping."
fi

# Remove Electron cache (~/.cache/flowscale-aios)
if [[ -d "$HOME/.cache/flowscale-aios" ]]; then
  info "Removing Electron cache (~/.cache/flowscale-aios)…"
  rm -rf "$HOME/.cache/flowscale-aios"
  success "Electron cache removed."
else
  warn "No Electron cache found — skipping."
fi

echo ""
success "FlowScale AI OS has been fully uninstalled."
echo ""
