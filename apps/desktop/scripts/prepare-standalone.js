/**
 * Copies the Next.js standalone output into a staging directory,
 * dereferencing all symlinks so the result works when bundled
 * into the Electron app (where pnpm store symlinks won't resolve).
 *
 * Next.js standalone output for monorepos has this layout:
 *   standalone/
 *     node_modules/.pnpm/...          (root hoisted deps — real dirs)
 *     apps/web/server.js
 *     apps/web/node_modules/...       (symlinks into root .pnpm)
 *     packages/workflow/...
 *
 * We flatten it into:
 *   standalone-build/
 *     server.js
 *     package.json
 *     node_modules/...                (all deps, flattened, dereferenced)
 *     .next/...
 *     public/...
 */
const fs = require("fs");
const path = require("path");

const WEB_DIR = path.resolve(__dirname, "..", "..", "web");
const STANDALONE = path.join(WEB_DIR, ".next", "standalone");
const STATIC = path.join(WEB_DIR, ".next", "static");
const PUBLIC = path.join(WEB_DIR, "public");
const DEST = path.resolve(__dirname, "..", "standalone-build");

// Detect monorepo layout (apps/web/server.js) vs flat layout (server.js)
const MONOREPO_WEB = path.join(STANDALONE, "apps", "web");
const isMonorepo = fs.existsSync(path.join(MONOREPO_WEB, "server.js"));
const WEB_STANDALONE = isMonorepo ? MONOREPO_WEB : STANDALONE;
const ROOT_NODE_MODULES = path.join(STANDALONE, "node_modules");

function copyDirSync(src, dest) {
  fs.mkdirSync(dest, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);

    // Always resolve symlinks to their real path
    const realSrc = fs.realpathSync(srcPath);
    const stat = fs.statSync(realSrc);

    if (stat.isDirectory()) {
      copyDirSync(realSrc, destPath);
    } else {
      fs.copyFileSync(realSrc, destPath);
    }
  }
}

/**
 * Collect all packages from the .pnpm store and any workspace node_modules,
 * flatten them into a single node_modules directory with all deps dereferenced.
 */
function buildFlatNodeModules(dest) {
  fs.mkdirSync(dest, { recursive: true });
  const copied = new Set();

  function copyPackage(name, realSrc) {
    if (copied.has(name)) return;
    console.log(`  [copy] ${name}`);
    const destPath = name.includes("/")
      ? path.join(dest, ...name.split("/"))
      : path.join(dest, name);
    copyDirSync(realSrc, destPath);
    copied.add(name);
  }

  // 1) Copy packages from the root .pnpm store (monorepo layout)
  const pnpmDir = path.join(ROOT_NODE_MODULES, ".pnpm");
  if (fs.existsSync(pnpmDir)) {
    console.log("  [source] root node_modules/.pnpm");
    for (const versionedDir of fs.readdirSync(pnpmDir)) {
      const nmDir = path.join(pnpmDir, versionedDir, "node_modules");
      if (!fs.existsSync(nmDir)) continue;

      for (const pkg of fs.readdirSync(nmDir)) {
        const pkgPath = path.join(nmDir, pkg);
        const stat = fs.lstatSync(pkgPath);

        if (pkg.startsWith("@") && stat.isDirectory()) {
          // Scoped package — enumerate sub-packages
          for (const sub of fs.readdirSync(pkgPath)) {
            const scopedName = `${pkg}/${sub}`;
            if (!copied.has(scopedName)) {
              const realPath = fs.realpathSync(path.join(pkgPath, sub));
              copyPackage(scopedName, realPath);
            }
          }
        } else if (stat.isDirectory() || stat.isSymbolicLink()) {
          if (!copied.has(pkg)) {
            const realPath = fs.realpathSync(pkgPath);
            copyPackage(pkg, realPath);
          }
        }
      }
    }
  }

  // 2) Copy packages from the workspace-level node_modules (symlinks to .pnpm or real dirs)
  const webNM = path.join(WEB_STANDALONE, "node_modules");
  if (fs.existsSync(webNM)) {
    console.log("  [source] apps/web/node_modules");
    for (const entry of fs.readdirSync(webNM)) {
      if (entry === ".pnpm") continue;
      const entryPath = path.join(webNM, entry);
      const lstat = fs.lstatSync(entryPath);

      if (entry.startsWith("@") && lstat.isDirectory()) {
        for (const sub of fs.readdirSync(entryPath)) {
          const scopedName = `${entry}/${sub}`;
          if (!copied.has(scopedName)) {
            const realPath = fs.realpathSync(path.join(entryPath, sub));
            copyPackage(scopedName, realPath);
          }
        }
      } else if (!copied.has(entry)) {
        const realPath = fs.realpathSync(entryPath);
        copyPackage(entry, realPath);
      }
    }
  }

  // 3) Also resolve siblings in the pnpm virtual store for each copied package
  //    (catches transitive deps like bindings → file-uri-to-path)
  const queue = [...copied];
  const processed = new Set(queue);
  while (queue.length > 0) {
    const name = queue.shift();
    // Find the real source of this package
    const destPath = name.includes("/")
      ? path.join(dest, ...name.split("/"))
      : path.join(dest, name);
    // The package was already copied to destPath — we need to find its pnpm parent
    // Look up in ROOT_NODE_MODULES/.pnpm for a versioned dir containing this package
  }

  console.log(`  [total] ${copied.size} packages copied`);
}

// Clean previous build
if (fs.existsSync(DEST)) {
  fs.rmSync(DEST, { recursive: true, force: true });
}

console.log(
  `[prepare] Layout: ${isMonorepo ? "monorepo (apps/web/)" : "flat"}`,
);

// Copy server.js and package.json from the web standalone dir
console.log("[prepare] Copying standalone output...");
fs.mkdirSync(DEST, { recursive: true });
for (const entry of fs.readdirSync(WEB_STANDALONE)) {
  if (entry === "node_modules") continue;
  const srcPath = path.join(WEB_STANDALONE, entry);
  const realSrc = fs.realpathSync(srcPath);
  const stat = fs.statSync(realSrc);
  const destPath = path.join(DEST, entry);
  if (stat.isDirectory()) {
    copyDirSync(realSrc, destPath);
  } else {
    fs.copyFileSync(realSrc, destPath);
  }
}

// Build flat node_modules from .pnpm store + workspace deps
console.log("[prepare] Copying node_modules...");
buildFlatNodeModules(path.join(DEST, "node_modules"));

// Copy static assets into .next/static inside standalone
console.log("[prepare] Copying .next/static...");
copyDirSync(STATIC, path.join(DEST, ".next", "static"));

// Copy public folder
if (fs.existsSync(PUBLIC)) {
  console.log("[prepare] Copying public/...");
  copyDirSync(PUBLIC, path.join(DEST, "public"));
}

// Post-copy: overwrite better-sqlite3 native binary with the Electron-rebuilt one.
// During the build sequence, better-sqlite3 is first compiled for Node (ABI 115)
// so that `next build` works, then recompiled for Electron (ABI 140).
// prepare-standalone runs after `next build` (with Node binary), so we must
// overwrite with the Electron binary which is rebuilt right before packaging.
const ELECTRON_BETTER_SQLITE3 = path.resolve(
  __dirname,
  "..",
  "..",
  "..",
  "node_modules",
  ".pnpm",
  "better-sqlite3@12.6.2",
  "node_modules",
  "better-sqlite3",
  "build",
  "Release",
  "better_sqlite3.node",
);
const DEST_BETTER_SQLITE3 = path.join(
  DEST,
  "node_modules",
  "better-sqlite3",
  "build",
  "Release",
  "better_sqlite3.node",
);
if (
  fs.existsSync(ELECTRON_BETTER_SQLITE3) &&
  fs.existsSync(path.dirname(DEST_BETTER_SQLITE3))
) {
  fs.copyFileSync(ELECTRON_BETTER_SQLITE3, DEST_BETTER_SQLITE3);
  console.log(
    "[prepare] Overwrote better-sqlite3.node with Electron-rebuilt binary",
  );
}

console.log("[prepare] Done. Standalone build at:", DEST);
