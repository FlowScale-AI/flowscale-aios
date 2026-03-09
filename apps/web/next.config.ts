import type { NextConfig } from 'next'
import { readFileSync } from 'fs'
import { resolve } from 'path'

const desktopPkg = JSON.parse(
  readFileSync(resolve(__dirname, '../desktop/package.json'), 'utf-8')
) as { version: string }

const nextConfig: NextConfig = {
  output: 'standalone',
  // Allow server-side access to home dir for SQLite
  serverExternalPackages: ['better-sqlite3'],
  env: {
    NEXT_PUBLIC_APP_VERSION: desktopPkg.version,
  },
}

export default nextConfig
