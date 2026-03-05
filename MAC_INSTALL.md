# Installing FlowScale AI OS on macOS

## Building the release files

You need [Node.js 22+](https://nodejs.org) and [pnpm](https://pnpm.io) installed.

```bash
# 1. Clone the repo
git clone https://github.com/flowscale/flowscale-eios.git
cd flowscale-eios

# 2. Install dependencies
pnpm install

# 3. Build the Next.js web app
pnpm --filter @flowscale/aios-web build

# 4. Package the Electron app for macOS
pnpm --filter @flowscale/aios-desktop run package:mac
```

This produces the DMG at `apps/desktop/release/FlowScale AI OS.dmg`.

You now have the `.dmg` and `install.sh` — place them in the same folder and follow the steps below.

## Requirements

- macOS 11 (Big Sur) or later
- Intel (x64) or Apple Silicon (arm64)

## Option A — Installer script (recommended)

1. Download `FlowScale AI OS.dmg` and `install.sh` to the same folder
2. Open **Terminal**, navigate to that folder, and run:

```bash
chmod +x install.sh
./install.sh
```

The installer will:
- Copy the app to `~/Applications/`
- Remove the macOS quarantine flag so it opens without a security warning
- Launch the app

## Option B — Manual install

1. Open `FlowScale AI OS.dmg`
2. Drag **FlowScale AI OS** into your **Applications** folder
3. Launch it from Applications or Spotlight

If macOS shows a security warning on first launch:
- Go to **System Settings → Privacy & Security**
- Scroll down and click **Open Anyway** next to FlowScale AI OS

## Uninstalling

Drag **FlowScale AI OS** from Applications to Trash, or run:

```bash
rm -rf ~/Applications/FlowScale\ AI\ OS.app
# if installed to /Applications:
sudo rm -rf /Applications/FlowScale\ AI\ OS.app
```
