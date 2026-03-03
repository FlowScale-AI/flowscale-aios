import { NextResponse } from 'next/server'
import { networkInterfaces } from 'os'

// Docker/virtual bridge interfaces to exclude
const VIRTUAL_PREFIXES = ['docker', 'br-', 'veth', 'virbr', 'lxc', 'flannel', 'cni', 'podman']

export async function GET() {
  const nets = networkInterfaces()
  const addresses: string[] = []

  for (const [name, iface] of Object.entries(nets)) {
    if (!iface) continue
    // Skip Docker/virtual bridge interfaces
    if (VIRTUAL_PREFIXES.some((p) => name.toLowerCase().startsWith(p))) continue
    for (const info of iface) {
      // Skip internal (loopback), non-IPv4, and link-local (169.254.x.x)
      if (info.internal || info.family !== 'IPv4') continue
      if (info.address.startsWith('169.254.')) continue
      addresses.push(info.address)
    }
  }

  return NextResponse.json({
    port: 14173,
    addresses,
  })
}
