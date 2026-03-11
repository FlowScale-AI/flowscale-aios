#!/usr/bin/env bash
# FlowScale AI OS — macOS update script
# Uninstalls the current version and installs the latest.
set -euo pipefail

RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'
CYAN='\033[0;36m'; BOLD='\033[1m'; RESET='\033[0m'

info()    { echo -e "${CYAN}${BOLD}[flowscale]${RESET} $*"; }
success() { echo -e "${GREEN}${BOLD}[✓]${RESET} $*"; }

echo ""
echo -e "${BOLD}FlowScale AI OS — Update${RESET}"
echo "────────────────────────────────────────"
echo ""

info "Step 1/2: Uninstalling current version…"
curl -fsSL https://flowscale.ai/uninstall_mac.sh | sudo bash

info "Step 2/2: Installing latest version…"
curl -fsSL https://flowscale.ai/install_mac.sh | sudo bash
