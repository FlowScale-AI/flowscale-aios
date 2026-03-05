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
const EIOS_PORT = 14173

// Set app name — on Wayland this becomes the window's app_id, which KDE uses to match .desktop files
app.setName('flowscale-aios')
if (process.platform === 'linux') {
  app.commandLine.appendSwitch('class', 'flowscale-aios')
}

// Register OAuth protocol handler before single-instance lock (Windows/Linux)
if (process.platform !== 'darwin') {
  if (isDev) {
    app.setAsDefaultProtocolClient('flowscaleeios', process.execPath, [__filename])

    if (process.platform === 'linux') {
      try {
        // Install app icon to hicolor theme so KDE picks it up
        const iconsDir = path.join(app.getPath('home'), '.local/share/icons/hicolor/256x256/apps')
        if (!existsSync(iconsDir)) mkdirSync(iconsDir, { recursive: true })
        const iconSrc = path.join(__dirname, '..', 'assets', 'icon.png')
        const iconDest = path.join(iconsDir, 'flowscale-aios.png')
        if (existsSync(iconSrc)) copyFileSync(iconSrc, iconDest)

        const appsDir = path.join(app.getPath('home'), '.local/share/applications')
        if (!existsSync(appsDir)) mkdirSync(appsDir, { recursive: true })
        const desktopFile = path.join(appsDir, 'flowscale-aios.desktop')
        const content = [
          '[Desktop Entry]',
          'Name=FlowScale AI OS',
          `Exec=${process.execPath} ${__filename} %u`,
          'Icon=flowscale-aios',
          'StartupWMClass=flowscale-aios',
          'StartupNotify=false',
          'Terminal=false',
          'Type=Application',
          'Categories=Development;',
          'MimeType=x-scheme-handler/flowscaleeios;',
          '',
        ].join('\n')
        writeFileSync(desktopFile, content, 'utf-8')
        execSync(`update-desktop-database ${appsDir}`)
        execSync(`xdg-mime default flowscale-aios.desktop x-scheme-handler/flowscaleeios`)
      } catch (err) {
        log.warn('[protocol] Failed to register Linux protocol handler:', err)
      }
    }
  } else {
    app.setAsDefaultProtocolClient('flowscaleeios')
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
  if (url.startsWith('flowscaleeios://oauth/cb')) {
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

function startNextServer(): void {
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

  log.info('[server] Starting Next.js standalone server:', serverScript)

  // ELECTRON_RUN_AS_NODE=1 makes the Electron binary behave as plain Node.js
  nextServer = spawn(process.execPath, [serverScript], {
    env: { ...process.env, PORT: String(EIOS_PORT), HOSTNAME: '127.0.0.1', ELECTRON_RUN_AS_NODE: '1' },
    stdio: 'pipe',
  })

  nextServer.stdout?.on('data', (data: Buffer) => log.info('[next]', data.toString().trim()))
  nextServer.stderr?.on('data', (data: Buffer) => log.warn('[next]', data.toString().trim()))

  nextServer.on('exit', (code) => {
    log.warn('[server] Next.js server exited with code', code)
  })
}

function createWindow(): BrowserWindow {
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

  const url = `http://127.0.0.1:${EIOS_PORT}`

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
    app.setAsDefaultProtocolClient('flowscaleeios')
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

  if (!isDev) {
    startNextServer()
  }

  mainWindow = createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      mainWindow = createWindow()
    }
  })
})

app.on('second-instance', (_event, argv) => {
  const protocolUrl = argv.find((arg) => arg.startsWith('flowscaleeios://'))
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
