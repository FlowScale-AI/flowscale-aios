import fs from 'fs'
import path from 'path'

/** A path is a valid ComfyUI installation if it contains main.py and pyproject.toml. */
export function isValidComfyInstall(dirPath: string): boolean {
  if (!dirPath || !fs.existsSync(dirPath)) return false
  return (
    fs.existsSync(path.join(dirPath, 'main.py')) &&
    fs.existsSync(path.join(dirPath, 'pyproject.toml'))
  )
}
