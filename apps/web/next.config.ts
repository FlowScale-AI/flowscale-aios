import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  output: 'standalone',
  // Allow server-side access to home dir for SQLite
  serverExternalPackages: ['better-sqlite3'],
}

export default nextConfig
