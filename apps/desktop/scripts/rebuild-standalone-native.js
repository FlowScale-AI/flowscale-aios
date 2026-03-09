#!/usr/bin/env node
/**
 * Rebuilds native Node.js addons (e.g. better-sqlite3) inside the Next.js
 * standalone output so they match Electron's Node.js ABI.
 *
 * The standalone build only includes pre-built .node binaries (no source/gyp
 * files), so we rebuild from the root node_modules (where sources exist) and
 * copy the resulting binary into the standalone output.
 */
const { execSync } = require('child_process')
const path = require('path')
const fs = require('fs')

const ROOT_DIR = path.resolve(__dirname, '../../..')
const STANDALONE_DIR = path.resolve(__dirname, '../../web/.next/standalone')

if (!fs.existsSync(STANDALONE_DIR)) {
  console.error('[rebuild-standalone] Standalone build not found at', STANDALONE_DIR)
  console.error('[rebuild-standalone] Run "pnpm build" first.')
  process.exit(1)
}

const electronPkg = require('electron/package.json')
const electronVersion = electronPkg.version
console.log(`[rebuild-standalone] Rebuilding native modules for Electron ${electronVersion}...`)

// Find native .node files in the standalone output and rebuild their sources
const nativeFiles = execSync(
  `find "${STANDALONE_DIR}" -name "*.node" -type f`,
  { encoding: 'utf-8' }
).trim()

if (!nativeFiles) {
  console.log('[rebuild-standalone] No native modules found — nothing to rebuild.')
  process.exit(0)
}

for (const nativeFile of nativeFiles.split('\n')) {
  // Extract module name and version from the pnpm path
  // e.g. .../node_modules/.pnpm/better-sqlite3@12.6.2/node_modules/better-sqlite3/build/Release/better_sqlite3.node
  const pnpmMatch = nativeFile.match(/\.pnpm\/([^@]+)@([^/]+)\//)
  if (!pnpmMatch) {
    console.warn(`[rebuild-standalone] Skipping non-pnpm native module: ${nativeFile}`)
    continue
  }

  const [, moduleName, moduleVersion] = pnpmMatch
  const binaryName = path.basename(nativeFile)

  // Find matching source in root node_modules
  const sourceDir = path.join(
    ROOT_DIR, 'node_modules', '.pnpm',
    `${moduleName}@${moduleVersion}`, 'node_modules', moduleName
  )

  if (!fs.existsSync(path.join(sourceDir, 'binding.gyp'))) {
    console.warn(`[rebuild-standalone] No source for ${moduleName}@${moduleVersion} — skipping.`)
    continue
  }

  console.log(`[rebuild-standalone] Rebuilding ${moduleName}@${moduleVersion} for Electron ${electronVersion}...`)

  // Rebuild using node-gyp with Electron headers
  execSync(
    [
      'npx', 'node-gyp', 'rebuild',
      `--target=${electronVersion}`,
      `--arch=${process.arch}`,
      '--dist-url=https://electronjs.org/headers',
    ].join(' '),
    { stdio: 'inherit', cwd: sourceDir }
  )

  // Copy rebuilt binary into standalone output
  const builtBinary = path.join(sourceDir, 'build', 'Release', binaryName)
  if (!fs.existsSync(builtBinary)) {
    console.error(`[rebuild-standalone] Rebuilt binary not found: ${builtBinary}`)
    process.exit(1)
  }

  console.log(`[rebuild-standalone] Copying rebuilt binary to standalone...`)
  fs.copyFileSync(builtBinary, nativeFile)

  // Restore the module for system Node.js so dev workflow isn't broken
  console.log(`[rebuild-standalone] Restoring ${moduleName} for system Node.js...`)
  execSync('npx node-gyp rebuild', { stdio: 'inherit', cwd: sourceDir })
}

console.log('[rebuild-standalone] Done.')
