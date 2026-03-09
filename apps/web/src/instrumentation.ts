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
  }
}
