import { ipcMain, app } from 'electron'
import { readFileSync } from 'fs'
import path from 'path'
import os from 'os'

const LOG_TAIL_LINES = 5000

function getRecentLogs(): string {
  try {
    const logFile = path.join(app.getPath('logs'), 'main.log')
    const content = readFileSync(logFile, 'utf-8')
    const lines = content.split('\n')
    return lines.slice(-LOG_TAIL_LINES).join('\n').trim()
  } catch {
    return '(no logs available)'
  }
}

export function registerReportIpc(): void {
  ipcMain.handle('report:getSystemInfo', () => ({
    version: app.getVersion(),
    platform: `${process.platform} ${os.release()} (${os.arch()})`,
    logs: getRecentLogs(),
  }))
}
