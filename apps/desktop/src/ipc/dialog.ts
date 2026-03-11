import { ipcMain, dialog, shell, BrowserWindow } from 'electron'
import { readFileSync, watch as fsWatch } from 'fs'
import type { FSWatcher } from 'fs'

const watchers = new Map<string, FSWatcher>()

function debounce(fn: () => void, ms: number): () => void {
  let timer: ReturnType<typeof setTimeout>
  return () => {
    clearTimeout(timer)
    timer = setTimeout(fn, ms)
  }
}

export function registerDialogIpc(): void {
  ipcMain.handle('dialog:openFile', async () => {
    const result = await dialog.showOpenDialog({
      properties: ['openFile'],
      filters: [
        { name: 'Workflow JSON', extensions: ['json'] },
        { name: 'All Files', extensions: ['*'] },
      ],
    })

    if (result.canceled || result.filePaths.length === 0) {
      return null
    }

    const filePath = result.filePaths[0]
    try {
      return readFileSync(filePath, 'utf-8')
    } catch (err) {
      console.error('[dialog] Failed to read file:', err)
      return null
    }
  })

  ipcMain.handle('dialog:openDirectory', async () => {
    const result = await dialog.showOpenDialog({ properties: ['openDirectory'] })
    if (result.canceled || result.filePaths.length === 0) return null
    return result.filePaths[0]
  })

  ipcMain.handle('shell:openExternal', async (_event, url: string) => {
    await shell.openExternal(url)
  })

  ipcMain.handle('watch:start', (_event, watchPath: string) => {
    if (watchers.has(watchPath)) return

    const win = BrowserWindow.getFocusedWindow()
    const notify = debounce(() => {
      win?.webContents.send('app-dir-changed', watchPath)
    }, 500)

    const watcher = fsWatch(watchPath, { recursive: true }, notify)
    watchers.set(watchPath, watcher)
  })

  ipcMain.handle('watch:stop', (_event, watchPath: string) => {
    const watcher = watchers.get(watchPath)
    if (watcher) {
      watcher.close()
      watchers.delete(watchPath)
    }
  })
}
