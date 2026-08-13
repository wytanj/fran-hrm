// Git identity of the working tree (or the host's commit env on Vercel).
// Stored on each schema version so HQ can see which commit is in force.
import { execSync } from 'node:child_process'

export function readGitMeta(cwd = process.cwd()) {
  try {
    const sha = execSync('git rev-parse HEAD', { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim()
    const dirty = execSync('git status --porcelain', { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim().length > 0
    let describe = sha.slice(0, 12)
    try {
      describe = execSync('git describe --tags --always', { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim()
    } catch { /* no tags is fine */ }
    if (dirty) describe = `${describe}-dirty`
    return { sha, dirty, describe, source: 'git' }
  } catch {
    const sha = (process.env.VERCEL_GIT_COMMIT_SHA || process.env.GITHUB_SHA || '').trim() || null
    return { sha, dirty: false, describe: sha ? sha.slice(0, 12) : null, source: sha ? 'env' : 'unknown' }
  }
}
