#!/usr/bin/env node
/**
 * Replaces native .node binaries in the Next.js standalone output with versions
 * compiled against Electron's Node ABI — not the system Node ABI.
 *
 * On Windows the packaged server spawns under ELECTRON_RUN_AS_NODE (since
 * findSystemNode() can't locate node reliably), so .node files prebuilt for
 * system Node v22 (ABI 127) fail to load in Electron's newer Node (ABI 140).
 *
 * Uses prebuild-install to download the electron-variant prebuilt binary for
 * each native module found in the standalone tree. Faster and toolchain-free
 * versus compiling from source.
 */

const { execSync } = require('child_process')
const path = require('path')
const fs = require('fs')

const ROOT_DIR = path.resolve(__dirname, '../../..')
const STANDALONE_DIR = path.resolve(__dirname, '../../web/.next/standalone')

if (!fs.existsSync(STANDALONE_DIR)) {
  console.error('[rebuild-standalone] Standalone build not found at', STANDALONE_DIR)
  process.exit(1)
}

const electronVersion = require('electron/package.json').version
console.log(`[rebuild-standalone] Target: Electron ${electronVersion}`)

// Locate prebuild-install binary in the monorepo's pnpm store
function findPrebuildInstall() {
  const candidates = [
    path.join(ROOT_DIR, 'node_modules', 'prebuild-install', 'bin.js'),
  ]
  const pnpmDir = path.join(ROOT_DIR, 'node_modules', '.pnpm')
  if (fs.existsSync(pnpmDir)) {
    for (const entry of fs.readdirSync(pnpmDir)) {
      if (entry.startsWith('prebuild-install@')) {
        candidates.push(path.join(pnpmDir, entry, 'node_modules', 'prebuild-install', 'bin.js'))
      }
    }
  }
  for (const c of candidates) if (fs.existsSync(c)) return c
  return null
}

const prebuildBin = findPrebuildInstall()
if (!prebuildBin) {
  console.error('[rebuild-standalone] prebuild-install not found in node_modules — cannot continue.')
  process.exit(1)
}

// Walk standalone tree for any package containing a build/Release/*.node file
function findNativePackages(dir, out = new Set()) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue
    const sub = path.join(dir, entry.name)
    const releaseDir = path.join(sub, 'build', 'Release')
    if (fs.existsSync(releaseDir)) {
      const hasNode = fs.readdirSync(releaseDir).some((f) => f.endsWith('.node'))
      if (hasNode && fs.existsSync(path.join(sub, 'package.json'))) {
        out.add(sub)
        continue
      }
    }
    findNativePackages(sub, out)
  }
  return out
}

const packages = findNativePackages(STANDALONE_DIR)
console.log(`[rebuild-standalone] Found ${packages.size} native package director${packages.size === 1 ? 'y' : 'ies'}`)

let rebuilt = 0
for (const pkgDir of packages) {
  const pkgJson = JSON.parse(fs.readFileSync(path.join(pkgDir, 'package.json'), 'utf-8'))
  const relPath = path.relative(STANDALONE_DIR, pkgDir)
  console.log(`[rebuild-standalone] ${pkgJson.name}@${pkgJson.version}  (${relPath})`)
  try {
    execSync(
      `node "${prebuildBin}" --runtime electron --target ${electronVersion}`,
      { cwd: pkgDir, stdio: 'inherit' }
    )
    rebuilt++
  } catch (err) {
    console.warn(`[rebuild-standalone] prebuild-install failed for ${pkgJson.name}: ${err.message}`)
  }
}

console.log(`[rebuild-standalone] Done — ${rebuilt}/${packages.size} rebuilt for Electron ${electronVersion}`)
