#!/usr/bin/env node
// @ts-check
const fs = require('fs')
const path = require('path')

const appName = process.argv[2]

if (!appName) {
  console.error('Usage: create-flowscale-aios-app <app-name>')
  process.exit(1)
}

if (!/^[a-z][a-z0-9-]*$/.test(appName)) {
  console.error('App name must be lowercase, start with a letter, and contain only letters, numbers, and hyphens.')
  process.exit(1)
}

const targetDir = path.resolve(process.cwd(), appName)

if (fs.existsSync(targetDir)) {
  console.error(`Directory "${appName}" already exists.`)
  process.exit(1)
}

const templateDir = path.join(__dirname, 'template')

// Copy template recursively
fs.cpSync(templateDir, targetDir, { recursive: true })

// Replace __APP_NAME__ token in key files
const filesToPatch = [
  'package.json',
  'flowscale.app.json',
  'src/App.tsx',
]

for (const file of filesToPatch) {
  const filePath = path.join(targetDir, file)
  if (!fs.existsSync(filePath)) continue
  const content = fs.readFileSync(filePath, 'utf-8')
  fs.writeFileSync(filePath, content.replace(/__APP_NAME__/g, appName))
}

console.log(`
✅ Created FlowScale AIOS app: ${appName}

Next steps:
  cd ${appName}
  npm install
  npm run dev          # start Vite dev server
  npm run build        # build to dist/

Then sideload in AIOS:
  Settings > Developer > Load app from path → ${targetDir}
`)
