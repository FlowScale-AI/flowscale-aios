import { app, BrowserWindow, Menu, nativeImage, session, shell } from 'electron'
import path from 'path'
import { spawn, type ChildProcess } from 'child_process'
import { writeFileSync, copyFileSync, mkdirSync, existsSync } from 'fs'
import { execSync } from 'child_process'
import log from 'electron-log'
import { registerAuthIpc, handleOAuthCallback } from './ipc/auth.js'
import { registerDialogIpc } from './ipc/dialog.js'
import type { FlowscaleTokens } from './config/store.js'

log.initialize()

const isDev = !app.isPackaged
const AIOS_PORT_START = 14173

/** Try ports starting at `start` until one is free, then return it. */
function findAvailablePort(start: number): Promise<number> {
  return new Promise((resolve) => {
    const net = require('net') as typeof import('net')
    const tryPort = (port: number): void => {
      const server = net.createServer()
      server.once('error', () => tryPort(port + 1))
      server.once('listening', () => server.close(() => resolve(port)))
      server.listen(port, '127.0.0.1')
    }
    tryPort(start)
  })
}

// Set app name and desktop file name so KDE Wayland matches the window to flowscale-aios.desktop
app.setName('flowscale-aios')
if (process.platform === 'linux') {
  app.commandLine.appendSwitch('class', 'flowscale-aios')
  // Tells Wayland compositors (KDE/GNOME) which .desktop file owns this window → correct icon
  ;(app as any).setDesktopName('flowscale-aios.desktop')
}

// Register OAuth protocol handler before single-instance lock (Windows/Linux)
if (process.platform !== 'darwin') {
  if (isDev) {
    app.setAsDefaultProtocolClient('flowscaleaios', process.execPath, [__filename])
  } else {
    app.setAsDefaultProtocolClient('flowscaleaios')
  }

  if (process.platform === 'linux') {
    // Install icon + .desktop file on every launch (dev and production) so the
    // taskbar icon is always up to date regardless of how the app was launched.
    try {
      // Write icon — use nativeImage so this works whether assets are on disk or in an asar
      const iconsDir = path.join(app.getPath('home'), '.local/share/icons/hicolor/256x256/apps')
      if (!existsSync(iconsDir)) mkdirSync(iconsDir, { recursive: true })
      const iconSrc = path.join(__dirname, '..', 'assets', 'icon.png')
      const iconDest = path.join(iconsDir, 'flowscale-aios.png')
      const img = nativeImage.createFromPath(iconSrc)
      if (!img.isEmpty()) writeFileSync(iconDest, img.toPNG())

      // Write .desktop file pointing to this binary
      const appsDir = path.join(app.getPath('home'), '.local/share/applications')
      if (!existsSync(appsDir)) mkdirSync(appsDir, { recursive: true })
      const desktopFile = path.join(appsDir, 'flowscale-aios.desktop')
      const execLine = isDev
        ? `Exec=${process.execPath} ${__filename} %u`
        : `Exec=${process.execPath} %u`
      const content = [
        '[Desktop Entry]',
        'Name=FlowScale AI OS',
        execLine,
        'Icon=flowscale-aios',
        'StartupWMClass=flowscale-aios',
        'StartupNotify=false',
        'Terminal=false',
        'Type=Application',
        'Categories=Development;',
        'MimeType=x-scheme-handler/flowscaleaios;',
        '',
      ].join('\n')
      writeFileSync(desktopFile, content, 'utf-8')
      execSync(`update-desktop-database ${appsDir}`)
      execSync(`xdg-mime default flowscale-aios.desktop x-scheme-handler/flowscaleaios`)
    } catch (err) {
      log.warn('[linux] Failed to register icon/.desktop:', err)
    }
  }
}

// Single instance lock
const gotLock = app.requestSingleInstanceLock()
if (!gotLock) {
  app.quit()
  process.exit(0)
}

let mainWindow: BrowserWindow | null = null
let nextServer: ChildProcess | null = null

function notifyOAuthComplete(tokens: FlowscaleTokens): void {
  mainWindow?.webContents.send('auth:complete', tokens)
}

// macOS: protocol URL arrives here when app is already running
app.on('open-url', (event, url) => {
  event.preventDefault()
  if (url.startsWith('flowscaleaios://oauth/cb')) {
    handleOAuthCallback(url, notifyOAuthComplete)
  }
})

/** Poll until the Next.js server is reachable, then resolve. */
function waitForServer(url: string, timeoutMs = 30_000): Promise<void> {
  return new Promise((resolve, reject) => {
    const start = Date.now()
    const http = require('http') as typeof import('http')
    const check = (): void => {
      const req = http.get(url, (res) => {
        res.resume()
        resolve()
      })
      req.on('error', () => {
        if (Date.now() - start > timeoutMs) {
          reject(new Error(`Server at ${url} not ready after ${timeoutMs}ms`))
        } else {
          setTimeout(check, 500)
        }
      })
      req.end()
    }
    check()
  })
}

/** Locate the system `node` binary. Returns null if not found. */
function findSystemNode(): string | null {
  const candidates =
    process.platform === 'darwin'
      ? ['/opt/homebrew/bin/node', '/usr/local/bin/node']
      : ['/usr/bin/node', '/usr/local/bin/node']

  // Also try the user's PATH (GUI apps on macOS get a minimal PATH, so
  // we check common locations first then fall back to a shell lookup)
  for (const p of candidates) {
    try {
      if (existsSync(p)) return p
    } catch { /* skip */ }
  }

  // Shell lookup as last resort
  try {
    return execSync('which node', { encoding: 'utf-8' }).trim() || null
  } catch {
    return null
  }
}

function startNextServer(port: number): void {
  // In production: spawn the standalone Next.js server built into the app
  const serverScript = path.join(
    process.resourcesPath,
    'apps',
    'web',
    '.next',
    'standalone',
    'apps',
    'web',
    'server.js',
  )

  // Prefer system `node` over the Electron binary:
  //  - avoids a spurious Dock icon on macOS (Electron binary = GUI app)
  //  - avoids ABI mismatch for native modules (better-sqlite3)
  const systemNode = findSystemNode()
  const useSystemNode = !!systemNode

  const nodeBin = systemNode ?? process.execPath
  const env: Record<string, string> = {
    ...process.env as Record<string, string>,
    PORT: String(port),
    HOSTNAME: '127.0.0.1',
  }
  if (!useSystemNode) {
    // Fallback: make the Electron binary behave as plain Node.js
    env.ELECTRON_RUN_AS_NODE = '1'
  }

  log.info('[server] Starting Next.js standalone server:', serverScript, 'on port', port, '(node:', nodeBin, ')')

  nextServer = spawn(nodeBin, [serverScript], { env, stdio: 'pipe' })

  nextServer.stdout?.on('data', (data: Buffer) => log.info('[next]', data.toString().trim()))
  nextServer.stderr?.on('data', (data: Buffer) => log.warn('[next]', data.toString().trim()))

  nextServer.on('exit', (code) => {
    log.warn('[server] Next.js server exited with code', code)
  })
}

function createWindow(port: number): BrowserWindow {
  const win = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 900,
    minHeight: 600,
    title: 'FlowScale AI OS',
    icon: nativeImage.createFromPath(path.join(__dirname, '..', 'assets', 'icon.png')),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  })

  const url = `http://127.0.0.1:${port}`

  if (isDev) {
    waitForServer(url)
      .then(() => win.loadURL(url))
      .catch((err) => {
        log.error('[window] Dev server not ready:', err)
        win.loadURL(url)
      })
  } else {
    waitForServer(url, 60_000)
      .then(() => win.loadURL(url))
      .catch(() => win.loadURL(url))
  }

  // Open external URLs (window.open / <a target="_blank">) in the system browser
  win.webContents.setWindowOpenHandler(({ url: targetUrl }) => {
    shell.openExternal(targetUrl)
    return { action: 'deny' }
  })

  win.on('closed', () => { mainWindow = null })

  return win
}

app.whenReady().then(async () => {
  Menu.setApplicationMenu(null)

  registerAuthIpc()
  registerDialogIpc()

  // macOS: register protocol after ready
  if (process.platform === 'darwin') {
    app.setAsDefaultProtocolClient('flowscaleaios')
  }

  // Inject CORS headers for localhost so the renderer can talk to ComfyUI directly if ever needed
  session.defaultSession.webRequest.onHeadersReceived(
    { urls: ['http://localhost:*/*', 'http://127.0.0.1:*/*'] },
    (details, callback) => {
      const headers = details.responseHeaders ?? {}
      headers['Access-Control-Allow-Origin'] = ['*']
      headers['Access-Control-Allow-Methods'] = ['GET, POST, PUT, DELETE, OPTIONS']
      headers['Access-Control-Allow-Headers'] = ['Content-Type, Authorization']
      callback({ responseHeaders: headers })
    },
  )

  const port = isDev ? AIOS_PORT_START : await findAvailablePort(AIOS_PORT_START)

  if (!isDev) {
    startNextServer(port)
  }

  mainWindow = createWindow(port)

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      mainWindow = createWindow(port)
    }
  })
})

app.on('second-instance', (_event, argv) => {
  const protocolUrl = argv.find((arg) => arg.startsWith('flowscaleaios://'))
  if (protocolUrl) {
    handleOAuthCallback(protocolUrl, notifyOAuthComplete)
  }
  if (mainWindow) {
    if (mainWindow.isMinimized()) mainWindow.restore()
    mainWindow.focus()
  }
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

app.on('before-quit', () => {
  if (nextServer) {
    nextServer.kill()
    nextServer = null
  }
})
