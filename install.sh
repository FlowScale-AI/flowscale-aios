#!/usr/bin/env bash
# FlowScale AI OS — Installer
# Supports: Linux (apt / dnf / pacman / zypper), macOS

set -e

APP_NAME="FlowScale AI OS"
APP_ID="flowscale-aios"
ICON_URL="https://raw.githubusercontent.com/flowscale/flowscale-aios/main/apps/desktop/assets/icon.png"

# ── Colours ──────────────────────────────────────────────────────────────────
RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'
BOLD='\033[1m'; RESET='\033[0m'

info()    { echo -e "${BOLD}[+]${RESET} $*"; }
success() { echo -e "${GREEN}[✓]${RESET} $*"; }
warn()    { echo -e "${YELLOW}[!]${RESET} $*"; }
die()     { echo -e "${RED}[✗]${RESET} $*"; exit 1; }

# ── Locate the release archive / directory ───────────────────────────────────
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

find_release() {
  # Accept: dir named linux-unpacked, or .tar.gz, or .zip next to the script
  if   [[ -d "$SCRIPT_DIR/linux-unpacked" ]];                     then echo "$SCRIPT_DIR/linux-unpacked"
  elif ls "$SCRIPT_DIR/$APP_ID"-*-x64.tar.gz 2>/dev/null | head -1 | grep -q .; then
       ls "$SCRIPT_DIR/$APP_ID"-*-x64.tar.gz | head -1
  elif ls "$SCRIPT_DIR/$APP_ID"*.tar.gz      2>/dev/null | head -1 | grep -q .; then
       ls "$SCRIPT_DIR/$APP_ID"*.tar.gz | head -1
  fi
}

# ══════════════════════════════════════════════════════════════════════════════
# macOS
# ══════════════════════════════════════════════════════════════════════════════
install_mac() {
  info "Detected macOS"

  # Look for .dmg or .zip .app bundle
  DMG=$(ls "$SCRIPT_DIR"/*.dmg 2>/dev/null | head -1 || true)
  ZIP=$(ls "$SCRIPT_DIR"/*.zip 2>/dev/null | head -1 || true)
  APP=$(ls -d "$SCRIPT_DIR"/*.app 2>/dev/null | head -1 || true)

  DEST="$HOME/Applications/$APP_NAME.app"
  DEST_SYS="/Applications/$APP_NAME.app"

  if [[ -n "$DMG" ]]; then
    info "Mounting $DMG ..."
    MOUNT=$(hdiutil attach "$DMG" -nobrowse -quiet | awk 'END{print $NF}')
    APP_IN_DMG=$(ls -d "$MOUNT"/*.app 2>/dev/null | head -1)
    [[ -z "$APP_IN_DMG" ]] && die "No .app found inside DMG"

    # Try /Applications first, fall back to ~/Applications
    if [[ -w "/Applications" ]]; then
      info "Copying to /Applications ..."
      cp -r "$APP_IN_DMG" "$DEST_SYS"
      INSTALLED="$DEST_SYS"
    else
      mkdir -p "$HOME/Applications"
      info "Copying to ~/Applications ..."
      cp -r "$APP_IN_DMG" "$DEST"
      INSTALLED="$DEST"
    fi
    hdiutil detach "$MOUNT" -quiet

  elif [[ -n "$ZIP" ]]; then
    info "Extracting $ZIP ..."
    TMP=$(mktemp -d)
    unzip -q "$ZIP" -d "$TMP"
    APP=$(ls -d "$TMP"/*.app 2>/dev/null | head -1)
    [[ -z "$APP" ]] && die "No .app found inside zip"
    mkdir -p "$HOME/Applications"
    cp -r "$APP" "$DEST"
    rm -rf "$TMP"
    INSTALLED="$DEST"

  elif [[ -n "$APP" ]]; then
    mkdir -p "$HOME/Applications"
    cp -r "$APP" "$DEST"
    INSTALLED="$DEST"

  else
    die "No .dmg, .zip, or .app found next to this script.\nPlace the release file in: $SCRIPT_DIR"
  fi

  # Remove quarantine flag so macOS doesn't block launch
  xattr -rd com.apple.quarantine "$INSTALLED" 2>/dev/null || true

  success "Installed to $INSTALLED"
  info "Launching $APP_NAME ..."
  open "$INSTALLED"
}

# ══════════════════════════════════════════════════════════════════════════════
# Linux
# ══════════════════════════════════════════════════════════════════════════════
install_linux() {
  info "Detected Linux"

  # ── Install system dependencies ──────────────────────────────────────────
  install_deps_linux() {
    # Packages required by Electron on Linux
    APT_PKGS="libgtk-3-0 libnss3 libxss1 libasound2 libatk-bridge2.0-0 libdrm2 libgbm1 libxkbcommon0"
    DNF_PKGS="gtk3 nss libXScrnSaver alsa-lib at-spi2-atk libdrm mesa-libgbm libxkbcommon"
    PACMAN_PKGS="gtk3 nss libxss alsa-lib at-spi2-atk libdrm mesa libxkbcommon"
    ZYPPER_PKGS="libgtk-3-0 mozilla-nss libXss1 alsa at-spi2-atk libdrm2 Mesa-libgbm1 libxkbcommon0"

    if command -v apt-get &>/dev/null; then
      info "Installing dependencies via apt ..."
      sudo apt-get install -y $APT_PKGS 2>/dev/null || warn "Some packages may already be installed"
    elif command -v dnf &>/dev/null; then
      info "Installing dependencies via dnf ..."
      sudo dnf install -y $DNF_PKGS 2>/dev/null || warn "Some packages may already be installed"
    elif command -v pacman &>/dev/null; then
      info "Installing dependencies via pacman ..."
      sudo pacman -S --needed --noconfirm $PACMAN_PKGS 2>/dev/null || warn "Some packages may already be installed"
    elif command -v zypper &>/dev/null; then
      info "Installing dependencies via zypper ..."
      sudo zypper install -y $ZYPPER_PKGS 2>/dev/null || warn "Some packages may already be installed"
    else
      warn "Unknown package manager — skipping dependency install."
      warn "If the app fails to launch, install Electron dependencies for your distro."
    fi
  }

  install_deps_linux

  # ── Extract / locate app ─────────────────────────────────────────────────
  INSTALL_DIR="$HOME/.local/share/$APP_ID"
  RELEASE=$(find_release)

  if [[ -z "$RELEASE" ]]; then
    die "No release archive found next to this script.\nExpected: linux-unpacked/ directory or $APP_ID-*-x64.tar.gz"
  fi

  if [[ -f "$RELEASE" ]]; then
    info "Extracting $RELEASE ..."
    mkdir -p "$INSTALL_DIR"
    tar -xzf "$RELEASE" --strip-components=1 -C "$INSTALL_DIR"
  else
    info "Copying app from $RELEASE ..."
    mkdir -p "$(dirname "$INSTALL_DIR")"
    cp -r "$RELEASE" "$INSTALL_DIR"
  fi

  chmod +x "$INSTALL_DIR/$APP_ID"

  # ── Icon ─────────────────────────────────────────────────────────────────
  ICON_DIR="$HOME/.local/share/icons/hicolor/256x256/apps"
  mkdir -p "$ICON_DIR"
  ICON_SRC="$INSTALL_DIR/resources/app/assets/icon.png"
  # Fallback: icon may be alongside the script
  [[ ! -f "$ICON_SRC" ]] && ICON_SRC="$SCRIPT_DIR/icon.png"

  if [[ -f "$ICON_SRC" ]]; then
    cp "$ICON_SRC" "$ICON_DIR/$APP_ID.png"
    success "Icon installed"
  elif command -v curl &>/dev/null; then
    curl -fsSL "$ICON_URL" -o "$ICON_DIR/$APP_ID.png" 2>/dev/null && success "Icon downloaded" || warn "Could not download icon"
  fi

  # ── .desktop file ────────────────────────────────────────────────────────
  APPS_DIR="$HOME/.local/share/applications"
  mkdir -p "$APPS_DIR"
  cat > "$APPS_DIR/$APP_ID.desktop" <<DESKTOP
[Desktop Entry]
Name=$APP_NAME
Exec=$INSTALL_DIR/$APP_ID %u
Icon=$APP_ID
StartupWMClass=$APP_ID
StartupNotify=false
Terminal=false
Type=Application
Categories=Development;
MimeType=x-scheme-handler/flowscaleaios;
DESKTOP

  command -v update-desktop-database &>/dev/null && update-desktop-database "$APPS_DIR" 2>/dev/null || true
  command -v xdg-mime &>/dev/null && xdg-mime default "$APP_ID.desktop" x-scheme-handler/flowscaleaios 2>/dev/null || true

  success "Installed to $INSTALL_DIR"
  success "Desktop entry created — $APP_NAME will appear in your app launcher"

  # ── Launch ───────────────────────────────────────────────────────────────
  info "Launching $APP_NAME ..."
  nohup "$INSTALL_DIR/$APP_ID" &>/dev/null &
  disown
}

# ══════════════════════════════════════════════════════════════════════════════
# Entry point
# ══════════════════════════════════════════════════════════════════════════════
echo ""
echo -e "${BOLD}FlowScale AI OS — Setup${RESET}"
echo "─────────────────────────────────"
echo ""

case "$(uname -s)" in
  Linux)  install_linux ;;
  Darwin) install_mac   ;;
  *)      die "Unsupported OS: $(uname -s)" ;;
esac

echo ""
success "Done."
