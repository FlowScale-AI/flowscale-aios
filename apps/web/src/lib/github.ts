export interface ParsedGitHubUrl {
  owner: string
  repo: string
  branch?: string
  subdir?: string
}

/**
 * Parse a GitHub URL into its components.
 * Supports:
 *   https://github.com/owner/repo
 *   https://github.com/owner/repo/tree/branch
 *   https://github.com/owner/repo/tree/branch/subdir/path
 */
export function parseGitHubUrl(url: string): ParsedGitHubUrl | null {
  const match = url
    .trim()
    .match(
      /^https?:\/\/github\.com\/([^/]+)\/([^/]+?)(?:\.git)?(?:\/tree\/([^/]+)(?:\/(.+))?)?$/,
    )
  if (!match) return null
  return {
    owner: match[1],
    repo: match[2],
    branch: match[3] || undefined,
    subdir: match[4] || undefined,
  }
}
