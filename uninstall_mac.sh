#!/usr/bin/env bash
# FlowScale AI OS — macOS uninstall script
# Removes the app, local data, and clears icon cache.
set -euo pipefail

RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'
CYAN='\033[0;36m'; BOLD='\033[1m'; RESET='\033[0m'

info()    { echo -e "${CYAN}${BOLD}[flowscale]${RESET} $*"; }
success() { echo -e "${GREEN}${BOLD}[✓]${RESET} $*"; }
warn()    { echo -e "${YELLOW}${BOLD}[!]${RESET} $*"; }

echo ""
echo -e "${BOLD}FlowScale AI OS — Uninstall${RESET}"
echo "────────────────────────────────────────"
echo ""

# Remove the app bundle
if [[ -d "/Applications/FlowScale AI OS.app" ]]; then
  info "Removing /Applications/FlowScale AI OS.app…"
  rm -rf "/Applications/FlowScale AI OS.app"
  success "App removed."
else
  warn "App not found in /Applications — skipping."
fi

# Remove app data
if [[ -d "$HOME/.flowscale" ]]; then
  info "Removing app data (~/.flowscale)…"
  rm -rf "$HOME/.flowscale"
  success "App data removed."
else
  warn "No app data found — skipping."
fi

# Clear icon cache
info "Clearing macOS icon cache…"
sudo rm -rf /Library/Caches/com.apple.iconservices.store
success "Icon cache cleared."

# Restart Dock
info "Restarting Dock…"
killall Dock

echo ""
success "FlowScale AI OS has been fully uninstalled."
echo ""
