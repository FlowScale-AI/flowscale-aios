#!/usr/bin/env node
/**
 * Rebuilds native Node.js addons (e.g. better-sqlite3) inside the Next.js
 * standalone output so they match Electron's Node.js ABI.
 *
 * Uses @electron/rebuild to rebuild modules correctly for the Electron runtime.
 */
const { execSync } = require("child_process");
const path = require("path");
const fs = require("fs");

const ROOT_DIR = path.resolve(__dirname, "../../..");
const STANDALONE_DIR = path.resolve(__dirname, "../../web/.next/standalone");

// Native modules that need rebuilding for Electron
const NATIVE_MODULES = ["better-sqlite3"];

if (!fs.existsSync(STANDALONE_DIR)) {
  console.error(
    "[rebuild-standalone] Standalone build not found at",
    STANDALONE_DIR,
  );
  console.error('[rebuild-standalone] Run "pnpm build" first.');
  process.exit(1);
}

const electronPkg = require("electron/package.json");
const electronVersion = electronPkg.version;
console.log(
  `[rebuild-standalone] Rebuilding native modules for Electron ${electronVersion}...`,
);

// Find all locations where native modules exist in standalone
function findModuleLocations(moduleName) {
  const locations = [];

  // Check hoisted locations
  const hoistedPaths = [
    path.join(STANDALONE_DIR, "node_modules", moduleName),
    path.join(STANDALONE_DIR, "apps", "web", "node_modules", moduleName),
  ];

  for (const p of hoistedPaths) {
    if (fs.existsSync(p)) {
      locations.push(p);
    }
  }

  // Check .pnpm locations
  const pnpmDirs = [
    path.join(STANDALONE_DIR, "node_modules", ".pnpm"),
    path.join(STANDALONE_DIR, "apps", "web", "node_modules", ".pnpm"),
  ];

  for (const pnpmDir of pnpmDirs) {
    if (!fs.existsSync(pnpmDir)) continue;
    const entries = fs.readdirSync(pnpmDir);
    for (const entry of entries) {
      if (entry.startsWith(moduleName + "@")) {
        const modPath = path.join(pnpmDir, entry, "node_modules", moduleName);
        if (fs.existsSync(modPath)) {
          locations.push(modPath);
        }
      }
    }
  }

  return locations;
}

// Find the source module in root node_modules for rebuilding
function findSourceModule(moduleName) {
  // Check root node_modules first
  const directPath = path.join(ROOT_DIR, "node_modules", moduleName);
  if (fs.existsSync(path.join(directPath, "binding.gyp"))) {
    return directPath;
  }

  // Check .pnpm store
  const pnpmDir = path.join(ROOT_DIR, "node_modules", ".pnpm");
  if (fs.existsSync(pnpmDir)) {
    const entries = fs.readdirSync(pnpmDir);
    for (const entry of entries) {
      if (entry.startsWith(moduleName + "@")) {
        const modPath = path.join(pnpmDir, entry, "node_modules", moduleName);
        if (fs.existsSync(path.join(modPath, "binding.gyp"))) {
          return modPath;
        }
      }
    }
  }

  return null;
}

// Copy rebuilt .node files from source to all target locations
function copyBuiltBinary(sourceModule, targetLocations) {
  const buildDir = path.join(sourceModule, "build", "Release");
  if (!fs.existsSync(buildDir)) {
    console.error(
      `[rebuild-standalone] Build directory not found: ${buildDir}`,
    );
    return false;
  }

  const nodeFiles = fs.readdirSync(buildDir).filter((f) => f.endsWith(".node"));
  if (nodeFiles.length === 0) {
    console.error(`[rebuild-standalone] No .node files found in ${buildDir}`);
    return false;
  }

  for (const targetModule of targetLocations) {
    const targetBuildDir = path.join(targetModule, "build", "Release");
    fs.mkdirSync(targetBuildDir, { recursive: true });

    for (const nodeFile of nodeFiles) {
      const src = path.join(buildDir, nodeFile);
      const dest = path.join(targetBuildDir, nodeFile);
      console.log(
        `[rebuild-standalone] Copying ${nodeFile} to ${targetModule}`,
      );
      fs.copyFileSync(src, dest);
    }
  }

  return true;
}

for (const moduleName of NATIVE_MODULES) {
  console.log(`\n[rebuild-standalone] Processing ${moduleName}...`);

  const targetLocations = findModuleLocations(moduleName);
  if (targetLocations.length === 0) {
    console.log(
      `[rebuild-standalone] ${moduleName} not found in standalone — skipping.`,
    );
    continue;
  }
  console.log(
    `[rebuild-standalone] Found ${targetLocations.length} location(s) in standalone`,
  );

  const sourceModule = findSourceModule(moduleName);
  if (!sourceModule) {
    console.error(
      `[rebuild-standalone] Source not found for ${moduleName} — cannot rebuild.`,
    );
    continue;
  }
  console.log(`[rebuild-standalone] Source: ${sourceModule}`);

  // Rebuild using @electron/rebuild
  console.log(
    `[rebuild-standalone] Rebuilding ${moduleName} for Electron ${electronVersion}...`,
  );

  try {
    // Use npx to run @electron/rebuild
    const npxCmd = process.platform === "win32" ? "npx.cmd" : "npx";
    execSync(
      `${npxCmd} @electron/rebuild -v ${electronVersion} -m "${sourceModule}" --only ${moduleName}`,
      {
        stdio: "inherit",
        cwd: ROOT_DIR,
        env: {
          ...process.env,
          npm_config_runtime: "electron",
          npm_config_target: electronVersion,
        },
      },
    );
  } catch (err) {
    console.error(
      `[rebuild-standalone] @electron/rebuild failed, trying node-gyp...`,
    );

    // Fallback to direct node-gyp rebuild
    try {
      const npxCmd = process.platform === "win32" ? "npx.cmd" : "npx";
      execSync(
        `${npxCmd} node-gyp rebuild --target=${electronVersion} --arch=${process.arch} --dist-url=https://electronjs.org/headers`,
        {
          stdio: "inherit",
          cwd: sourceModule,
        },
      );
    } catch (gypErr) {
      console.error(
        `[rebuild-standalone] node-gyp rebuild also failed:`,
        gypErr.message,
      );
      continue;
    }
  }

  // Copy rebuilt binaries to standalone
  if (!copyBuiltBinary(sourceModule, targetLocations)) {
    console.error(
      `[rebuild-standalone] Failed to copy rebuilt binaries for ${moduleName}`,
    );
    continue;
  }

  console.log(`[rebuild-standalone] Successfully rebuilt ${moduleName}`);
}

console.log("\n[rebuild-standalone] Done.");
