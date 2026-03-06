# Contributing to FlowScale AIOS

Thank you for your interest in contributing! This document covers how to get started, submit changes, and work within the project conventions.

## Table of Contents

- [Getting Started](#getting-started)
- [Development Setup](#development-setup)
- [Project Structure](#project-structure)
- [Making Changes](#making-changes)
- [Submitting a Pull Request](#submitting-a-pull-request)
- [Reporting Issues](#reporting-issues)
- [Code Style](#code-style)

---

## Getting Started

1. Fork the repository and clone your fork.
2. Install dependencies with `pnpm install` (requires Node >= 20 and pnpm >= 9).
3. Start the web app: `pnpm --filter @flowscale/aios-web dev` (runs on port 14173).

> ComfyUI must be running locally for most features to work. The app auto-scans ports 6188–16188.

---

## Development Setup

```bash
# Install dependencies
pnpm install

# Start web dev server (port 14173)
pnpm --filter @flowscale/aios-web dev

# Typecheck all packages
pnpm typecheck

# Run tests
pnpm test

# Build everything
pnpm build
```

For the Electron desktop app, build the web app first, then:

```bash
pnpm --filter @flowscale/aios-desktop build
apps/desktop/node_modules/.bin/electron apps/desktop/dist/main.js
```

---

## Project Structure

| Path | Purpose |
|------|---------|
| `apps/web` | Next.js 15 App Router — all UI and API routes |
| `apps/desktop` | Electron 39 shell that loads the web app |
| `packages/workflow` | Zero-dependency ComfyUI workflow analysis library |

---

## Making Changes

- Keep changes focused — one logical change per PR.
- Always run `pnpm typecheck` before opening a PR.
- Add or update tests for any logic you change in `packages/workflow` or API routes.
- Follow the existing file and import conventions (see `CLAUDE.md` for architecture notes).
- Do not commit build artifacts, `.next/`, or `dist/` directories.
- Do not commit `.env` files or credentials.

---

## Submitting a Pull Request

1. Create a branch from `dev` (not `main`): `git checkout -b feat/my-feature dev`
2. Make your changes and commit with a clear message.
3. Push and open a PR against the `dev` branch.
4. Fill out the PR template — describe what changed and why.
5. A maintainer will review and provide feedback.

PRs targeting `main` directly will not be merged without prior discussion.

---

## Reporting Issues

Use the GitHub issue templates:

- **Bug report** — unexpected behavior, crashes, or errors.
- **Feature request** — new capabilities or improvements.

Before opening an issue, search existing issues to avoid duplicates.

---

## Code Style

- TypeScript strict mode is enabled — avoid `any`.
- Use named exports; avoid default exports for components where possible.
- Import UI primitives from `@/components/ui` (the barrel), not from shadcn paths directly.
- Tailwind for styling; avoid inline `style` props unless necessary.
- Keep API routes thin — move logic into lib utilities.

---

## License

By contributing, you agree that your contributions will be licensed under the [GNU Affero General Public License v3.0](LICENSE).
