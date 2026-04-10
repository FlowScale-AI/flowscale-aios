import { execFileSync, type ExecFileSyncOptions } from 'child_process'

/**
 * Safe git clone — uses execFileSync (array args, no shell interpolation).
 */
export function safeGitClone(url: string, dest: string, opts?: ExecFileSyncOptions): void {
  execFileSync('git', ['clone', '--depth', '1', url, dest], {
    stdio: 'pipe',
    timeout: 120_000,
    ...opts,
  })
}
