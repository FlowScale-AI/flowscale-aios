import { ipcMain, dialog, shell } from 'electron'
import { readFileSync } from 'fs'

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

  ipcMain.handle('shell:openExternal', async (_event, url: string) => {
    await shell.openExternal(url)
  })
}
