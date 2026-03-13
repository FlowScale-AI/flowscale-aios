import { NextResponse } from 'next/server'
import {
  getComfyInstallType,
  setComfyInstallType,
  getComfyManagedPath,
  setComfyManagedPath,
  getComfyManagedPort,
  setComfyManagedPort,
  getComfyDesktopUserDataPath,
  setComfyDesktopUserDataPath,
  type ComfyInstallType,
} from '@/lib/providerSettings'

export async function GET() {
  return NextResponse.json({
    installType: getComfyInstallType() ?? null,
    managedPath: getComfyManagedPath() ?? null,
    managedPort: getComfyManagedPort(),
    desktopUserDataPath: getComfyDesktopUserDataPath() ?? null,
  })
}

export async function POST(req: Request) {
  const body = await req.json() as {
    installType?: ComfyInstallType
    managedPath?: string
    managedPort?: number
    desktopUserDataPath?: string
  }

  if (body.installType !== undefined) setComfyInstallType(body.installType)
  if (body.managedPath !== undefined) setComfyManagedPath(body.managedPath)
  if (body.managedPort !== undefined) setComfyManagedPort(body.managedPort)
  if (body.desktopUserDataPath !== undefined) setComfyDesktopUserDataPath(body.desktopUserDataPath)

  return NextResponse.json({ success: true })
}
