import { app, ipcMain, BrowserWindow } from 'electron'
import { autoUpdater } from 'electron-updater'
import log from 'electron-log'

autoUpdater.logger = log
autoUpdater.autoDownload = false

const isDev = !app.isPackaged

function getWin(): BrowserWindow | undefined {
  return BrowserWindow.getAllWindows()[0]
}

function sendError(message: string): void {
  log.error('[updater]', message)
  getWin()?.webContents.send('updates:error', { message })
}

export function registerUpdaterIpc(): void {
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

  ipcMain.handle('updates:check', async () => {
    if (isDev) {
      sendError('Updates are not available in dev mode.')
      return
    }
    try {
      await autoUpdater.checkForUpdates()
    } catch (err) {
      sendError(err instanceof Error ? err.message : String(err))
    }
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
