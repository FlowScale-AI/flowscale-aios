export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    const { writeFileSync, appendFileSync, mkdirSync } = await import('fs')
    const { join } = await import('path')
    const { homedir } = await import('os')

    const LOG_DIR = join(homedir(), '.flowscale')
    const LOG_FILE = join(LOG_DIR, 'server-error.log')

    mkdirSync(LOG_DIR, { recursive: true })
    writeFileSync(LOG_FILE, `--- FlowScale server started at ${new Date().toISOString()} ---\n`)

    process.on('uncaughtException', (err) => {
      try {
        appendFileSync(LOG_FILE, `[${new Date().toISOString()}] UNCAUGHT EXCEPTION:\n${err.stack || err}\n\n`)
      } catch { /* ignore write errors */ }
    })

    process.on('unhandledRejection', (reason) => {
      try {
        const msg = reason instanceof Error ? reason.stack || reason.message : String(reason)
        appendFileSync(LOG_FILE, `[${new Date().toISOString()}] UNHANDLED REJECTION:\n${msg}\n\n`)
      } catch { /* ignore write errors */ }
    })

    // Auto-detect GPUs on every server boot. Catches:
    //   - Hardware changes since last run (added/removed GPU, swapped card)
    //   - Index re-orderings (e.g. Windows AMD HIP enumeration vs registry order)
    //   - First-run when ComfyUI's torch finally becomes available and gives
    //     authoritative indexing the registry-only fallback couldn't.
    //
    // Fire-and-forget: detection can take 5-15s when torch spawns. We don't
    // block server startup waiting for it. detectAndUpdateInstances has its
    // own safeguards — preserves customizations, no-ops if nothing changed,
    // keeps existing config if detection returns []. Errors are swallowed
    // here so a detection failure can never crash the server.
    setImmediate(async () => {
      try {
        const { detectAndUpdateInstances } = await import('./lib/comfy-instance-detect')
        const result = detectAndUpdateInstances({ forceClearCache: true })
        const summary = result.changed
          ? `updated ${result.instances.length} instances (${result.gpus.length} GPUs detected)`
          : `no change (${result.gpus.length} GPUs detected${result.warning ? '; warning: ' + result.warning : ''})`
        appendFileSync(LOG_FILE, `[${new Date().toISOString()}] Startup GPU detection: ${summary}\n`)
      } catch (err) {
        try {
          const msg = err instanceof Error ? err.stack || err.message : String(err)
          appendFileSync(LOG_FILE, `[${new Date().toISOString()}] Startup GPU detection failed:\n${msg}\n\n`)
        } catch { /* ignore */ }
      }
    })
  }
}
