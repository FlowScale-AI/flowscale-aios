import { exec } from 'child_process'
import { promisify } from 'util'

const execp = promisify(exec)

/**
 * Returns a map of `port -> owning PID` for all locally-listening TCP sockets.
 * Used to attribute an externally-detected ComfyUI port back to the AIOS-managed
 * process that spawned it (custom launch scripts can pick any port).
 *
 * Cross-platform via `netstat -ano` (Windows) or `lsof` (Unix). Errors are
 * swallowed and yield an empty map rather than throwing — this is best-effort
 * data, never load-bearing.
 */
export async function getListeningPortOwners(): Promise<Map<number, number>> {
  const map = new Map<number, number>()
  try {
    if (process.platform === 'win32') {
      const { stdout } = await execp('netstat -ano -p tcp')
      for (const line of stdout.split(/\r?\n/)) {
        const m = line.match(/^\s*TCP\s+\S*?:(\d+)\s+\S+\s+LISTENING\s+(\d+)\s*$/i)
        if (!m) continue
        const port = Number(m[1])
        const pid = Number(m[2])
        // First match wins — IPv4 typically appears before IPv6 in netstat output
        if (!map.has(port)) map.set(port, pid)
      }
    } else {
      // -nP: numeric ports/addresses; -iTCP -sTCP:LISTEN: only listening TCP
      // -F pn: machine-readable, one field per line: p<pid>\nn<host:port>\n
      const { stdout } = await execp('lsof -nP -iTCP -sTCP:LISTEN -F pn')
      let currentPid: number | null = null
      for (const line of stdout.split('\n')) {
        if (line.startsWith('p')) currentPid = Number(line.slice(1)) || null
        else if (line.startsWith('n') && currentPid != null) {
          const portMatch = line.match(/:(\d+)$/)
          if (portMatch) {
            const port = Number(portMatch[1])
            if (!map.has(port)) map.set(port, currentPid)
          }
        }
      }
    }
  } catch {
    /* best-effort — return whatever we collected */
  }
  return map
}

/**
 * Returns all descendant PIDs of `rootPid` (including the root itself). Used to
 * decide whether a port-owning PID belongs to a process tree we spawned.
 *
 * On Windows uses `wmic` (still present on consumer Win10/11 even though
 * deprecated); falls back to PowerShell `Get-CimInstance` if `wmic` is gone. On
 * Unix uses `ps -axo pid,ppid`. Errors yield a singleton set with just the root.
 */
export async function getProcessDescendants(rootPid: number): Promise<Set<number>> {
  const result = new Set<number>([rootPid])
  const childrenOf = new Map<number, number[]>()

  const addEdge = (pid: number, ppid: number) => {
    if (!Number.isFinite(pid) || !Number.isFinite(ppid) || pid <= 0 || ppid <= 0) return
    if (!childrenOf.has(ppid)) childrenOf.set(ppid, [])
    childrenOf.get(ppid)!.push(pid)
  }

  try {
    if (process.platform === 'win32') {
      let stdout = ''
      try {
        ;({ stdout } = await execp('wmic process get ProcessId,ParentProcessId /format:csv'))
        // Header row: Node,ParentProcessId,ProcessId — skip non-data lines
        for (const line of stdout.split(/\r?\n/)) {
          const cols = line.split(',')
          if (cols.length < 3) continue
          const ppid = Number(cols[1])
          const pid = Number(cols[2])
          addEdge(pid, ppid)
        }
      } catch {
        // wmic missing on newer Windows — fall back to PowerShell
        ;({ stdout } = await execp(
          'powershell -NoProfile -Command "Get-CimInstance Win32_Process | ForEach-Object { \\"$($_.ProcessId),$($_.ParentProcessId)\\" }"',
        ))
        for (const line of stdout.split(/\r?\n/)) {
          const m = line.match(/^(\d+),(\d+)$/)
          if (!m) continue
          addEdge(Number(m[1]), Number(m[2]))
        }
      }
    } else {
      const { stdout } = await execp('ps -axo pid=,ppid=')
      for (const line of stdout.split('\n')) {
        const parts = line.trim().split(/\s+/)
        if (parts.length < 2) continue
        addEdge(Number(parts[0]), Number(parts[1]))
      }
    }
  } catch {
    return result
  }

  // BFS from the root through the parent→children map
  const queue = [rootPid]
  while (queue.length) {
    const p = queue.shift()!
    for (const c of childrenOf.get(p) ?? []) {
      if (!result.has(c)) {
        result.add(c)
        queue.push(c)
      }
    }
  }
  return result
}
