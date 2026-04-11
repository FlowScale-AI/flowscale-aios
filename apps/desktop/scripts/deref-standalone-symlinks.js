/**
 * Hoist pnpm packages in the Next.js standalone output for Windows/Electron.
 *
 * pnpm uses a content-addressable store with symlinks, but:
 * 1. Windows symlinks don't survive asar packaging
 * 2. Next.js standalone output on pnpm lacks hoisted top-level packages
 *
 * This script copies packages from .pnpm/ to node_modules/ root level.
 *
 * Run after `next build` and before `electron-builder`.
 */

const fs = require("fs");
const path = require("path");

const STANDALONE_DIR = path.resolve(__dirname, "../../web/.next/standalone");
const ROOT_NODE_MODULES = path.resolve(__dirname, "../../../node_modules");

// Packages that Next.js require-hook expects at the top level
const REQUIRED_HOISTED = [
  // Next.js core
  "styled-jsx",
  "next",
  "react",
  "react-dom",
  "scheduler",
  "@swc/helpers",
  "@next/env",
  "caniuse-lite",
  "client-only",
  "server-only",
  "postcss",
  "nanoid",
  "picocolors",
  // Runtime dependencies
  "busboy",
  "ws",
  "sharp",
  "better-sqlite3",
  "bindings",
  "file-uri-to-path",
  "drizzle-orm",
  "uuid",
  "axios",
  // Additional Next.js internals
  "streamsearch",
  "@emnapi/runtime",
  "source-map-js",
  // Sharp Windows binaries (optional but needed for image processing)
  "@img/sharp-win32-x64",
];

function copyRecursive(src, dest) {
  const stat = fs.statSync(src);
  if (stat.isDirectory()) {
    fs.mkdirSync(dest, { recursive: true });
    for (const child of fs.readdirSync(src)) {
      copyRecursive(path.join(src, child), path.join(dest, child));
    }
  } else {
    fs.copyFileSync(src, dest);
  }
}

function findPackageInPnpmStore(nodeModulesDir, packageName) {
  // Search in both local and root pnpm stores
  const pnpmDirs = [
    path.join(nodeModulesDir, ".pnpm"),
    path.join(ROOT_NODE_MODULES, ".pnpm"),
  ];

  for (const pnpmDir of pnpmDirs) {
    if (!fs.existsSync(pnpmDir)) continue;

    // Search for package directories matching the name
    // pnpm stores as: .pnpm/package-name@version_peer-deps/node_modules/package-name
    const entries = fs.readdirSync(pnpmDir);
    for (const entry of entries) {
      // Match package@version or @scope+package@version
      const escapedName = packageName.replace("/", "+");
      if (
        entry.startsWith(escapedName + "@") ||
        entry.startsWith(packageName + "@")
      ) {
        const packagePath = path.join(
          pnpmDir,
          entry,
          "node_modules",
          packageName,
        );
        if (fs.existsSync(packagePath)) {
          return packagePath;
        }
      }
    }
  }
  return null;
}

function hoistPackages(nodeModulesDir, packages) {
  let count = 0;
  for (const pkg of packages) {
    const destPath = path.join(nodeModulesDir, pkg);

    // Skip if already exists
    if (fs.existsSync(destPath)) {
      console.log(`  [skip] ${pkg} (already exists)`);
      continue;
    }

    const srcPath = findPackageInPnpmStore(nodeModulesDir, pkg);
    if (!srcPath) {
      console.log(`  [warn] ${pkg} not found in .pnpm store`);
      continue;
    }

    try {
      copyRecursive(srcPath, destPath);
      console.log(`  [copy] ${pkg}`);
      count++;
    } catch (err) {
      console.warn(`  [fail] ${pkg}: ${err.message}`);
    }
  }
  return count;
}

function processNodeModulesDir(dir) {
  console.log(`\nProcessing: ${path.relative(STANDALONE_DIR, dir) || "root"}`);
  return hoistPackages(dir, REQUIRED_HOISTED);
}

// Main
if (!fs.existsSync(STANDALONE_DIR)) {
  console.error("Standalone directory not found. Run `next build` first.");
  process.exit(1);
}

console.log("Hoisting pnpm packages in:", STANDALONE_DIR);

let total = 0;

// Process root node_modules
const rootNodeModules = path.join(STANDALONE_DIR, "node_modules");
if (fs.existsSync(rootNodeModules)) {
  total += processNodeModulesDir(rootNodeModules);
}

// Process apps/web/node_modules (where Next.js lives)
const webNodeModules = path.join(STANDALONE_DIR, "apps", "web", "node_modules");
if (fs.existsSync(webNodeModules)) {
  total += processNodeModulesDir(webNodeModules);
}

console.log(`\nDone. Hoisted ${total} packages.`);
