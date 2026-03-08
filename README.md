# FlowScale AIOS

An open-source platform to build, test, and deploy AI workflows powered by ComfyUI — available as a web app and native desktop app.

---

## Features

- **Workflow builder** — attach ComfyUI workflows and auto-configure inputs/outputs
- **Tool deployment** — promote workflows to production tools in one click
- **Canvas** — visual boards for composing and organizing tools
- **Multi-instance** — auto-discovers running ComfyUI instances on ports 6188–16188
- **Desktop + web** — Electron shell for macOS/Windows/Linux, or run as a Next.js web app

## Requirements

- Node.js >= 20
- pnpm >= 9
- [ComfyUI](https://github.com/comfyanonymous/ComfyUI) running locally

## Getting Started

```bash
# Clone the repo
git clone https://github.com/FlowScale-AI/flowscale-aios.git
cd flowscale-aios

# Install dependencies
pnpm install

# Start the web app (port 14173)
pnpm --filter @flowscale/aios-web dev
```

Open [http://localhost:14173](http://localhost:14173) in your browser.

### Desktop app

```bash
# Build first (web must be running)
pnpm --filter @flowscale/aios-desktop build
apps/desktop/node_modules/.bin/electron apps/desktop/dist/main.js
```

### Linux AppImage

Download the latest `FlowScale AI OS-x.x.x.AppImage` from the [Releases](https://github.com/FlowScale-AI/flowscale-aios/releases) page.

```bash
# Make it executable
chmod +x "FlowScale AI OS-*.AppImage"

# Run
./"FlowScale AI OS-*.AppImage"
```

**Requirements:**
- Linux x86_64
- glibc >= 2.34 (Ubuntu 22.04+, Fedora 36+, Debian 12+)
- FUSE2 — install if missing:
  ```bash
  # Ubuntu / Debian
  sudo apt install libfuse2

  # Fedora
  sudo dnf install fuse
  ```

**If FUSE is unavailable** (e.g. restricted environment), extract and run directly:
```bash
./"FlowScale AI OS-*.AppImage" --appimage-extract
./squashfs-root/AppRun
```

**ComfyUI** must be running on any port between 6188–16188 before launching the app. The app will auto-discover it.

## Building External Apps with the SDK

The `@flowscale/sdk` package lets you build apps that run **outside** FlowScale — Node.js scripts, Express servers, Next.js apps, or anything that can make HTTP requests.

See **[packages/sdk/README.md](packages/sdk/README.md)** for the full guide, including authentication, listing tools, running tools, handling image inputs, and complete working examples.

Quick start:

```bash
npm install @flowscale/sdk
```

```ts
import { login, createClient } from '@flowscale/sdk'

const token = await login({ baseUrl: 'http://localhost:14173', username: 'admin', password: 'your-password' })
const client = createClient({ baseUrl: 'http://localhost:14173', sessionToken: token })

const result = await client.tools.run('your-tool-id', {
  '6__text': 'a photorealistic cat on the moon',
})
console.log(result.outputs)
```

---

## Project Structure

```
flowscale-aios/
├── apps/
│   ├── web/          # Next.js 15 App Router — UI and API routes
│   └── desktop/      # Electron 39 shell
└── packages/
    └── workflow/     # ComfyUI workflow analysis library (zero deps)
```

## Development

```bash
pnpm typecheck      # Type-check all packages
pnpm test           # Run tests
pnpm build          # Build everything
```

See [CONTRIBUTING.md](CONTRIBUTING.md) for full development guide.

## Contributing

Contributions are welcome! Please read [CONTRIBUTING.md](CONTRIBUTING.md) before opening a PR.

## Security

To report a vulnerability, see [SECURITY.md](SECURITY.md).

## License

FlowScale AIOS is licensed under the [GNU Affero General Public License v3.0](LICENSE).
