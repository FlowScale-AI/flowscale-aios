/**
 * Strip common user-input mistakes from a ComfyUI path string before
 * persisting:
 *   - Trim whitespace and surrounding quotes (copy/paste from terminals or
 *     "Copy as path" on Windows wraps the string in double quotes).
 *   - Drop a trailing `main.py` so the user can paste a path they grabbed
 *     from an error message.
 *   - Drop a trailing path separator.
 *
 * Pure / synchronous so it can be unit tested without filesystem stubs.
 */
export function normalizeComfyPathInput(input: string): string {
  if (!input) return ''
  let s = input.trim()
  // Strip wrapping quotes
  if ((s.startsWith('"') && s.endsWith('"')) || (s.startsWith("'") && s.endsWith("'"))) {
    s = s.slice(1, -1).trim()
  }
  if (!s) return ''
  // Drop trailing main.py — common mistake when copying from a stack trace.
  s = s.replace(/[\\/]+main\.py$/i, '')
  // Drop trailing separator(s)
  s = s.replace(/[\\/]+$/, '')
  return s
}
