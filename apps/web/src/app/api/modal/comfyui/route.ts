import { NextRequest, NextResponse } from 'next/server'
import { getRequestUser } from '@/lib/auth'
import {
  getModalComfyInstances,
  getModalComfyById,
  addModalComfyInstance,
  removeModalComfyInstance,
  updateModalComfyInstance,
  allocateVirtualPort,
  isModalComfyDeploying,
} from '@/lib/modal-comfyui'
import { validateGpuTier } from '@/lib/modal-deploy'
import { spawn } from 'child_process'
import { join } from 'path'
import { writeFileSync, mkdirSync } from 'fs'
import { tmpdir } from 'os'
import { getComfyUIPath } from '@/lib/providerSettings'

const log = (...args: unknown[]) => console.log('[modal-comfyui]', ...args)
const logError = (...args: unknown[]) => console.error('[modal-comfyui]', ...args)

export async function GET(req: NextRequest) {
  const user = getRequestUser(req)
  if (!user) {
    log('GET — unauthorized (no session)')
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const instances = getModalComfyInstances()
  log(`GET — returning ${instances.length} instance(s):`, instances.map(i => `${i.id}(${i.status})`).join(', ') || '(none)')
  return NextResponse.json({ instances })
}

const NAME_RE = /^[a-z0-9][a-z0-9-]{0,62}[a-z0-9]$/

export async function POST(req: NextRequest) {
  const user = getRequestUser(req)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json()
  const { action } = body
  log(`POST — action="${action}"`, JSON.stringify(body))

  if (action === 'deploy') {
    const { gpu, name } = body as { gpu: string; name: string }
    log(`DEPLOY — name="${name}" gpu="${gpu}"`)

    if (!gpu || !validateGpuTier(gpu)) {
      log(`DEPLOY — rejected: invalid GPU tier "${gpu}"`)
      return NextResponse.json({ error: 'Invalid GPU tier' }, { status: 400 })
    }
    if (!name || !NAME_RE.test(name)) {
      log(`DEPLOY — rejected: invalid name "${name}" (must match ${NAME_RE})`)
      return NextResponse.json({ error: 'Invalid name' }, { status: 400 })
    }

    const existing = getModalComfyInstances()
    log(`DEPLOY — existing instances: [${existing.map(i => i.id).join(', ')}]`)
    if (existing.some(i => i.name === name)) {
      log(`DEPLOY — rejected: name "${name}" already exists`)
      return NextResponse.json({ error: 'Name already exists' }, { status: 409 })
    }
    if (isModalComfyDeploying()) {
      log('DEPLOY — rejected: another deployment already in progress')
      return NextResponse.json({ error: 'Another deployment in progress' }, { status: 409 })
    }

    const virtualPort = allocateVirtualPort()
    const appName = `flowscale-${name}`
    log(`DEPLOY — allocated virtualPort=${virtualPort}, appName="${appName}"`)

    addModalComfyInstance({
      id: name,
      name,
      status: 'deploying',
      gpu,
      virtualPort,
      appName,
      url: '',
      deployedAt: Date.now(),
    })
    log(`DEPLOY — instance record created, starting background deploy...`)

    // Fire and forget — scan local ComfyUI, generate config, deploy via helper
    const helperScript = join(process.cwd(), 'scripts', 'modal-helper.py')
    const comfyuiPath = getComfyUIPath()
    log(`DEPLOY — helperScript="${helperScript}", comfyuiPath="${comfyuiPath}"`)

    ;(async () => {
      try {
        // Step 1: Scan local ComfyUI for custom nodes
        log(`DEPLOY[${name}] — Step 1: scanning local ComfyUI at "${comfyuiPath}"...`)
        const scanResult = await new Promise<string>((resolve, reject) => {
          const proc = spawn('python3', [helperScript, 'scan-comfyui', comfyuiPath || ''], {
            stdio: ['ignore', 'pipe', 'pipe'], timeout: 30_000,
          })
          let out = ''
          proc.stdout.on('data', (d: Buffer) => { out += d.toString() })
          proc.on('close', (code) => {
            log(`DEPLOY[${name}] — scan-comfyui exited code=${code}, stdout length=${out.length}`)
            resolve(out.trim())
          })
          proc.on('error', (err) => {
            logError(`DEPLOY[${name}] — scan-comfyui spawn error:`, err)
            reject(err)
          })
        })

        log(`DEPLOY[${name}] — parsing scan result (first 200 chars): ${scanResult.slice(0, 200)}`)
        const scanData = JSON.parse(scanResult)
        log(`DEPLOY[${name}] — scan found ${scanData.customNodes?.length ?? 0} custom nodes, ${scanData.models?.length ?? 0} models`)

        // Step 2: Write config to temp file (too large for CLI args)
        const configFile = join(tmpdir(), `flowscale-comfyui-config-${Date.now()}.json`)
        writeFileSync(configFile, JSON.stringify(scanData), 'utf-8')
        log(`DEPLOY[${name}] — Step 2: deploying via modal-helper deploy-comfyui, configFile="${configFile}"`)

        const deployResult = await new Promise<string>((resolve, reject) => {
          const proc = spawn('python3', [helperScript, 'deploy-comfyui', configFile, gpu, appName], {
            stdio: ['ignore', 'pipe', 'pipe'], timeout: 660_000,
          })
          let out = ''
          proc.stdout.on('data', (d: Buffer) => { out += d.toString() })
          proc.on('close', (code) => {
            log(`DEPLOY[${name}] — deploy-comfyui exited code=${code}, stdout length=${out.length}`)
            resolve(out.trim())
          })
          proc.on('error', (err) => {
            logError(`DEPLOY[${name}] — deploy-comfyui spawn error:`, err)
            reject(err)
          })
        })

        log(`DEPLOY[${name}] — parsing deploy result (first 300 chars): ${deployResult.slice(0, 300)}`)
        const result = JSON.parse(deployResult)
        if (result.success) {
          log(`DEPLOY[${name}] — SUCCESS — url="${result.url}", updating instance to deployed`)
          updateModalComfyInstance(name, {
            status: 'deployed',
            url: result.url || '',
          })
        } else {
          logError(`DEPLOY[${name}] — FAILED — error="${result.error}"`)
          updateModalComfyInstance(name, {
            status: 'error',
            errorMessage: result.error || 'Deploy failed',
          })
        }
      } catch (err) {
        logError(`DEPLOY[${name}] — EXCEPTION:`, err)
        updateModalComfyInstance(name, {
          status: 'error',
          errorMessage: err instanceof Error ? err.message : 'Unknown error',
        })
      }
    })()

    log(`DEPLOY — returning 202 (background deploy started)`)
    return NextResponse.json({ status: 'deploying', name, gpu, virtualPort }, { status: 202 })
  }

  if (action === 'resync') {
    const { instanceId } = body as { instanceId: string }
    log(`RESYNC — instanceId="${instanceId}"`)
    if (!instanceId) return NextResponse.json({ error: 'instanceId required' }, { status: 400 })

    const instance = getModalComfyById(instanceId)
    if (!instance) {
      log(`RESYNC — instance "${instanceId}" not found in JSON file`)
      return NextResponse.json({ error: 'Instance not found' }, { status: 404 })
    }
    log(`RESYNC — found instance: name="${instance.name}", gpu="${instance.gpu}", appName="${instance.appName}"`)

    updateModalComfyInstance(instanceId, { status: 'deploying', errorMessage: undefined })

    const helperScript = join(process.cwd(), 'scripts', 'modal-helper.py')
    const comfyuiPath = getComfyUIPath()

    ;(async () => {
      try {
        log(`RESYNC[${instanceId}] — Step 1: scanning local ComfyUI...`)
        const scanResult = await new Promise<string>((resolve, reject) => {
          const proc = spawn('python3', [helperScript, 'scan-comfyui', comfyuiPath || ''], {
            stdio: ['ignore', 'pipe', 'pipe'], timeout: 30_000,
          })
          let out = ''
          proc.stdout.on('data', (d: Buffer) => { out += d.toString() })
          proc.on('close', (code) => {
            log(`RESYNC[${instanceId}] — scan exited code=${code}`)
            resolve(out.trim())
          })
          proc.on('error', reject)
        })
        const scanData = JSON.parse(scanResult)
        log(`RESYNC[${instanceId}] — scan found ${scanData.customNodes?.length ?? 0} custom nodes`)

        const configFile = join(tmpdir(), `flowscale-comfyui-resync-${Date.now()}.json`)
        writeFileSync(configFile, JSON.stringify(scanData), 'utf-8')
        log(`RESYNC[${instanceId}] — Step 2: redeploying via modal-helper...`)

        const deployResult = await new Promise<string>((resolve, reject) => {
          const proc = spawn('python3', [helperScript, 'deploy-comfyui', configFile, instance.gpu, instance.appName], {
            stdio: ['ignore', 'pipe', 'pipe'], timeout: 660_000,
          })
          let out = ''
          proc.stdout.on('data', (d: Buffer) => { out += d.toString() })
          proc.on('close', (code) => {
            log(`RESYNC[${instanceId}] — deploy exited code=${code}`)
            resolve(out.trim())
          })
          proc.on('error', reject)
        })

        log(`RESYNC[${instanceId}] — parsing deploy result (first 300 chars): ${deployResult.slice(0, 300)}`)
        const result = JSON.parse(deployResult)
        if (result.success) {
          log(`RESYNC[${instanceId}] — SUCCESS — url="${result.url}"`)
          updateModalComfyInstance(instanceId, { status: 'deployed', url: result.url || instance.url })
        } else {
          logError(`RESYNC[${instanceId}] — FAILED — error="${result.error}"`)
          updateModalComfyInstance(instanceId, { status: 'error', errorMessage: result.error || 'Resync failed' })
        }
      } catch (err) {
        logError(`RESYNC[${instanceId}] — EXCEPTION:`, err)
        updateModalComfyInstance(instanceId, {
          status: 'error',
          errorMessage: err instanceof Error ? err.message : 'Unknown error',
        })
      }
    })()

    return NextResponse.json({ status: 'resyncing', instanceId }, { status: 202 })
  }

  if (action === 'undeploy') {
    const { instanceId } = body as { instanceId: string }
    log(`UNDEPLOY — instanceId="${instanceId}"`)
    if (!instanceId) {
      log('UNDEPLOY — rejected: no instanceId provided')
      return NextResponse.json({ error: 'instanceId required' }, { status: 400 })
    }

    const instance = getModalComfyById(instanceId)
    if (!instance) {
      logError(`UNDEPLOY — instance "${instanceId}" NOT FOUND in JSON file`)
      return NextResponse.json({ error: 'Instance not found' }, { status: 404 })
    }
    log(`UNDEPLOY — found instance: name="${instance.name}", appName="${instance.appName}", status="${instance.status}"`)

    const helperScript = join(process.cwd(), 'scripts', 'modal-helper.py')
    log(`UNDEPLOY — calling modal-helper undeploy for appName="${instance.appName}"...`)
    try {
      const exitCode = await new Promise<number | null>((resolve, reject) => {
        const proc = spawn('python3', [helperScript, 'undeploy', instance.appName], {
          stdio: ['ignore', 'pipe', 'pipe'], timeout: 60_000,
        })
        let stderr = ''
        proc.stderr?.on('data', (d: Buffer) => { stderr += d.toString() })
        proc.on('close', (code) => {
          log(`UNDEPLOY — modal-helper undeploy exited code=${code}${stderr ? `, stderr="${stderr.trim()}"` : ''}`)
          resolve(code)
        })
        proc.on('error', (err) => {
          logError(`UNDEPLOY — modal-helper spawn error:`, err)
          reject(err)
        })
      })
      log(`UNDEPLOY — modal CLI finished with code=${exitCode}`)
    } catch (err) {
      logError(`UNDEPLOY — modal CLI failed (best-effort, continuing):`, err)
    }

    log(`UNDEPLOY — removing instance "${instanceId}" from JSON file`)
    removeModalComfyInstance(instanceId)
    log(`UNDEPLOY — done, returning success`)
    return NextResponse.json({ success: true })
  }

  log(`POST — unknown action="${action}"`)
  return NextResponse.json({ error: 'Invalid action' }, { status: 400 })
}
