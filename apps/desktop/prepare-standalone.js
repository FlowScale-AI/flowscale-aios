/**
 * prepare-standalone.js
 *
 * Copies the Next.js standalone output into apps/desktop/standalone-build/standalone/
 * with all pnpm symlinks dereferenced (real file copies) and the pnpm virtual store
 * flattened into a standard node_modules layout that works without pnpm.
 *
 * Run this AFTER `next build` and BEFORE `electron-builder`.
 */

const fs = require('fs')
const path = require('path')

const ROOT = path.resolve(__dirname, '../..')
const WEB_DIR = path.join(ROOT, 'apps', 'web')
const STANDALONE_SRC = path.join(WEB_DIR, '.next', 'standalone')
const STATIC_SRC = path.join(WEB_DIR, '.next', 'static')
const PUBLIC_SRC = path.join(WEB_DIR, 'public')

const OUT_DIR = path.join(__dirname, 'standalone-build', 'standalone')

// Destination paths inside the standalone copy (mirrors Next.js expected structure)
const STATIC_DEST = path.join(OUT_DIR, 'apps', 'web', '.next', 'static')
const PUBLIC_DEST = path.join(OUT_DIR, 'apps', 'web', 'public')

/**
 * Recursively copy `src` to `dest`, dereferencing symlinks so every entry
 * becomes a real file/directory in the output.
 */
function copyDirDeref(src, dest) {
  let realSrc
  try {
    realSrc = fs.realpathSync(src)
  } catch {
    // Broken symlink — skip
    return
  }
  const stat = fs.statSync(realSrc)

  if (stat.isDirectory()) {
    fs.mkdirSync(dest, { recursive: true })
    for (const entry of fs.readdirSync(realSrc)) {
      copyDirDeref(path.join(realSrc, entry), path.join(dest, entry))
    }
  } else {
    fs.mkdirSync(path.dirname(dest), { recursive: true })
    fs.copyFileSync(realSrc, dest)
  }
}

/**
 * Flatten the pnpm virtual store (.pnpm) inside a node_modules directory.
 * pnpm stores packages at:
 *   node_modules/.pnpm/<name>@<version>/node_modules/<name>/
 *
 * This function hoists each package into node_modules/<name>/ so that
 * standard Node.js resolution works without pnpm's resolver.
 */
function flattenPnpmStore(nodeModulesDir) {
  const pnpmDir = path.join(nodeModulesDir, '.pnpm')
  if (!fs.existsSync(pnpmDir)) return

  console.log(`  Flattening .pnpm store in: ${nodeModulesDir}`)

  const entries = fs.readdirSync(pnpmDir)
  for (const pkgVersionDir of entries) {
    if (pkgVersionDir === 'lock.yaml' || pkgVersionDir === 'node_modules') continue

    const innerNodeModules = path.join(pnpmDir, pkgVersionDir, 'node_modules')
    if (!fs.existsSync(innerNodeModules) || !fs.statSync(innerNodeModules).isDirectory()) continue

    for (const pkg of fs.readdirSync(innerNodeModules)) {
      // Skip .pnpm internal files and already-hoisted packages
      if (pkg.startsWith('.')) continue

      const dest = path.join(nodeModulesDir, pkg)

      // Don't overwrite packages that were already present (direct deps take priority)
      if (fs.existsSync(dest)) continue

      const src = path.join(innerNodeModules, pkg)
      try {
        const realSrc = fs.realpathSync(src)
        if (fs.statSync(realSrc).isDirectory()) {
          copyDirDeref(src, dest)
        }
      } catch {
        // Skip broken entries
      }
    }
  }

  // Remove the .pnpm directory after flattening (no longer needed)
  fs.rmSync(pnpmDir, { recursive: true, force: true })
}

// ── Main ────────────────────────────────────────────────────────────────────

console.log('[prepare-standalone] Cleaning previous output…')
if (fs.existsSync(OUT_DIR)) {
  fs.rmSync(OUT_DIR, { recursive: true, force: true })
}

console.log('[prepare-standalone] Copying standalone output (dereferencing symlinks)…')
console.log(`  from: ${STANDALONE_SRC}`)
console.log(`    to: ${OUT_DIR}`)
copyDirDeref(STANDALONE_SRC, OUT_DIR)

// Flatten all pnpm virtual stores
console.log('[prepare-standalone] Flattening pnpm virtual stores…')
const topNodeModules = path.join(OUT_DIR, 'node_modules')
flattenPnpmStore(topNodeModules)

// Also flatten any nested node_modules (e.g. apps/web/node_modules)
const webNodeModules = path.join(OUT_DIR, 'apps', 'web', 'node_modules')
if (fs.existsSync(webNodeModules)) {
  flattenPnpmStore(webNodeModules)
}

console.log('[prepare-standalone] Copying static assets…')
console.log(`  from: ${STATIC_SRC}`)
console.log(`    to: ${STATIC_DEST}`)
copyDirDeref(STATIC_SRC, STATIC_DEST)

if (fs.existsSync(PUBLIC_SRC)) {
  console.log('[prepare-standalone] Copying public directory…')
  console.log(`  from: ${PUBLIC_SRC}`)
  console.log(`    to: ${PUBLIC_DEST}`)
  copyDirDeref(PUBLIC_SRC, PUBLIC_DEST)
} else {
  console.log('[prepare-standalone] No public directory found, skipping.')
}

// ── Verify critical dependencies ────────────────────────────────────────────

const criticalDeps = ['styled-jsx', 'next', 'react']
let allFound = true

for (const dep of criticalDeps) {
  // Check multiple possible locations
  const locations = [
    path.join(OUT_DIR, 'node_modules', dep),
    path.join(OUT_DIR, 'apps', 'web', 'node_modules', dep),
    path.join(OUT_DIR, 'apps', 'web', 'node_modules', 'next', 'node_modules', dep),
  ]

  const found = locations.some(loc => fs.existsSync(loc))
  if (found) {
    console.log(`[prepare-standalone] ✓ ${dep} found`)
  } else {
    console.error(`[prepare-standalone] ✗ ${dep} NOT found — the app may crash at runtime!`)
    allFound = false
  }
}

if (!allFound) {
  process.exit(1)
}

console.log('[prepare-standalone] Done ✓')
