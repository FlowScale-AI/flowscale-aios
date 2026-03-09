# Installing FlowScale AI OS on Linux

## Building the release files

You need [Node.js 22+](https://nodejs.org) and [pnpm](https://pnpm.io) installed.

```bash
# 1. Clone the repo
git clone https://github.com/FlowScale-AI/flowscale-aios.git
cd flowscale-aios

# 2. Install dependencies
pnpm install

# 3. Build the Next.js web app
pnpm --filter @flowscale/aios-web build

# 4. Package the Electron app for Linux
pnpm --filter @flowscale/aios-desktop run package:linux
```

This produces the app directory at `apps/desktop/release/linux-unpacked/`. Bundle it into a tarball:

```bash
tar -czf flowscale-aios-linux-x64.tar.gz -C apps/desktop/release linux-unpacked
```

You now have `flowscale-aios-linux-x64.tar.gz` and `install.sh` — place them in the same folder and follow the steps below.

## Requirements

- x64 Linux (Ubuntu 20.04+, Fedora 36+, Arch, or any distro with a modern glibc)
- `bash`, `tar`, `sudo` access for system libraries

## Installation

1. Download `flowscale-aios-linux-x64.tar.gz` and `install.sh` to the same folder
2. Open a terminal in that folder and run:

```bash
chmod +x install.sh
./install.sh
```

The installer will:
- Install required system libraries using your package manager (apt / dnf / pacman / zypper)
- Extract the app to `~/.local/share/flowscale-aios/`
- Add FlowScale AI OS to your application launcher
- Launch the app

## Launching after install

Find **FlowScale AI OS** in your application launcher (e.g. KDE app menu, GNOME Activities), or run:

```bash
~/.local/share/flowscale-aios/flowscale-aios
```

## Uninstalling

```bash
rm -rf ~/.local/share/flowscale-aios
rm ~/.local/share/applications/flowscale-aios.desktop
rm ~/.local/share/icons/hicolor/256x256/apps/flowscale-aios.png
```
