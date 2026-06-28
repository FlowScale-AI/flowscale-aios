import fs from 'fs'
import path from 'path'
import os from 'os'

/** Expand `%VAR%` (Windows) and `$VAR` / `~` (Unix) tokens in a path string. */
function expandEnvVars(input: string): string {
  if (!input) return input
  let out = input
  // Tilde expansion
  if (out.startsWith('~')) {
    out = os.homedir() + out.slice(1)
  }
  // Windows %VAR%
  out = out.replace(/%([^%]+)%/g, (_m, name: string) => process.env[name] ?? `%${name}%`)
  // Unix $VAR / ${VAR}
  out = out.replace(/\$\{?([A-Z_][A-Z0-9_]*)\}?/gi, (_m, name: string) => process.env[name] ?? `$${name}`)
  return out
}

/** A path is a valid ComfyUI installation if it contains main.py and pyproject.toml. */
export function isValidComfyInstall(dirPath: string): boolean {
  if (!dirPath) return false
  const expanded = expandEnvVars(dirPath)
  if (!fs.existsSync(expanded)) return false
  return (
    fs.existsSync(path.join(expanded, 'main.py')) &&
    fs.existsSync(path.join(expanded, 'pyproject.toml'))
  )
}

/**
 * If the user points to a macOS .app bundle, resolve to the nested ComfyUI dir.
 * Also handles common mistakes like selecting the parent folder of the actual install.
 */
export function resolveComfyPath(dirPath: string): string {
  if (!dirPath) return dirPath

  const expanded = expandEnvVars(dirPath)

  // Direct match — already valid
  if (isValidComfyInstall(expanded)) return expanded

  // macOS .app bundle: /Applications/ComfyUI.app → .../Contents/Resources/ComfyUI
  if (expanded.endsWith('.app')) {
    const nested = path.join(expanded, 'Contents', 'Resources', 'ComfyUI')
    if (isValidComfyInstall(nested)) return nested
  }

  // ComfyUI Desktop (Electron): user picks the install root, but the actual
  // ComfyUI source lives in <root>/resources/ComfyUI. Common on Windows/Linux
  // where there's no .app bundle marker.
  const electronNested = path.join(expanded, 'resources', 'ComfyUI')
  if (isValidComfyInstall(electronNested)) return electronNested

  // User selected parent dir that contains a ComfyUI subfolder
  const comfySub = path.join(expanded, 'ComfyUI')
  if (isValidComfyInstall(comfySub)) return comfySub

  return expanded
}
