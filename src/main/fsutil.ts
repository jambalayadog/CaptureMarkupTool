import { mkdir, stat } from 'fs/promises'
import { existsSync } from 'fs'
import { basename, dirname } from 'path'

/**
 * `mkdir -p` without Node's recursive mode. On Windows, when Defender's
 * Controlled Folder Access blocks a folder (e.g. under Pictures), the block
 * surfaces as ENOENT, and `mkdir(dir, { recursive: true })` then retries
 * forever on a thread-pool thread — hanging the capture flow and app exit.
 */
export async function ensureDir(dir: string): Promise<void> {
  const missing: string[] = []
  let cur = dir
  for (let depth = 0; depth < 64; depth++) {
    try {
      if ((await stat(cur)).isDirectory()) break
      throw Object.assign(new Error(`${cur} is not a folder`), { code: 'ENOTDIR' })
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err
      missing.push(cur)
      const parent = dirname(cur)
      if (parent === cur) throw err
      cur = parent
    }
  }
  for (const d of missing.reverse()) {
    try {
      await mkdir(d)
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'EEXIST') continue
      throw Object.assign(new Error(blockedMessage(d)), { code: 'EBLOCKED', cause: err })
    }
  }
}

function blockedMessage(target: string): string {
  return (
    `Windows blocked Markup from writing to "${basename(target) || target}". ` +
    'This is usually Controlled folder access (Windows Security > Ransomware protection).'
  )
}

/** A clearer message for failed writes into folders Windows is protecting. */
export function explainWriteError(err: unknown, path: string): string {
  const code = (err as NodeJS.ErrnoException).code
  if ((code === 'ENOENT' || code === 'EPERM' || code === 'EACCES') && existsSync(dirname(path))) {
    return `${blockedMessage(dirname(path))} Allow Markup there, or save somewhere else.`
  }
  return (err as Error).message
}
