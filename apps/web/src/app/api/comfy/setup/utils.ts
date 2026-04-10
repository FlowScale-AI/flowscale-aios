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

/**
 * If the user points to a macOS .app bundle, resolve to the nested ComfyUI dir.
 * Also handles common mistakes like selecting the parent folder of the actual install.
 */
export function resolveComfyPath(dirPath: string): string {
  if (!dirPath) return dirPath

  // Direct match — already valid
  if (isValidComfyInstall(dirPath)) return dirPath

  // macOS .app bundle: /Applications/ComfyUI.app → .../Contents/Resources/ComfyUI
  if (dirPath.endsWith('.app')) {
    const nested = path.join(dirPath, 'Contents', 'Resources', 'ComfyUI')
    if (isValidComfyInstall(nested)) return nested
  }

  // User selected parent dir that contains a ComfyUI subfolder
  const comfySub = path.join(dirPath, 'ComfyUI')
  if (isValidComfyInstall(comfySub)) return comfySub

  return dirPath
}
