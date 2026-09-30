import { BrowserWindow, desktopCapturer, ipcMain, screen, type Display, type NativeImage, type WebContents } from 'electron'
import { listWindows, type NativeWindow } from './windows'
import type { CaptureShowPayload, CaptureWindowRect } from '../shared/api'

interface Overlay {
  win: BrowserWindow
  display: Display
  image: NativeImage | null
  loaded: Promise<void>
}

export interface CaptureHooks {
  preload: string
  loadPage(win: BrowserWindow, page: 'capture'): void
  /** Hide the editor if visible; resolves true if it was hidden. */
  hideEditor(): Promise<boolean>
  restoreEditor(): void
  onCaptured(png: Buffer): void
}

/**
 * Freezes every display, shows a full-screen overlay window per display, and
 * lets the user pick a region, a window, or a whole screen. Overlay windows are
 * kept alive (hidden) between captures so the next capture opens instantly.
 */
export class CaptureManager {
  private overlays = new Map<number, Overlay>()
  private active = false
  private restoreOnCancel = false
  /** Dev-only: finish automatically with this rect on the primary display. */
  private autoFinish: { x: number; y: number; w: number; h: number } | null = null

  constructor(private hooks: CaptureHooks) {
    ipcMain.on('capture:ready', (e) => this.onReady(e.sender))
    ipcMain.on('capture:finish', (e, rect) => this.finish(e.sender, rect))
    screen.on('display-added', () => this.disposeAll())
    screen.on('display-removed', () => this.disposeAll())
    screen.on('display-metrics-changed', () => this.disposeAll())
  }

  prewarm(): void {
    for (const d of screen.getAllDisplays()) this.overlayFor(d)
  }

  async start(hideEditor: boolean, autoFinish: { x: number; y: number; w: number; h: number } | null = null): Promise<void> {
    if (this.active) return
    this.active = true
    this.autoFinish = autoFinish
    try {
      this.restoreOnCancel = hideEditor ? await this.hooks.hideEditor() : false
      const displays = screen.getAllDisplays()
      const windows = listWindows()
      const images = await grabDisplays(displays)
      const cursor = screen.getCursorScreenPoint()
      let shown = 0
      for (const d of displays) {
        const img = images.get(d.id)
        if (!img) continue
        const ov = this.overlayFor(d)
        ov.image = img
        await ov.loaded
        const size = img.getSize()
        const b = d.bounds
        const onThis = cursor.x >= b.x && cursor.x < b.x + b.width && cursor.y >= b.y && cursor.y < b.y + b.height
        const payload: CaptureShowPayload = {
          bitmap: img.toBitmap(),
          width: size.width,
          height: size.height,
          windows: mapWindows(windows, d, size),
          cursor: onThis
            ? { x: ((cursor.x - b.x) * size.width) / b.width, y: ((cursor.y - b.y) * size.height) / b.height }
            : null
        }
        ov.win.webContents.send('capture:show', payload)
        shown++
      }
      if (!shown) throw new Error('No displays could be captured')
    } catch (err) {
      console.error('[capture] failed:', err)
      this.active = false
      if (this.restoreOnCancel) this.hooks.restoreEditor()
    }
  }

  private find(sender: WebContents): Overlay | undefined {
    for (const ov of this.overlays.values()) {
      if (!ov.win.isDestroyed() && ov.win.webContents === sender) return ov
    }
    return undefined
  }

  private onReady(sender: WebContents): void {
    const ov = this.find(sender)
    if (!ov || !this.active) return
    if (this.autoFinish) {
      if (ov.display.id === screen.getPrimaryDisplay().id) this.finish(sender, this.autoFinish)
      return
    }
    ov.win.setBounds(ov.display.bounds)
    ov.win.setAlwaysOnTop(true, 'screen-saver')
    ov.win.show()
    ov.win.setBounds(ov.display.bounds) // re-apply: Windows can mis-size across mixed-DPI displays
    const cursor = screen.getCursorScreenPoint()
    const b = ov.display.bounds
    if (cursor.x >= b.x && cursor.x < b.x + b.width && cursor.y >= b.y && cursor.y < b.y + b.height) {
      ov.win.focus()
    }
  }

  private finish(sender: WebContents, rect: { x: number; y: number; w: number; h: number } | null): void {
    if (!this.active) return
    const ov = this.find(sender)
    let png: Buffer | null = null
    if (ov?.image && rect && rect.w >= 1 && rect.h >= 1) {
      const size = ov.image.getSize()
      const x = Math.max(0, Math.round(rect.x))
      const y = Math.max(0, Math.round(rect.y))
      const w = Math.min(size.width - x, Math.round(rect.w))
      const h = Math.min(size.height - y, Math.round(rect.h))
      if (w > 0 && h > 0) png = ov.image.crop({ x, y, width: w, height: h }).toPNG()
    }
    this.hideAll()
    this.active = false
    if (png) this.hooks.onCaptured(png)
    else if (this.restoreOnCancel) this.hooks.restoreEditor()
  }

  private hideAll(): void {
    for (const ov of this.overlays.values()) {
      if (ov.win.isDestroyed()) continue
      ov.win.webContents.send('capture:hide')
      ov.win.hide()
      ov.image = null
    }
  }

  private disposeAll(): void {
    if (this.active) return
    for (const ov of this.overlays.values()) if (!ov.win.isDestroyed()) ov.win.destroy()
    this.overlays.clear()
  }

  private overlayFor(d: Display): Overlay {
    const existing = this.overlays.get(d.id)
    if (existing && !existing.win.isDestroyed()) {
      const b = existing.display.bounds
      if (b.x === d.bounds.x && b.y === d.bounds.y && b.width === d.bounds.width && b.height === d.bounds.height && existing.display.scaleFactor === d.scaleFactor) {
        return existing
      }
      existing.win.destroy()
    }
    const win = new BrowserWindow({
      ...d.bounds,
      show: false,
      frame: false,
      thickFrame: false,
      resizable: false,
      movable: false,
      minimizable: false,
      maximizable: false,
      fullscreenable: false,
      skipTaskbar: true,
      alwaysOnTop: true,
      hasShadow: false,
      enableLargerThanScreen: true,
      backgroundColor: '#000000',
      webPreferences: {
        preload: this.hooks.preload,
        contextIsolation: true,
        sandbox: true,
        backgroundThrottling: false
      }
    })
    const loaded = new Promise<void>((resolve) => win.webContents.once('did-finish-load', () => resolve()))
    this.hooks.loadPage(win, 'capture')
    const ov: Overlay = { win, display: d, image: null, loaded }
    this.overlays.set(d.id, ov)
    return ov
  }
}

async function grabDisplays(displays: Display[]): Promise<Map<number, NativeImage>> {
  const out = new Map<number, NativeImage>()
  // desktopCapturer scales every thumbnail to one size, so query once per distinct physical size.
  const groups = new Map<string, Display[]>()
  for (const d of displays) {
    const key = `${Math.round(d.bounds.width * d.scaleFactor)}x${Math.round(d.bounds.height * d.scaleFactor)}`
    groups.set(key, [...(groups.get(key) ?? []), d])
  }
  await Promise.all(
    [...groups].map(async ([key, group]) => {
      const [width, height] = key.split('x').map(Number)
      const sources = await desktopCapturer.getSources({ types: ['screen'], thumbnailSize: { width, height } })
      for (const d of group) {
        let src = sources.find((s) => s.display_id === String(d.id))
        if (!src && sources.length === displays.length) src = sources[displays.indexOf(d)]
        if (src && !src.thumbnail.isEmpty()) out.set(d.id, src.thumbnail)
      }
    })
  )
  return out
}

function mapWindows(list: NativeWindow[], d: Display, size: { width: number; height: number }): CaptureWindowRect[] {
  const sx = size.width / d.bounds.width
  const sy = size.height / d.bounds.height
  const b = d.bounds
  const out: CaptureWindowRect[] = []
  for (const w of list) {
    const r =
      process.platform === 'win32'
        ? screen.screenToDipRect(null, { x: w.x, y: w.y, width: w.w, height: w.h })
        : { x: w.x, y: w.y, width: w.w, height: w.h }
    const x0 = Math.max(r.x, b.x)
    const y0 = Math.max(r.y, b.y)
    const x1 = Math.min(r.x + r.width, b.x + b.width)
    const y1 = Math.min(r.y + r.height, b.y + b.height)
    if (x1 - x0 < 4 || y1 - y0 < 4) continue
    out.push({
      x: Math.round((x0 - b.x) * sx),
      y: Math.round((y0 - b.y) * sy),
      w: Math.round((x1 - x0) * sx),
      h: Math.round((y1 - y0) * sy),
      title: w.title
    })
  }
  return out
}
