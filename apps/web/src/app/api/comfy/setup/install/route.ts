/**
 * POST /api/comfy/setup/install
 *
 * Body (optional): { targetPath?: string }
 *
 * - If `targetPath` is provided and already contains main.py + pyproject.toml,
 *   we skip clone/venv/pip and just persist the path.  This handles the
 *   macOS/Windows ComfyUI Desktop App whose bundled install is ready to use.
 * - Otherwise clones ComfyUI from GitHub into ~/.flowscale/comfyui, creates a
 *   venv, and installs requirements.
 *
 * Streams progress as SSE (text/event-stream).
 * Each event is JSON: { msg?: string; done?: boolean; error?: string; path?: string }
 */

import { NextResponse } from 'next/server'
import { spawn } from 'child_process'
import fs from 'fs'
import path from 'path'
import os from 'os'
import { setComfyManagedPath, setComfyInstallType } from '@/lib/providerSettings'
import { isValidComfyInstall } from '../utils'

const FLOWSCALE_COMFY_PATH = path.join(os.homedir(), '.flowscale', 'comfyui')
const COMFYUI_REPO = 'https://github.com/comfyanonymous/ComfyUI.git'

function runStreamed(
  cmd: string,
  args: string[],
  cwd: string,
  onLine: (line: string) => void,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { cwd, stdio: 'pipe', env: { ...process.env } })

    const onData = (buf: Buffer): void => {
      buf.toString().split('\n').filter(Boolean).forEach(onLine)
    }
    child.stdout?.on('data', onData)
    child.stderr?.on('data', onData)

    child.on('exit', (code) => {
      if (code === 0) resolve()
      else reject(new Error(`"${cmd} ${args.join(' ')}" exited with code ${code}`))
    })
    child.on('error', reject)
  })
}

export async function POST(req: Request) {
  const body = await req.json().catch(() => ({})) as { targetPath?: string }
  const encoder = new TextEncoder()

  const stream = new ReadableStream({
    async start(controller) {
      const send = (payload: Record<string, unknown>): void => {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(payload)}\n\n`))
      }

      try {
        const targetPath = body.targetPath ?? FLOWSCALE_COMFY_PATH

        // ── Fast path: existing valid ComfyUI installation ─────────────────────
        if (isValidComfyInstall(targetPath)) {
          send({ msg: `Found existing ComfyUI installation at ${targetPath} — skipping clone and setup.` })
          setComfyManagedPath(targetPath)
          setComfyInstallType(targetPath === FLOWSCALE_COMFY_PATH ? 'flowscale-managed' : 'desktop-app')
          send({ msg: 'ComfyUI ready.', done: true, path: targetPath })
          return
        }

        // ── Full install: clone → venv → pip ───────────────────────────────────
        const installPath = FLOWSCALE_COMFY_PATH   // always install into .flowscale

        // Step 1: Clone
        if (fs.existsSync(installPath) && isValidComfyInstall(installPath)) {
          send({ msg: `Directory already exists at ${installPath} — skipping clone.` })
        } else {
          send({ msg: 'Cloning ComfyUI from GitHub…' })
          fs.mkdirSync(path.dirname(installPath), { recursive: true })
          await runStreamed(
            'git',
            ['clone', '--depth', '1', COMFYUI_REPO, installPath],
            os.homedir(),
            (line) => send({ msg: line }),
          )
          send({ msg: 'Clone complete.' })
        }

        // Step 2: Create venv
        const venvPath = path.join(installPath, 'venv')
        if (fs.existsSync(venvPath)) {
          send({ msg: 'Virtual environment already exists — skipping.' })
        } else {
          send({ msg: 'Creating Python virtual environment…' })
          const pythonBin = process.platform === 'win32' ? 'python' : 'python3'
          await runStreamed(
            pythonBin,
            ['-m', 'venv', venvPath],
            installPath,
            (line) => send({ msg: line }),
          )
          send({ msg: 'Virtual environment created.' })
        }

        // Step 3: Install requirements
        const pipBin = process.platform === 'win32'
          ? path.join(venvPath, 'Scripts', 'pip.exe')
          : path.join(venvPath, 'bin', 'pip')

        send({ msg: 'Installing Python dependencies (this may take a few minutes)…' })
        await runStreamed(
          pipBin,
          ['install', '-r', path.join(installPath, 'requirements.txt')],
          installPath,
          (line) => send({ msg: line }),
        )
        send({ msg: 'Dependencies installed.' })

        setComfyManagedPath(installPath)
        setComfyInstallType('flowscale-managed')
        send({ msg: 'ComfyUI installation complete!', done: true, path: installPath })
      } catch (err) {
        send({ error: err instanceof Error ? err.message : String(err) })
      } finally {
        controller.close()
      }
    },
  })

  return new NextResponse(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    },
  })
}
