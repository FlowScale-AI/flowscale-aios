import { app, ipcMain, BrowserWindow } from 'electron'
import { autoUpdater } from 'electron-updater'
import log from 'electron-log'
import https from 'https'

autoUpdater.logger = log
autoUpdater.autoDownload = false

const isDev = !app.isPackaged
const isMac = process.platform === 'darwin'
const MAC_YML_URL = 'https://flowscale-aios.s3.us-east-1.amazonaws.com/latest-mac.yml'

function getWin(): BrowserWindow | undefined {
  return BrowserWindow.getAllWindows()[0]
}

function sendError(message: string): void {
  log.error('[updater]', message)
  getWin()?.webContents.send('updates:error', { message })
}

function fetchText(url: string): Promise<string> {
  return new Promise((resolve, reject) => {
    https.get(url, (res) => {
      let data = ''
      res.on('data', (chunk) => { data += chunk })
      res.on('end', () => resolve(data))
    }).on('error', reject)
  })
}

function parseYmlVersion(text: string): string | null {
  const match = text.match(/^version:\s*(.+)$/m)
  return match ? match[1].trim() : null
}

function compareVersions(a: string, b: string): number {
  const pa = a.split('.').map(Number)
  const pb = b.split('.').map(Number)
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const diff = (pa[i] ?? 0) - (pb[i] ?? 0)
    if (diff !== 0) return diff
  }
  return 0
}

export function registerUpdaterIpc(): void {
  if (!isMac) {
    autoUpdater.on('update-available', (info) => {
      log.info('[updater] Update available:', info.version)
      getWin()?.webContents.send('updates:available', { version: info.version })
    })

    autoUpdater.on('update-not-available', () => {
      log.info('[updater] Up to date.')
      getWin()?.webContents.send('updates:not-available')
    })

    autoUpdater.on('download-progress', ({ percent }) => {
      getWin()?.webContents.send('updates:progress', { percent: Math.round(percent) })
    })

    autoUpdater.on('update-downloaded', (info) => {
      log.info('[updater] Update downloaded:', info.version)
      getWin()?.webContents.send('updates:downloaded', { version: info.version })
    })

    autoUpdater.on('error', (err) => {
      sendError(err.message)
    })

    ipcMain.handle('updates:download', async () => {
      try {
        await autoUpdater.downloadUpdate()
      } catch (err) {
        sendError(err instanceof Error ? err.message : String(err))
      }
    })

    ipcMain.handle('updates:install', () => autoUpdater.quitAndInstall())
  }

  ipcMain.handle('updates:check', async () => {
    if (isDev) {
      sendError('Updates are not available in dev mode.')
      return
    }
    if (isMac) {
      try {
        const text = await fetchText(MAC_YML_URL)
        const latestVersion = parseYmlVersion(text)
        if (!latestVersion) throw new Error('Could not parse version from update manifest.')
        const currentVersion = app.getVersion()
        log.info(`[updater] Mac check: current=${currentVersion}, latest=${latestVersion}`)
        if (compareVersions(latestVersion, currentVersion) > 0) {
          getWin()?.webContents.send('updates:available', { version: latestVersion })
        } else {
          getWin()?.webContents.send('updates:not-available')
        }
      } catch (err) {
        sendError(err instanceof Error ? err.message : String(err))
      }
    } else {
      try {
        await autoUpdater.checkForUpdates()
      } catch (err) {
        sendError(err instanceof Error ? err.message : String(err))
      }
    }
  })
}
