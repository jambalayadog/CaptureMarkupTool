// The capture library: a folder (default %USERPROFILE%\CaptureMarkupTool\Images) where captures are
// auto-saved, listed newest-first with cached thumbnails for the editor's strip.
//
// If Windows blocks a folder picked in Settings (Controlled Folder Access protects
// Pictures, Documents and Desktop from unrecognised apps), captures go to the
// default folder instead, and both folders are shown in the strip.
import { nativeImage, type NativeImage } from 'electron'
import { existsSync, watch, type FSWatcher } from 'fs'
import { readdir, stat, unlink, writeFile } from 'fs/promises'
import { extname, join, resolve, sep } from 'path'
import type { LibraryItem } from '../shared/api'
import { ensureDir } from './fsutil'

const IMAGE_EXT = new Set(['.png', '.jpg', '.jpeg', '.webp', '.gif', '.bmp'])
const THUMB = { width: 320, height: 200 }

const norm = (p: string): string => resolve(p).toLowerCase()

export interface SaveResult {
  path: string
  /** Set when the chosen folder was blocked and the fallback was used instead. */
  blockedFolder: string | null
}

export class Library {
  private thumbs = new Map<string, string>()
  private watchers = new Map<string, FSWatcher>()
  private debounce: NodeJS.Timeout | null = null

  /**
   * `blocked`/`setBlocked` persist which folder Windows refused, so later
   * launches go straight to the fallback instead of tripping Windows'
   * "Unauthorized changes blocked" notification on every capture.
   */
  constructor(
    private chosen: () => string,
    private fallback: () => string,
    private blocked: () => string,
    private setBlocked: (dir: string) => void,
    private onChange: () => void
  ) {}

  private isBlocked(): boolean {
    const b = this.blocked()
    return !!b && norm(b) === norm(this.chosen())
  }

  /** Folder new captures are saved to. */
  folder(): string {
    return this.isBlocked() ? this.fallback() : this.chosen()
  }

  /** The chosen folder, if Windows is refusing it (captures go to the fallback). */
  blockedFolder(): string | null {
    return this.isBlocked() ? this.chosen() : null
  }

  /** Forget a block (e.g. the user picked a different folder). */
  reset(): void {
    this.setBlocked('')
  }

  /** Test the chosen folder again, e.g. after allowing the app in Windows Security. */
  async retry(): Promise<boolean> {
    const dir = this.chosen()
    const probe = join(dir, '.cmt-write-test')
    try {
      await ensureDir(dir)
      await writeFile(probe, '')
      await unlink(probe)
      this.setBlocked('')
      return true
    } catch {
      this.setBlocked(dir)
      return false
    }
  }

  /** A folder that exists and can be shown: the chosen one, or the fallback if it's blocked. */
  async openable(): Promise<string> {
    try {
      await ensureDir(this.folder())
      return this.folder()
    } catch (err) {
      if (this.isBlocked()) throw err
      this.setBlocked(this.chosen())
      await ensureDir(this.fallback())
      return this.fallback()
    }
  }

  /** Every folder whose captures appear in the strip. */
  private folders(): string[] {
    const dirs = [this.folder()]
    const fb = this.fallback()
    if (norm(fb) !== norm(dirs[0]) && existsSync(fb)) dirs.push(fb)
    return dirs
  }

  async save(png: Buffer, name: string): Promise<SaveResult> {
    try {
      return { path: await this.saveIn(this.folder(), png, name), blockedFolder: null }
    } catch (err) {
      const blocked = this.folder()
      if (this.isBlocked() || norm(blocked) === norm(this.fallback())) throw err
      console.warn('[library] saving to', blocked, 'failed; using the fallback folder:', (err as Error).message)
      this.setBlocked(blocked)
      return { path: await this.saveIn(this.fallback(), png, name), blockedFolder: blocked }
    }
  }

  private async saveIn(dir: string, png: Buffer, name: string): Promise<string> {
    await ensureDir(dir)
    let p = join(dir, `${name}.png`)
    for (let i = 2; existsSync(p) && i < 10000; i++) p = join(dir, `${name} (${i}).png`)
    await writeFile(p, png)
    this.watch()
    return p
  }

  /** True if `p` is inside a library folder (guards destructive IPC calls). */
  contains(p: string): boolean {
    const target = norm(p)
    return this.folders().some((d) => target.startsWith(norm(d) + sep))
  }

  async list(limit = 60): Promise<LibraryItem[]> {
    this.watch()
    const found: { path: string; name: string; mtime: number }[] = []
    for (const dir of this.folders()) {
      let names: string[]
      try {
        names = await readdir(dir)
      } catch {
        continue
      }
      const files = await Promise.all(
        names
          .filter((n) => IMAGE_EXT.has(extname(n).toLowerCase()))
          .map(async (name) => {
            const path = join(dir, name)
            try {
              const s = await stat(path)
              return s.isFile() ? { path, name, mtime: s.mtimeMs } : null
            } catch {
              return null
            }
          })
      )
      for (const f of files) if (f) found.push(f)
    }
    const recent = found.sort((a, b) => b.mtime - a.mtime).slice(0, limit)
    return Promise.all(recent.map(async (f) => ({ ...f, thumb: await this.thumb(f.path, f.mtime) })))
  }

  /** A small image for drag-and-drop feedback. */
  dragIcon(p: string): NativeImage | null {
    for (const [key, url] of this.thumbs) {
      if (key.startsWith(`${p}|`) && url) return nativeImage.createFromDataURL(url).resize({ width: 96 })
    }
    return null
  }

  private async thumb(p: string, mtime: number): Promise<string> {
    const key = `${p}|${mtime}`
    const hit = this.thumbs.get(key)
    if (hit !== undefined) return hit
    let img: NativeImage
    try {
      // Uses the Windows thumbnail cache: far faster than decoding a 4K PNG.
      img = await nativeImage.createThumbnailFromPath(p, THUMB)
    } catch {
      img = nativeImage.createFromPath(p)
    }
    if (img.isEmpty()) img = nativeImage.createFromPath(p)
    let url = ''
    if (!img.isEmpty()) {
      const { width, height } = img.getSize()
      const scale = Math.min(1, THUMB.width / width, THUMB.height / height)
      if (scale < 1) img = img.resize({ width: Math.round(width * scale), height: Math.round(height * scale), quality: 'good' })
      url = `data:image/jpeg;base64,${img.toJPEG(82).toString('base64')}`
    }
    this.thumbs.set(key, url)
    return url
  }

  /** Watch the library folders so saves from anywhere refresh the strip. */
  private watch(): void {
    const dirs = new Set(this.folders().filter((d) => existsSync(d)).map(norm))
    for (const [dir, w] of this.watchers) {
      if (!dirs.has(dir)) {
        w.close()
        this.watchers.delete(dir)
      }
    }
    for (const dir of dirs) {
      if (this.watchers.has(dir)) continue
      try {
        this.watchers.set(
          dir,
          watch(dir, () => {
            if (this.debounce) clearTimeout(this.debounce)
            this.debounce = setTimeout(this.onChange, 300)
          })
        )
      } catch {
        // unwatchable folder: the strip still refreshes on focus
      }
    }
  }
}
