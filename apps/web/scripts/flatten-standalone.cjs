#!/usr/bin/env node
/**
 * Flatten pnpm's virtual store in Next.js standalone output.
 *
 * Two structures appear in the standalone tree on Windows with pnpm:
 *   (a) A local .pnpm/ subdir with virtual packages (traced copy of the workspace deps)
 *   (b) node_modules/ with symlinks pointing into the *monorepo's* .pnpm store (outside
 *       standalone). Next.js produces (b) when Dev Mode / symlinks are enabled.
 *
 * Both produce install-time paths that exceed Windows MAX_PATH. This script walks every
 * node_modules/ inside standalone, resolves every symlink (local or external) back to its
 * pnpm virtual directory, BFS-traverses the full dep graph, and writes a flat node_modules/
 * layout with one real copy of every package. External .pnpm stores are followed for reading
 * only — never modified.
 *
 * Invariant: after this runs, no path inside .next/standalone/ contains '/.pnpm/' and every
 * package is a real directory at node_modules/<pkg>/ (no symlinks).
 */

const fs = require('fs')
const path = require('path')

const STANDALONE = path.resolve(__dirname, '..', '.next', 'standalone')

function copyDir(src, dest) {
  fs.mkdirSync(dest, { recursive: true })
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const srcPath = path.join(src, entry.name)
    const destPath = path.join(dest, entry.name)
    const lstat = fs.lstatSync(srcPath)
    if (lstat.isSymbolicLink()) {
      let target
      try { target = fs.realpathSync(srcPath) } catch { continue }
      let targetStat
      try { targetStat = fs.statSync(target) } catch { continue }
      if (targetStat.isDirectory()) copyDir(target, destPath)
      else fs.copyFileSync(target, destPath)
    } else if (entry.isDirectory()) {
      copyDir(srcPath, destPath)
    } else {
      fs.copyFileSync(srcPath, destPath)
    }
  }
}

// Given a resolved path like <prefix>/.pnpm/<virt>/node_modules/<pkg>(/<sub>)?,
// return <prefix>/.pnpm/<virt>/node_modules — the "virtual node_modules" that holds
// <pkg> along with its sibling deps. Returns null if the path doesn't live inside a
// pnpm virtual store.
function getVirtualNodeModules(resolvedPath) {
  const parts = path.resolve(resolvedPath).split(path.sep)
  for (let i = 0; i < parts.length - 2; i++) {
    if (parts[i] === '.pnpm' && parts[i + 2] === 'node_modules') {
      return parts.slice(0, i + 3).join(path.sep)
    }
  }
  return null
}

function enqueueFromSymlink(symlinkPath, queue) {
  try {
    const target = fs.realpathSync(symlinkPath)
    const vnm = getVirtualNodeModules(target)
    if (vnm) queue.push(vnm)
  } catch {
    /* broken symlink — ignore */
  }
}

function flattenNodeModules(nmDir) {
  const pkgs = new Map() // pkgName -> real source dir
  const virtualNms = new Set() // queue of virtual node_modules to traverse
  const queue = []

  // Seed with local .pnpm (if any)
  const localPnpm = path.join(nmDir, '.pnpm')
  if (fs.existsSync(localPnpm)) {
    for (const virt of fs.readdirSync(localPnpm, { withFileTypes: true })) {
      if (!virt.isDirectory()) continue
      const vnm = path.join(localPnpm, virt.name, 'node_modules')
      if (fs.existsSync(vnm)) queue.push(vnm)
    }
  }

  // Seed with every symlink in nmDir (and scoped children)
  for (const entry of fs.readdirSync(nmDir, { withFileTypes: true })) {
    if (entry.name === '.pnpm') continue
    const entryPath = path.join(nmDir, entry.name)
    const lstat = fs.lstatSync(entryPath)
    if (lstat.isSymbolicLink()) {
      enqueueFromSymlink(entryPath, queue)
    } else if (entry.name.startsWith('@') && lstat.isDirectory()) {
      for (const scoped of fs.readdirSync(entryPath, { withFileTypes: true })) {
        const scopedPath = path.join(entryPath, scoped.name)
        if (fs.lstatSync(scopedPath).isSymbolicLink()) {
          enqueueFromSymlink(scopedPath, queue)
        }
      }
    }
  }

  // BFS through the dep graph, collecting real packages and following sibling symlinks
  while (queue.length > 0) {
    const vnm = queue.shift()
    if (virtualNms.has(vnm)) continue
    virtualNms.add(vnm)

    let entries
    try { entries = fs.readdirSync(vnm, { withFileTypes: true }) } catch { continue }

    for (const entry of entries) {
      const entryPath = path.join(vnm, entry.name)
      let lstat
      try { lstat = fs.lstatSync(entryPath) } catch { continue }

      if (entry.name.startsWith('@') && lstat.isDirectory() && !lstat.isSymbolicLink()) {
        for (const scoped of fs.readdirSync(entryPath, { withFileTypes: true })) {
          const scopedPath = path.join(entryPath, scoped.name)
          let scopedLstat
          try { scopedLstat = fs.lstatSync(scopedPath) } catch { continue }
          const fullName = `${entry.name}/${scoped.name}`
          if (scopedLstat.isSymbolicLink()) {
            enqueueFromSymlink(scopedPath, queue)
          } else if (scopedLstat.isDirectory()) {
            if (!pkgs.has(fullName)) pkgs.set(fullName, scopedPath)
          }
        }
      } else if (lstat.isSymbolicLink()) {
        enqueueFromSymlink(entryPath, queue)
      } else if (lstat.isDirectory()) {
        if (!pkgs.has(entry.name)) pkgs.set(entry.name, entryPath)
      }
    }
  }

  // Remove top-level symlinks so we can write real content at their paths
  for (const entry of fs.readdirSync(nmDir, { withFileTypes: true })) {
    if (entry.name === '.pnpm') continue
    const entryPath = path.join(nmDir, entry.name)
    const lstat = fs.lstatSync(entryPath)
    if (lstat.isSymbolicLink()) {
      fs.unlinkSync(entryPath)
    } else if (entry.name.startsWith('@') && lstat.isDirectory()) {
      for (const scoped of fs.readdirSync(entryPath, { withFileTypes: true })) {
        const scopedPath = path.join(entryPath, scoped.name)
        if (fs.lstatSync(scopedPath).isSymbolicLink()) fs.unlinkSync(scopedPath)
      }
    }
  }

  // Write every collected package to the flat layout
  let written = 0
  for (const [name, src] of pkgs) {
    const dest = path.join(nmDir, name)
    if (fs.existsSync(dest)) continue
    copyDir(src, dest)
    written++
  }

  // Delete the local .pnpm dir (if any) — its content is now inlined flat
  if (fs.existsSync(localPnpm)) {
    fs.rmSync(localPnpm, { recursive: true, force: true })
  }

  return written
}

function walkAndFlatten(dir, totals = { nmDirs: 0, written: 0 }) {
  let entries
  try { entries = fs.readdirSync(dir, { withFileTypes: true }) } catch { return totals }
  for (const entry of entries) {
    if (!entry.isDirectory()) continue
    const sub = path.join(dir, entry.name)
    if (entry.name === 'node_modules') {
      totals.nmDirs++
      totals.written += flattenNodeModules(sub)
      walkAndFlatten(sub, totals)
    } else {
      walkAndFlatten(sub, totals)
    }
  }
  return totals
}

// Only Windows needs this — it's a workaround for MAX_PATH (260 chars) which
// breaks the NSIS installer/uninstaller on paths inside pnpm's virtual store.
// Linux/macOS have no such limit, so preserving pnpm's space-efficient symlink
// layout produces smaller packages and faster builds.
if (process.platform !== 'win32') {
  console.log('[flatten-standalone] Skipping on non-Windows platform')
  process.exit(0)
}

if (!fs.existsSync(STANDALONE)) {
  console.error(`[flatten-standalone] ${STANDALONE} does not exist — run \`next build\` first`)
  process.exit(1)
}

console.log(`[flatten-standalone] Flattening ${STANDALONE}`)
const start = Date.now()
const { nmDirs, written } = walkAndFlatten(STANDALONE)
console.log(`[flatten-standalone] ${nmDirs} node_modules dirs, wrote ${written} packages in ${((Date.now() - start) / 1000).toFixed(1)}s`)
