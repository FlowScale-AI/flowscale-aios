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
