import type { OpenedFile } from '../../../shared/api'
import { TOOLS } from '../tools'
import { applyTransform } from '../tools/transform'
import type { PointerInfo, Tool } from '../tools/types'
import { ACCENT, DEFAULT_OPTIONS, PAINT_TOOLS, SELECT_TOOLS, TOOL_KEYS, VECTOR_TOOLS, ZOOM_STEPS } from './constants'
import {
  createDoc,
  layerBounds,
  rasterLayer,
  redo as redoDoc,
  restore,
  snapshot,
  undo as undoDoc,
  vectorLayer,
  type DocState,
  type Patch,
  type Snapshot
} from './doc'
import { applyFilter, mergeDown } from './imageOps'
import { canvasToBlob, decodeImage, decodeProject, encodeDoc, isProjectBytes } from './io'
import {
  fontOf,
  handlesOf,
  HANDLE_CURSORS,
  hitObject,
  objBounds,
  offsetObject,
  setObjectColor,
  textLayout,
  type Handle
} from './objects'
import * as platform from './platform'
import { flattenDoc, renderDoc } from './render'
import { clearInside, clipSel, combine, invertSel, keepInside, outline, rectSel } from './selection'
import type {
  Layer,
  RasterLayer,
  Rect,
  Selection,
  SelectMode,
  TextObj,
  ToolId,
  ToolOptions,
  VObj,
  Vec,
  VectorLayer
} from './types'
import {
  clamp,
  contrastText,
  ctx2d,
  intersect,
  makeCanvas,
  normalizeHex,
  pixelRect,
  scratch,
  uid,
  union
} from './util'

export type DialogKind = 'new' | 'resize' | 'canvasSize' | 'adjust' | 'settings' | 'shortcuts' | 'about'

interface TextEditState {
  id: string
  before: Snapshot
  isNew: boolean
}

const WORKSPACE = '#121316'

const stripExt = (name: string): string => name.replace(/\.[a-z0-9]+$/i, '')

/** Raster edit in progress: records a pixel patch for undo when committed. */
export class RasterEdit {
  private dirty: Rect | null = null
  constructor(
    private ed: Editor,
    readonly layer: RasterLayer,
    private before: Snapshot,
    private backup: HTMLCanvasElement
  ) {}

  /** Mark a region (layer coordinates) as changed. */
  mark(r: Rect): void {
    this.dirty = union(this.dirty, r)
  }

  commit(label: string): void {
    const l = this.layer
    const r = this.dirty && intersect(pixelRect(this.dirty), { x: 0, y: 0, w: l.canvas.width, h: l.canvas.height })
    const patches: Patch[] = []
    if (r) {
      patches.push({
        layerId: l.id,
        x: r.x,
        y: r.y,
        before: ctx2d(this.backup).getImageData(r.x, r.y, r.w, r.h),
        after: ctx2d(l.canvas).getImageData(r.x, r.y, r.w, r.h)
      })
    }
    this.ed.commit(label, this.before, patches)
  }

  /** Throw the edit away, restoring the original pixels. */
  cancel(): void {
    const c = ctx2d(this.layer.canvas)
    c.clearRect(0, 0, this.layer.canvas.width, this.layer.canvas.height)
    c.drawImage(this.backup, 0, 0)
    this.ed.invalidate()
  }
}

export class Editor {
  docs: DocState[] = []
  d: DocState | null = null
  tool: ToolId = 'arrow'
  /** Tool to return to after a temporary one (free transform). */
  previousTool: ToolId = 'select'
  opts: ToolOptions = { ...DEFAULT_OPTIONS }
  primary = '#ff3b30'
  secondary = '#ffffff'
  highlightColor = '#ffe14d'
  recent: string[] = []
  palette = 'Default'
  showGrid = true
  /** The mouse wheel zooms (a setting); otherwise it scrolls and Ctrl+wheel zooms. */
  wheelZooms = true
  dialog: DialogKind | null = null
  toast: { id: number; text: string; sticky: boolean } | null = null
  textEdit: TextEditState | null = null
  textArea: HTMLTextAreaElement | null = null
  version = 0
  cursor: Vec | null = null
  spaceHeld = false

  canvas: HTMLCanvasElement | null = null
  vw = 0
  vh = 0
  dpr = 1

  private listeners = new Set<() => void>()
  private cursorListeners = new Set<() => void>()
  private vctx: CanvasRenderingContext2D | null = null
  private frame = 0
  private checker: CanvasPattern | null = null
  private panning: { x: number; y: number; panX: number; panY: number } | null = null
  private dragTool: Tool | null = null
  private antsTimer = 0
  private toastTimer = 0
  private objectClipboard: VObj[] | null = null
  private clipboardToken = ''
  private lastDirty = false
  private untitled = 0
  private altHeld = false

  // ---- subscriptions -----------------------------------------------------------

  subscribe = (fn: () => void): (() => void) => {
    this.listeners.add(fn)
    return () => this.listeners.delete(fn)
  }
  subscribeCursor = (fn: () => void): (() => void) => {
    this.cursorListeners.add(fn)
    return () => this.cursorListeners.delete(fn)
  }
  getVersion = (): number => this.version

  emit(): void {
    this.version++
    for (const fn of this.listeners) fn()
    const dirty = this.docs.some((d) => d.history.dirty)
    if (dirty !== this.lastDirty) {
      this.lastDirty = dirty
      platform.api?.setDirty(dirty)
    }
  }

  /** Document content changed: recomposite, redraw, and refresh the UI. */
  changed(): void {
    if (this.d) this.d.compDirty = true
    this.requestRender()
    this.emit()
  }

  /** Document content changed during an interaction: recomposite and redraw only. */
  invalidate(): void {
    if (this.d) this.d.compDirty = true
    this.requestRender()
  }

  /**
   * Show a message at the bottom of the window. Quick confirmations fade after
   * `ms`; pass `'sticky'` for anything the user needs time to read (warnings,
   * errors) so it stays until they close it.
   */
  notify(text: string, ms: number | 'sticky' = 2400): void {
    const sticky = ms === 'sticky'
    this.toast = { id: Date.now(), text, sticky }
    clearTimeout(this.toastTimer)
    if (!sticky) this.toastTimer = window.setTimeout(() => this.dismissToast(), ms)
    this.emit()
  }

  /** Explain why something didn't happen. Stays up until the user closes it. */
  warn(text: string): void {
    this.notify(text, 'sticky')
  }

  dismissToast(): void {
    clearTimeout(this.toastTimer)
    this.toast = null
    this.emit()
  }

  showDialog(k: DialogKind | null): void {
    if (this.textEdit) this.endTextEdit()
    this.dialog = k
    this.emit()
  }

  // ---- documents -----------------------------------------------------------------

  addDoc(d: DocState): void {
    this.docs.push(d)
    this.activate(d.id)
  }

  activate(id: string): void {
    if (this.textEdit) this.endTextEdit()
    if (this.d?.live.transform) applyTransform(this)
    this.toolImpl.cancel?.(this)
    this.d = this.docs.find((x) => x.id === id) ?? null
    if (this.d && !this.d.viewReady && this.vw) this.fit()
    this.updateAnts()
    this.changed()
  }

  newDocument(w: number, h: number, bg: string | null): void {
    const c = makeCanvas(w, h)
    if (bg) {
      const x = ctx2d(c)
      x.fillStyle = bg
      x.fillRect(0, 0, w, h)
    }
    this.addDoc(createDoc(c.width, c.height, `Untitled ${++this.untitled}`, [rasterLayer(bg ? 'Background' : 'Layer 1', c)]))
  }

  openCanvas(c: HTMLCanvasElement, name: string, opts: { path?: string | null; kind?: DocState['fileKind']; layerName?: string } = {}): void {
    const d = createDoc(c.width, c.height, stripExt(name), [rasterLayer(opts.layerName ?? 'Background', c)])
    d.filePath = opts.path ?? null
    d.fileKind = opts.path ? (opts.kind ?? null) : null
    this.addDoc(d)
  }

  async openFiles(files: OpenedFile[]): Promise<void> {
    for (const f of files) {
      try {
        if (f.name.toLowerCase().endsWith('.imk') || isProjectBytes(f.bytes)) {
          const p = await decodeProject(f.bytes)
          const d = createDoc(p.width, p.height, stripExt(f.name), p.layers)
          d.activeLayerId = p.layers[p.activeIndex]?.id ?? d.activeLayerId
          d.filePath = f.path
          d.fileKind = f.path ? 'imk' : null
          this.addDoc(d)
        } else {
          this.openCanvas(await decodeImage(f.bytes), f.name, { path: f.path, kind: platform.kindFromName(f.name) })
        }
      } catch (err) {
        console.error(err)
        this.warn(`Couldn't open ${f.name}`)
      }
    }
  }

  async openFilesDialog(): Promise<void> {
    await this.openFiles(await platform.pickFiles())
  }

  closeDoc(id: string): void {
    const d = this.docs.find((x) => x.id === id)
    if (!d) return
    if (d.history.dirty && !window.confirm(`"${d.name}" has unsaved changes. Close it anyway?`)) return
    if (this.d === d && this.textEdit) this.endTextEdit()
    const i = this.docs.indexOf(d)
    this.docs.splice(i, 1)
    if (this.d === d) {
      const next = this.docs[Math.min(i, this.docs.length - 1)]
      this.d = null
      if (next) this.activate(next.id)
    }
    this.changed()
  }

  async save(saveAs = false): Promise<void> {
    const d = this.d
    if (!d) return
    if (this.textEdit) this.endTextEdit()
    let target: platform.SaveTarget | null
    if (!saveAs && d.fileKind && (d.filePath || d.fileHandle)) {
      target = { path: d.filePath, handle: d.fileHandle, name: `${d.name}.${d.fileKind}`, kind: d.fileKind }
    } else {
      // Start where the file already lives (the main process defaults to the capture library).
      target = await platform.chooseSaveTarget(d.filePath ?? `${d.name}.${d.fileKind ?? 'png'}`, d.fileKind ?? 'png')
      if (!target) return
    }
    try {
      await platform.writeTarget(target, await encodeDoc(d, target.kind))
    } catch (err) {
      console.error(err)
      // IPC errors arrive as "Error invoking remote method '…': Error: <message>"
      const msg = (err as Error).message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '')
      this.warn(`Couldn't save: ${msg}`)
      return
    }
    if (target.path || target.handle) {
      d.filePath = target.path
      d.fileHandle = target.handle
      d.fileKind = target.kind
      d.name = stripExt(target.name)
    }
    d.history.markSaved()
    const layered = d.layers.length > 1 || d.layers.some((l) => l.kind === 'vector')
    this.notify(
      layered && target.kind !== 'imk' ? `Saved ${target.name} (flattened; save as .imk to keep layers)` : `Saved ${target.name}`,
      layered && target.kind !== 'imk' ? 5000 : 2400
    )
  }

  // ---- history --------------------------------------------------------------------

  snapshot(): Snapshot {
    return snapshot(this.d!)
  }

  /** Record an undoable step from `before` to the current state. */
  commit(label: string, before: Snapshot, patches: Patch[] = [], mergeKey?: string): void {
    const d = this.d
    if (!d) return
    // Any other edit invalidates an unapplied free transform (it previews stale pixels).
    d.live.transform = null
    const h = d.history
    const last = h.entries[h.index - 1]
    const now = performance.now()
    if (
      mergeKey &&
      last &&
      last.mergeKey === mergeKey &&
      now - (last.time ?? 0) < 1200 &&
      h.index === h.entries.length &&
      h.savedIndex !== h.index &&
      !patches.length &&
      !last.patches.length
    ) {
      last.after = snapshot(d)
      last.time = now
    } else {
      h.push({ label, before, after: snapshot(d), patches, mergeKey, time: now })
    }
    this.changed()
  }

  undo(): void {
    if (!this.d || this.dragTool) return
    if (this.textEdit) this.endTextEdit()
    if (this.toolImpl.undo?.(this)) return
    this.toolImpl.cancel?.(this)
    if (undoDoc(this.d)) this.afterHistoryJump()
  }

  redo(): void {
    if (!this.d || this.dragTool) return
    if (this.textEdit) this.endTextEdit()
    const transforming = !!this.d.live.transform
    this.toolImpl.cancel?.(this)
    if (transforming) return
    if (redoDoc(this.d)) this.afterHistoryJump()
  }

  private afterHistoryJump(): void {
    const d = this.d!
    if (d.selection) d.selection = clipSel(d.selection, d.width, d.height)
    this.updateAnts()
    this.changed()
  }

  beginRasterEdit(l: RasterLayer, before?: Snapshot): RasterEdit {
    const d = this.d!
    const snap = before ?? snapshot(d)
    this.ensureCovers(l, { x: 0, y: 0, w: d.width, h: d.height })
    const backup = scratch('raster-backup', l.canvas.width, l.canvas.height)
    ctx2d(backup).drawImage(l.canvas, 0, 0)
    return new RasterEdit(this, l, snap, backup)
  }

  /** Grow a raster layer's canvas so it covers `r` (doc coords). Returns true if it grew. */
  ensureCovers(l: RasterLayer, r: Rect): boolean {
    const b = layerBounds(l)
    if (r.x >= b.x && r.y >= b.y && r.x + r.w <= b.x + b.w && r.y + r.h <= b.y + b.h) return false
    const u = union(b, r)
    const c = makeCanvas(u.w, u.h)
    ctx2d(c).drawImage(l.canvas, l.x - u.x, l.y - u.y)
    l.canvas = c
    l.x = u.x
    l.y = u.y
    return true
  }

  // ---- layers ---------------------------------------------------------------------

  activeLayer(): Layer | null {
    const d = this.d
    return d?.layers.find((l) => l.id === d.activeLayerId) ?? null
  }

  layer(id: string): Layer | null {
    return this.d?.layers.find((l) => l.id === id) ?? null
  }

  setActiveLayer(id: string): void {
    if (!this.d) return
    this.d.activeLayerId = id
    this.emit()
  }

  uniqueName(base: string): string {
    const names = new Set(this.d?.layers.map((l) => l.name))
    if (!names.has(base)) return base
    for (let i = 2; ; i++) if (!names.has(`${base} ${i}`)) return `${base} ${i}`
  }

  private nextLayerName(): string {
    const names = new Set(this.d?.layers.map((l) => l.name))
    for (let i = 1; ; i++) if (!names.has(`Layer ${i}`)) return `Layer ${i}`
  }

  /** Insert above the active layer and make it active (no history). */
  insertLayer(l: Layer, index?: number): void {
    const d = this.d!
    const i = index ?? d.layers.findIndex((x) => x.id === d.activeLayerId) + 1
    d.layers.splice(clamp(i, 0, d.layers.length), 0, l)
    d.activeLayerId = l.id
  }

  addRasterLayer(): void {
    if (!this.d) return
    const before = this.snapshot()
    this.insertLayer(rasterLayer(this.nextLayerName(), makeCanvas(this.d.width, this.d.height)))
    this.commit('New layer', before)
  }

  addVectorLayer(): void {
    if (!this.d) return
    const before = this.snapshot()
    this.insertLayer(vectorLayer(this.uniqueName('Annotations')))
    this.commit('New annotation layer', before)
  }

  deleteLayer(id: string): void {
    const d = this.d
    if (!d) return
    if (d.layers.length <= 1) return this.warn("Can't delete the only layer")
    const i = d.layers.findIndex((l) => l.id === id)
    if (i < 0) return
    const before = this.snapshot()
    d.layers.splice(i, 1)
    if (d.activeLayerId === id) d.activeLayerId = d.layers[Math.max(0, i - 1)].id
    this.commit('Delete layer', before)
  }

  duplicateLayer(id: string): void {
    const d = this.d
    const l = this.layer(id)
    if (!d || !l) return
    const before = this.snapshot()
    const copy: Layer =
      l.kind === 'raster'
        ? { ...l, id: uid(), name: this.uniqueName(`${l.name} copy`), canvas: cloneOf(l.canvas) }
        : { ...l, id: uid(), name: this.uniqueName(`${l.name} copy`), objects: l.objects.map((o) => ({ ...structuredClone(o), id: uid() })) }
    this.insertLayer(copy, d.layers.indexOf(l) + 1)
    this.commit('Duplicate layer', before)
  }

  moveLayer(id: string, to: number): void {
    const d = this.d
    if (!d) return
    const i = d.layers.findIndex((l) => l.id === id)
    to = clamp(to, 0, d.layers.length - 1)
    if (i < 0 || i === to) return
    const before = this.snapshot()
    const [l] = d.layers.splice(i, 1)
    d.layers.splice(to, 0, l)
    this.commit('Reorder layers', before)
  }

  /** Change layer properties. Pass `live` while dragging a slider; commit on release. */
  setLayerProps(id: string, patch: Partial<Pick<Layer, 'name' | 'visible' | 'opacity' | 'blend' | 'locked'>>, mergeKey?: string): void {
    const l = this.layer(id)
    if (!l) return
    const before = this.snapshot()
    Object.assign(l, patch)
    this.commit('Layer properties', before, [], mergeKey)
  }

  /** Vector layer for a new annotation: the active one, the one right above it, or a new one. */
  ensureVectorLayer(): VectorLayer {
    const d = this.d!
    const a = this.activeLayer()
    if (a?.kind === 'vector' && !a.locked && a.visible) return a
    const i = a ? d.layers.indexOf(a) : d.layers.length - 1
    const above = d.layers[i + 1]
    if (above?.kind === 'vector' && !above.locked && above.visible) {
      d.activeLayerId = above.id
      return above
    }
    const l = vectorLayer(this.uniqueName('Annotations'))
    this.insertLayer(l, i + 1)
    return l
  }

  /** Raster layer to paint on: the active one, or a new one above it. */
  ensureRasterLayer(): { layer: RasterLayer; created: boolean } {
    const d = this.d!
    const a = this.activeLayer()
    if (a?.kind === 'raster' && !a.locked && a.visible) return { layer: a, created: false }
    const i = a ? d.layers.indexOf(a) : d.layers.length - 1
    const l = rasterLayer(this.nextLayerName(), makeCanvas(d.width, d.height))
    this.insertLayer(l, i + 1)
    return { layer: l, created: true }
  }

  // ---- objects --------------------------------------------------------------------

  findObject(id: string): { layer: VectorLayer; obj: VObj; index: number } | null {
    for (const layer of this.d?.layers ?? []) {
      if (layer.kind !== 'vector') continue
      const index = layer.objects.findIndex((o) => o.id === id)
      if (index >= 0) return { layer, obj: layer.objects[index], index }
    }
    return null
  }

  selectedObjects(): VObj[] {
    const out: VObj[] = []
    for (const id of this.d?.selectedIds ?? []) {
      const f = this.findObject(id)
      if (f) out.push(f.obj)
    }
    return out
  }

  select(ids: string[]): void {
    if (!this.d) return
    this.d.selectedIds = ids
    if (ids.length === 1) {
      const f = this.findObject(ids[0])
      if (f) this.opts = { ...this.opts, ...optsFromObject(f.obj) }
    }
    this.requestRender()
    this.emit()
  }

  /** Topmost object under `p` in visible, unlocked vector layers. */
  hitTest(p: Vec): { layer: VectorLayer; obj: VObj } | null {
    const d = this.d
    if (!d) return null
    const tol = 5 / d.view.zoom
    for (let i = d.layers.length - 1; i >= 0; i--) {
      const layer = d.layers[i]
      if (layer.kind !== 'vector' || !layer.visible || layer.locked) continue
      for (let j = layer.objects.length - 1; j >= 0; j--) {
        const obj = layer.objects[j]
        if (hitObject(obj, p, tol)) return { layer, obj }
      }
    }
    return null
  }

  /** Handle of the (single) selected object under a screen point. */
  hitHandle(screen: Vec): { obj: VObj; handle: Handle } | null {
    const d = this.d
    if (!d || d.selectedIds.length !== 1) return null
    const f = this.findObject(d.selectedIds[0])
    if (!f) return null
    for (const h of handlesOf(f.obj)) {
      const s = this.toScreen(h)
      if (Math.abs(s.x - screen.x) <= 7 && Math.abs(s.y - screen.y) <= 7) return { obj: f.obj, handle: h }
    }
    return null
  }

  handleCursor(screen: Vec): string | null {
    const h = this.hitHandle(screen)
    return h ? HANDLE_CURSORS[h.handle.id] : null
  }

  /** Topmost opaque pixel of a movable raster layer (never the bottom layer). */
  hitRaster(p: Vec): RasterLayer | null {
    const d = this.d
    if (!d) return null
    for (let i = d.layers.length - 1; i >= 1; i--) {
      const l = d.layers[i]
      if (l.kind !== 'raster' || !l.visible || l.locked) continue
      const x = Math.floor(p.x - l.x)
      const y = Math.floor(p.y - l.y)
      if (x < 0 || y < 0 || x >= l.canvas.width || y >= l.canvas.height) continue
      if (ctx2d(l.canvas).getImageData(x, y, 1, 1).data[3] > 16) return l
    }
    return null
  }

  updateSelected(fn: (o: VObj) => void, label: string, mergeKey?: string): void {
    const sel = this.selectedObjects()
    if (!sel.length) return
    const before = this.snapshot()
    sel.forEach(fn)
    this.commit(label, before, [], mergeKey)
  }

  deleteSelection(): void {
    const d = this.d
    if (!d) return
    if (d.selectedIds.length) {
      const before = this.snapshot()
      const ids = new Set(d.selectedIds)
      for (const l of d.layers) if (l.kind === 'vector') l.objects = l.objects.filter((o) => !ids.has(o.id))
      d.selectedIds = []
      this.commit('Delete', before)
      return
    }
    if (d.selection) this.clearSelectionPixels()
  }

  duplicateSelected(): void {
    const d = this.d
    if (!d || !d.selectedIds.length) return
    const before = this.snapshot()
    const ids: string[] = []
    for (const l of d.layers) {
      if (l.kind !== 'vector') continue
      const out: VObj[] = []
      for (const o of l.objects) {
        out.push(o)
        if (d.selectedIds.includes(o.id)) {
          const c = { ...structuredClone(o), id: uid() }
          offsetObject(c, 12, 12)
          out.push(c)
          ids.push(c.id)
        }
      }
      l.objects = out
    }
    d.selectedIds = ids
    this.commit('Duplicate', before)
  }

  nudge(dx: number, dy: number): void {
    const d = this.d
    if (!d) return
    if (d.selectedIds.length) {
      this.updateSelected((o) => offsetObject(o, dx, dy), 'Nudge', 'nudge')
      return
    }
    const l = this.activeLayer()
    if (l?.kind === 'raster' && !l.locked) {
      const before = this.snapshot()
      l.x += dx
      l.y += dy
      this.commit('Nudge layer', before, [], 'nudge-layer')
    }
  }

  arrange(dir: 'forward' | 'backward' | 'front' | 'back'): void {
    const d = this.d
    if (!d || !d.selectedIds.length) return
    const before = this.snapshot()
    for (const l of d.layers) {
      if (l.kind !== 'vector') continue
      const sel = l.objects.filter((o) => d.selectedIds.includes(o.id))
      if (!sel.length) continue
      const rest = l.objects.filter((o) => !d.selectedIds.includes(o.id))
      if (dir === 'front') l.objects = [...rest, ...sel]
      else if (dir === 'back') l.objects = [...sel, ...rest]
      else {
        const arr = [...l.objects]
        const order = dir === 'forward' ? [...arr.keys()].reverse() : [...arr.keys()]
        for (const i of order) {
          if (!d.selectedIds.includes(arr[i].id)) continue
          const j = dir === 'forward' ? i + 1 : i - 1
          if (j < 0 || j >= arr.length || d.selectedIds.includes(arr[j].id)) continue
          ;[arr[i], arr[j]] = [arr[j], arr[i]]
        }
        l.objects = arr
      }
    }
    this.commit('Arrange', before)
  }

  nextStepNumber(): number {
    if (this.d?.stepNext != null) return this.d.stepNext
    let n = 0
    for (const l of this.d?.layers ?? []) if (l.kind === 'vector') for (const o of l.objects) if (o.type === 'step') n = Math.max(n, o.n)
    return n + 1
  }

  /** Choose the next step's number (1 restarts the count). Undoable. */
  setStepNext(n: number): void {
    const d = this.d
    if (!d) return
    const before = this.snapshot()
    d.stepNext = null
    // back to automatic when it's what automatic would give anyway
    d.stepNext = n === this.nextStepNumber() ? null : Math.max(1, Math.round(n))
    this.commit('Step numbering', before, [], 'step-next')
  }

  // ---- text editing ----------------------------------------------------------------

  startTextEdit(id: string, before: Snapshot, isNew: boolean): void {
    if (!this.d) return
    this.textEdit = { id, before, isNew }
    this.d.live.editingTextId = id
    this.d.selectedIds = [id]
    const f = this.findObject(id)
    if (f) this.opts = { ...this.opts, ...optsFromObject(f.obj) }
    this.changed()
  }

  endTextEdit(): void {
    const te = this.textEdit
    const d = this.d
    if (!te || !d) return
    this.textEdit = null
    d.live.editingTextId = null
    const f = this.findObject(te.id)
    if (f && f.obj.type === 'text' && !f.obj.text.trim()) {
      if (te.isNew) {
        restore(d, te.before)
        d.selectedIds = []
        this.changed()
        return
      }
      f.layer.objects.splice(f.index, 1)
      d.selectedIds = []
    }
    const prev = te.before.layers.flatMap((l) => (l.kind === 'vector' ? l.objects : [])).find((o) => o.id === te.id)
    const now = f?.obj
    if (!te.isNew && prev && now && JSON.stringify(prev) === JSON.stringify(now)) {
      this.changed()
      return
    }
    this.commit(te.isNew ? 'Add text' : 'Edit text', te.before)
  }

  editingTextObj(): TextObj | null {
    if (!this.textEdit) return null
    const f = this.findObject(this.textEdit.id)
    return f?.obj.type === 'text' ? f.obj : null
  }

  // ---- pixel selection ---------------------------------------------------------------

  /** Replace the selection. A plain rectangle is snapped to whole pixels. */
  setSelection(s: Rect | Selection | null): void {
    const d = this.d
    if (!d) return
    const sel = s && ('mask' in s ? s : rectSel(pixelRect(s)))
    d.selection = sel ? clipSel(sel, d.width, d.height) : null
    this.updateAnts()
    this.requestRender()
    this.emit()
  }

  /** Merge a new selection into the current one. */
  applySelection(s: Selection | null, mode: SelectMode): void {
    this.setSelection(combine(this.d?.selection ?? null, s, mode))
  }

  /** Selection mode for a pointer press: Shift adds, Alt subtracts, both intersect. */
  selectModeFor(p: { shift: boolean; alt: boolean }): SelectMode {
    if (p.shift && p.alt) return 'intersect'
    if (p.shift) return 'add'
    if (p.alt) return 'subtract'
    return this.opts.selectMode
  }

  invertSelection(): void {
    const d = this.d
    if (!d) return
    this.setSelection(invertSel(d.selection, d.width, d.height))
  }

  private updateAnts(): void {
    const want = !!this.d?.selection
    if (want && !this.antsTimer) this.antsTimer = window.setInterval(() => this.requestRender(), 120)
    if (!want && this.antsTimer) {
      clearInterval(this.antsTimer)
      this.antsTimer = 0
    }
  }

  selectAll(): void {
    const d = this.d
    if (!d) return
    if (this.tool === 'select') {
      const ids: string[] = []
      for (const l of d.layers) if (l.kind === 'vector' && l.visible && !l.locked) ids.push(...l.objects.map((o) => o.id))
      this.select(ids)
    } else this.setSelection({ x: 0, y: 0, w: d.width, h: d.height })
  }

  deselect(): void {
    const d = this.d
    if (!d) return
    d.selectedIds = []
    this.setSelection(null)
  }

  clearSelectionPixels(): void {
    const d = this.d
    const l = this.activeLayer()
    if (!d?.selection || l?.kind !== 'raster') return
    if (l.locked) return this.warn('Layer is locked')
    const s = d.selection
    const edit = this.beginRasterEdit(l)
    clearInside(l.canvas, s, l.x, l.y)
    edit.mark({ x: s.x - l.x, y: s.y - l.y, w: s.w, h: s.h })
    edit.commit('Clear')
  }

  fillSelection(color = this.primary): void {
    const d = this.d
    if (!d) return
    const before = this.snapshot()
    const { layer } = this.ensureRasterLayer()
    const edit = this.beginRasterEdit(layer, before)
    const s = d.selection ?? rectSel({ x: 0, y: 0, w: d.width, h: d.height })
    const patch = makeCanvas(s.w, s.h)
    const p = ctx2d(patch)
    p.fillStyle = color
    p.fillRect(0, 0, s.w, s.h)
    keepInside(patch, s, s.x, s.y)
    ctx2d(layer.canvas).drawImage(patch, s.x - layer.x, s.y - layer.y)
    edit.mark({ x: s.x - layer.x, y: s.y - layer.y, w: s.w, h: s.h })
    edit.commit('Fill')
  }

  // ---- clipboard -------------------------------------------------------------------

  async copy(cut = false): Promise<void> {
    const d = this.d
    if (!d) return
    if (d.selectedIds.length) {
      this.objectClipboard = structuredClone(this.selectedObjects())
      this.clipboardToken = uid()
      await navigator.clipboard.writeText(`markup-objects:${this.clipboardToken}`).catch(() => undefined)
      if (cut) this.deleteSelection()
      this.notify(`${cut ? 'Cut' : 'Copied'} ${this.objectClipboard.length} object${this.objectClipboard.length > 1 ? 's' : ''}`)
      return
    }
    const l = this.activeLayer()
    if (d.selection && l?.kind === 'raster') {
      const s = d.selection
      const c = makeCanvas(s.w, s.h)
      ctx2d(c).drawImage(l.canvas, l.x - s.x, l.y - s.y)
      keepInside(c, s, s.x, s.y)
      await platform.copyPng(await canvasToBlob(c))
      if (cut) this.clearSelectionPixels()
      this.notify(cut ? 'Cut selection' : 'Copied selection')
      return
    }
    await this.copyMerged()
  }

  /** Copy the flattened image (or the selected area of it). */
  async copyMerged(): Promise<void> {
    const d = this.d
    if (!d) return
    if (this.textEdit) this.endTextEdit()
    const flat = flattenDoc(d)
    const s = d.selection
    let out = flat
    if (s) {
      out = makeCanvas(s.w, s.h)
      ctx2d(out).drawImage(flat, -s.x, -s.y)
      keepInside(out, s, s.x, s.y)
    }
    try {
      await platform.copyPng(await canvasToBlob(out))
      this.notify(s ? 'Copied selection (merged)' : 'Copied image to clipboard')
    } catch (err) {
      console.error(err)
      this.warn("Couldn't access the clipboard")
    }
  }

  async pasteBlob(blob: Blob, name = 'Pasted image'): Promise<void> {
    try {
      this.pasteCanvas(await decodeImage(blob), name)
    } catch {
      this.warn("Clipboard image couldn't be read")
    }
  }

  pasteCanvas(c: HTMLCanvasElement, name = 'Pasted image'): void {
    const d = this.d
    if (!d) return this.openCanvas(c, name)
    const before = this.snapshot()
    let x: number
    let y: number
    if (d.selection) {
      x = d.selection.x
      y = d.selection.y
    } else {
      const center = this.toDoc(this.vw / 2, this.vh / 2)
      x = Math.round(clamp(center.x, 0, d.width) - c.width / 2)
      y = Math.round(clamp(center.y, 0, d.height) - c.height / 2)
      if (c.width >= d.width) x = 0
      if (c.height >= d.height) y = 0
    }
    this.insertLayer(rasterLayer(this.uniqueName(name === 'Pasted image' ? 'Pasted' : name), c, x, y))
    d.selectedIds = []
    this.commit('Paste', before)
    this.setTool('select')
  }

  pasteObjects(): void {
    const d = this.d
    if (!d || !this.objectClipboard?.length) return
    const before = this.snapshot()
    const layer = this.ensureVectorLayer()
    this.objectClipboard.forEach((o) => offsetObject(o, 12, 12))
    const clones = this.objectClipboard.map((o) => ({ ...structuredClone(o), id: uid() }))
    layer.objects.push(...clones)
    d.selectedIds = clones.map((o) => o.id)
    this.commit('Paste', before)
  }

  async handlePaste(e: ClipboardEvent): Promise<void> {
    const dt = e.clipboardData
    if (!dt) return
    const text = dt.getData('text/plain')
    if (this.objectClipboard && text === `markup-objects:${this.clipboardToken}`) {
      e.preventDefault()
      return this.pasteObjects()
    }
    for (const item of Array.from(dt.items)) {
      if (item.kind === 'file' && item.type.startsWith('image/')) {
        const f = item.getAsFile()
        if (f) {
          e.preventDefault()
          return this.pasteBlob(f)
        }
      }
    }
    const blob = await platform.readClipboardImage()
    if (blob) return this.pasteBlob(blob)
  }

  async pasteFromClipboard(): Promise<void> {
    const text = await navigator.clipboard.readText().catch(() => '')
    if (this.objectClipboard && text === `markup-objects:${this.clipboardToken}`) return this.pasteObjects()
    const blob = await platform.readClipboardImage()
    if (blob) return this.pasteBlob(blob)
    this.warn('Nothing to paste')
  }

  // ---- colours & options -------------------------------------------------------------

  pushRecent(c: string): void {
    this.recent = [c, ...this.recent.filter((x) => x !== c)].slice(0, 12)
  }

  setPrimary(c: string, applyToSelection = true): void {
    c = normalizeHex(c)
    this.primary = c
    if (applyToSelection && this.d?.selectedIds.length && !this.textEdit) {
      this.updateSelected(
        (o) => {
          if (o.type === 'text' && o.tail && o.bg) {
            o.bg = c
            o.color = contrastText(c)
          } else setObjectColor(o, c)
        },
        'Change colour',
        'colour'
      )
    }
    const t = this.editingTextObj()
    if (t) {
      t.color = c
      this.invalidate()
    }
    this.emit()
  }

  setSecondary(c: string): void {
    this.secondary = normalizeHex(c)
    this.emit()
  }

  swapColors(): void {
    ;[this.primary, this.secondary] = [this.secondary, this.primary]
    this.emit()
  }

  setOpt<K extends keyof ToolOptions>(k: K, v: ToolOptions[K]): void {
    this.opts = { ...this.opts, [k]: v }
    const sel = this.selectedObjects()
    if (sel.length && !this.textEdit) {
      const before = this.snapshot()
      let n = 0
      for (const o of sel) if (applyOpt(o, k, v, this)) n++
      if (n) this.commit('Change style', before, [], `opt-${k}`)
    }
    const t = this.editingTextObj()
    if (t && applyOpt(t, k, v, this)) this.invalidate()
    this.emit()
  }

  // ---- tools --------------------------------------------------------------------------

  get toolImpl(): Tool {
    return TOOLS[this.tool]
  }

  setTool(id: ToolId): void {
    if (id === this.tool) return
    if (this.textEdit) this.endTextEdit()
    // deactivate first: leaving free transform applies it rather than discarding it
    this.toolImpl.deactivate?.(this)
    this.toolImpl.cancel?.(this)
    this.previousTool = this.tool
    this.tool = id
    if (this.d) {
      this.d.live.hoverId = null
      if (PAINT_TOOLS.includes(id) || SELECT_TOOLS.includes(id) || id === 'crop' || id === 'transform') this.d.selectedIds = []
    }
    this.toolImpl.activate?.(this)
    this.updateCursor(null)
    this.requestRender()
    this.emit()
  }

  private effectiveTool(alt: boolean): Tool {
    if (this.spaceHeld) return TOOLS.hand
    if (alt && PAINT_TOOLS.includes(this.tool)) return TOOLS.eyedropper
    return this.toolImpl
  }

  // ---- view ----------------------------------------------------------------------------

  attach(canvas: HTMLCanvasElement): void {
    this.canvas = canvas
    this.vctx = canvas.getContext('2d')
  }

  setViewport(w: number, h: number, dpr: number): void {
    this.vw = w
    this.vh = h
    this.dpr = dpr
    if (this.canvas) {
      this.canvas.width = Math.round(w * dpr)
      this.canvas.height = Math.round(h * dpr)
    }
    this.checker = null
    if (this.d && !this.d.viewReady) this.fit()
    this.render()
  }

  toScreen(p: Vec): Vec {
    const v = this.d!.view
    return { x: p.x * v.zoom + v.panX, y: p.y * v.zoom + v.panY }
  }

  toDoc(x: number, y: number): Vec {
    const v = this.d!.view
    return { x: (x - v.panX) / v.zoom, y: (y - v.panY) / v.zoom }
  }

  screenRect(r: Rect): Rect {
    const a = this.toScreen(r)
    const z = this.d!.view.zoom
    return { x: a.x, y: a.y, w: r.w * z, h: r.h * z }
  }

  fit(): void {
    const d = this.d
    if (!d || !this.vw) return
    const m = 40
    let z = Math.min((this.vw - m * 2) / d.width, (this.vh - m * 2) / d.height)
    if (d.width <= 256 && d.height <= 256 && z > 1) z = Math.min(32, Math.floor(z))
    else z = Math.min(z, 1)
    z = Math.max(z, 0.02)
    d.view = { zoom: z, panX: Math.round((this.vw - d.width * z) / 2), panY: Math.round((this.vh - d.height * z) / 2) }
    d.viewReady = true
    this.requestRender()
    this.emit()
  }

  setZoom(z: number, anchor?: Vec): void {
    const d = this.d
    if (!d) return
    z = clamp(z, 0.02, 64)
    const a = anchor ?? { x: this.vw / 2, y: this.vh / 2 }
    const p = this.toDoc(a.x, a.y)
    d.view = { zoom: z, panX: a.x - p.x * z, panY: a.y - p.y * z }
    if (Math.abs(z - Math.round(z)) < 1e-6 || z >= 1) {
      d.view.panX = Math.round(d.view.panX)
      d.view.panY = Math.round(d.view.panY)
    }
    this.requestRender()
    this.emit()
  }

  zoomStep(dir: 1 | -1, anchor?: Vec): void {
    const z = this.d?.view.zoom ?? 1
    const next = dir > 0 ? ZOOM_STEPS.find((s) => s > z * 1.001) : [...ZOOM_STEPS].reverse().find((s) => s < z / 1.001)
    if (next) this.setZoom(next, anchor)
  }

  panBy(dx: number, dy: number): void {
    const d = this.d
    if (!d) return
    d.view.panX += dx
    d.view.panY += dy
    this.requestRender()
  }

  // ---- input -------------------------------------------------------------------------

  pinfo(e: MouseEvent | PointerEvent): PointerInfo {
    const r = this.canvas!.getBoundingClientRect()
    const sx = e.clientX - r.left
    const sy = e.clientY - r.top
    const doc = this.toDoc(sx, sy)
    const pe = e as PointerEvent
    return {
      doc,
      px: { x: Math.floor(doc.x), y: Math.floor(doc.y) },
      screen: { x: sx, y: sy },
      button: e.button,
      shift: e.shiftKey,
      alt: e.altKey,
      ctrl: e.ctrlKey || e.metaKey,
      pressure: pe.pointerType === 'pen' ? pe.pressure || 0.5 : 1,
      pointerType: pe.pointerType ?? 'mouse'
    }
  }

  private capture(pointerId: number): void {
    try {
      this.canvas?.setPointerCapture(pointerId)
    } catch {
      // synthetic/inactive pointers can't be captured
    }
  }

  pointerDown(e: PointerEvent): void {
    if (!this.d || !this.canvas) return
    if (this.textEdit) {
      this.endTextEdit()
      return
    }
    const p = this.pinfo(e)
    if (e.button === 1 || (e.button === 0 && (this.spaceHeld || this.tool === 'hand'))) {
      this.capture(e.pointerId)
      this.panning = { x: e.clientX, y: e.clientY, panX: this.d.view.panX, panY: this.d.view.panY }
      this.canvas.style.cursor = 'grabbing'
      return
    }
    if (e.button !== 0 && e.button !== 2) return
    const t = this.effectiveTool(e.altKey)
    if (e.button === 2 && !PAINT_TOOLS.includes(t.id) && t.id !== 'eyedropper') return
    this.capture(e.pointerId)
    this.dragTool = t
    t.down?.(this, p)
    this.requestRender()
  }

  pointerMove(e: PointerEvent): void {
    if (!this.d || !this.canvas) return
    const p = this.pinfo(e)
    this.cursor = p.doc
    for (const fn of this.cursorListeners) fn()
    if (this.panning) {
      this.d.view.panX = this.panning.panX + e.clientX - this.panning.x
      this.d.view.panY = this.panning.panY + e.clientY - this.panning.y
      this.requestRender()
      return
    }
    if (this.dragTool) {
      const events = typeof e.getCoalescedEvents === 'function' ? e.getCoalescedEvents() : []
      if (events.length > 1) for (const ce of events) this.dragTool.move?.(this, this.pinfo(ce), true)
      else this.dragTool.move?.(this, p, true)
    } else {
      this.effectiveTool(e.altKey).move?.(this, p, false)
      this.updateCursor(p)
    }
    this.requestRender()
  }

  pointerUp(e: PointerEvent): void {
    if (!this.d || !this.canvas) return
    if (this.canvas.hasPointerCapture(e.pointerId)) this.canvas.releasePointerCapture(e.pointerId)
    if (this.panning) {
      this.panning = null
      this.emit()
      this.updateCursor(this.pinfo(e))
      return
    }
    const t = this.dragTool
    this.dragTool = null
    if (t) t.up?.(this, this.pinfo(e))
    this.updateCursor(this.pinfo(e))
    this.requestRender()
  }

  pointerLeave(): void {
    this.cursor = null
    for (const fn of this.cursorListeners) fn()
    if (this.d && this.d.live.hoverId) {
      this.d.live.hoverId = null
      this.requestRender()
    }
  }

  dblclick(e: MouseEvent): void {
    if (!this.d || this.textEdit) return
    this.toolImpl.dblclick?.(this, this.pinfo(e))
  }

  wheel(e: WheelEvent): void {
    if (!this.d) return
    e.preventDefault()
    const unit = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? this.vh : 1
    const r = this.canvas!.getBoundingClientRect()
    const anchor = { x: e.clientX - r.left, y: e.clientY - r.top }
    // Shift scrolls sideways (Chromium may already have moved the delta to deltaX)
    if (e.shiftKey) return this.panBy(-(e.deltaY || e.deltaX) * unit, 0)
    // Trackpad pinches arrive as Ctrl+wheel, so Ctrl always zooms. Alt swaps
    // zooming and scrolling, whichever the wheel does by default.
    const zoom = e.ctrlKey || e.metaKey || this.wheelZooms !== e.altKey
    if (zoom && e.deltaY) return this.setZoom(this.d.view.zoom * Math.exp(-e.deltaY * unit * 0.0025), anchor)
    this.panBy(-e.deltaX * unit, zoom ? 0 : -e.deltaY * unit)
  }

  updateCursor(p: PointerInfo | null): void {
    if (!this.canvas) return
    if (this.panning) this.canvas.style.cursor = 'grabbing'
    else if (this.spaceHeld) this.canvas.style.cursor = 'grab'
    else this.canvas.style.cursor = this.effectiveTool(this.altHeld).cursor(this, p)
  }

  /** Global keyboard shortcuts. Returns true if handled. */
  keyDown(e: KeyboardEvent): boolean {
    if (this.textEdit || this.dialog) return false
    const key = e.key.toLowerCase()
    const ctrl = e.ctrlKey || e.metaKey
    if (e.key === 'Alt') {
      this.altHeld = true
      this.updateCursor(null)
      e.preventDefault()
      return true
    }
    if (e.key === ' ' && !ctrl) {
      if (!this.spaceHeld) {
        this.spaceHeld = true
        this.updateCursor(null)
      }
      return true
    }
    if (this.toolImpl.key?.(this, e)) return true

    if (e.key === 'F1') {
      this.showDialog('shortcuts')
      return true
    }
    if (ctrl && e.altKey) {
      if (key === 'i' && this.d) this.showDialog('resize')
      else if (key === 'c' && this.d) this.showDialog('canvasSize')
      else return false
      return true
    }
    if (ctrl) {
      const shift = e.shiftKey
      switch (key) {
        case 'e':
          if (this.d) mergeDown(this, this.d.activeLayerId)
          return true
        case 'i':
          if (shift) this.invertSelection()
          else applyFilter(this, 'invert(1)', 'Invert')
          return true
        case 't':
          if (this.d) this.setTool('transform')
          return true
        case 'u':
          if (this.activeLayer()?.kind === 'raster') this.showDialog('adjust')
          else this.warn('Adjustments apply to pixel layers. Select one in the Layers panel.')
          return true
        case 'z':
          shift ? this.redo() : this.undo()
          return true
        case 'y':
          this.redo()
          return true
        case 'c':
          void (shift ? this.copyMerged() : this.copy())
          return true
        case 'x':
          void this.copy(true)
          return true
        case 'a':
          this.selectAll()
          return true
        case 'd':
          this.deselect()
          return true
        case 'j':
          if (this.d?.selectedIds.length) this.duplicateSelected()
          else if (this.d) this.duplicateLayer(this.d.activeLayerId)
          return true
        case 's':
          void this.save(shift)
          return true
        case 'o':
          void this.openFilesDialog()
          return true
        case 'n':
          if (shift) this.addRasterLayer()
          else this.showDialog('new')
          return true
        case 'w':
          if (this.d) this.closeDoc(this.d.id)
          return true
        case '0':
          this.fit()
          return true
        case '1':
          this.setZoom(1)
          return true
        case '=':
        case '+':
          this.zoomStep(1)
          return true
        case '-':
          this.zoomStep(-1)
          return true
        case ']':
          this.arrange(shift ? 'front' : 'forward')
          return true
        case '[':
          this.arrange(shift ? 'back' : 'backward')
          return true
        case "'":
          this.showGrid = !this.showGrid
          this.requestRender()
          this.emit()
          return true
      }
      return false
    }
    if (e.altKey) return false

    switch (e.key) {
      case 'Delete':
      case 'Backspace':
        this.deleteSelection()
        return true
      case 'Escape':
        if (this.d?.selectedIds.length || this.d?.selection) this.deselect()
        return true
      case 'ArrowLeft':
      case 'ArrowRight':
      case 'ArrowUp':
      case 'ArrowDown': {
        const s = e.shiftKey ? 10 : 1
        const dx = e.key === 'ArrowLeft' ? -s : e.key === 'ArrowRight' ? s : 0
        const dy = e.key === 'ArrowUp' ? -s : e.key === 'ArrowDown' ? s : 0
        this.nudge(dx, dy)
        return true
      }
      case '[':
      case ']':
        this.bumpSize(e.key === ']' ? 1 : -1)
        return true
      case '+':
      case '=':
        this.zoomStep(1)
        return true
      case '-':
        this.zoomStep(-1)
        return true
    }
    if (key === 'x') {
      this.swapColors()
      return true
    }
    if (key === 'd') {
      this.primary = '#000000'
      this.secondary = '#ffffff'
      this.emit()
      return true
    }
    const tool = TOOL_KEYS[key]
    if (tool) {
      this.setTool(tool)
      return true
    }
    return false
  }

  keyUp(e: KeyboardEvent): void {
    if (e.key === ' ') {
      this.spaceHeld = false
      this.updateCursor(null)
    }
    if (e.key === 'Alt') {
      this.altHeld = false
      this.updateCursor(null)
    }
  }

  /** `[` / `]` resize the current tool's brush or stroke. */
  private bumpSize(dir: 1 | -1): void {
    const step = (v: number): number => Math.max(1, Math.round(dir > 0 ? v * 1.2 + 1 : v / 1.2 - 1))
    const map: Partial<Record<ToolId, keyof ToolOptions>> = {
      brush: 'brushSize',
      pencil: 'pencilSize',
      eraser: 'eraserSize',
      arrow: 'strokeWidth',
      line: 'strokeWidth',
      rect: 'strokeWidth',
      ellipse: 'strokeWidth',
      highlight: 'highlightWidth',
      step: 'stepSize',
      text: 'fontSize',
      callout: 'fontSize'
    }
    const k = map[this.tool]
    if (k) this.setOpt(k, step(this.opts[k] as number) as never)
  }

  // ---- rendering ----------------------------------------------------------------------

  requestRender(): void {
    if (!this.frame) this.frame = requestAnimationFrame(() => this.render())
  }

  render(): void {
    if (this.frame) cancelAnimationFrame(this.frame)
    this.frame = 0
    const c = this.canvas
    const ctx = this.vctx
    if (!c || !ctx) return
    const dpr = this.dpr
    ctx.setTransform(1, 0, 0, 1, 0, 0)
    ctx.fillStyle = WORKSPACE
    ctx.fillRect(0, 0, c.width, c.height)
    const d = this.d
    if (!d) return
    if (d.compDirty) {
      renderDoc(d, d.comp, true)
      d.compDirty = false
    }
    const { zoom, panX, panY } = d.view
    const x = panX * dpr
    const y = panY * dpr
    const w = d.width * zoom * dpr
    const h = d.height * zoom * dpr

    ctx.save()
    ctx.shadowColor = 'rgba(0,0,0,0.55)'
    ctx.shadowBlur = 18 * dpr
    ctx.fillStyle = '#000'
    ctx.fillRect(x, y, w, h)
    ctx.restore()

    ctx.save()
    ctx.beginPath()
    ctx.rect(x, y, w, h)
    ctx.clip()
    ctx.fillStyle = this.checkerPattern(ctx)
    ctx.fillRect(x, y, w, h)
    ctx.imageSmoothingEnabled = zoom < 1
    ctx.imageSmoothingQuality = 'high'
    ctx.setTransform(zoom * dpr, 0, 0, zoom * dpr, x, y)
    ctx.drawImage(d.comp, 0, 0)
    ctx.restore()

    if (this.showGrid && zoom >= 8) this.drawGrid(ctx)

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    this.drawSelectionOverlay(ctx)
    this.toolImpl.overlay?.(this, ctx)
    ctx.setTransform(1, 0, 0, 1, 0, 0)
    this.positionTextArea()
  }

  private checkerPattern(ctx: CanvasRenderingContext2D): CanvasPattern {
    if (this.checker) return this.checker
    const s = Math.round(8 * this.dpr)
    const p = makeCanvas(s * 2, s * 2)
    const x = ctx2d(p)
    x.fillStyle = '#ffffff'
    x.fillRect(0, 0, s * 2, s * 2)
    x.fillStyle = '#d9dce1'
    x.fillRect(0, 0, s, s)
    x.fillRect(s, s, s, s)
    this.checker = ctx.createPattern(p, 'repeat')!
    return this.checker
  }

  private drawGrid(ctx: CanvasRenderingContext2D): void {
    const d = this.d!
    const { zoom, panX, panY } = d.view
    const dpr = this.dpr
    const x0 = Math.max(0, Math.floor(-panX / zoom))
    const x1 = Math.min(d.width, Math.ceil((this.vw - panX) / zoom))
    const y0 = Math.max(0, Math.floor(-panY / zoom))
    const y1 = Math.min(d.height, Math.ceil((this.vh - panY) / zoom))
    ctx.setTransform(1, 0, 0, 1, 0, 0)
    ctx.beginPath()
    for (let i = x0; i <= x1; i++) {
      const sx = Math.round((panX + i * zoom) * dpr) + 0.5
      ctx.moveTo(sx, (panY + y0 * zoom) * dpr)
      ctx.lineTo(sx, (panY + y1 * zoom) * dpr)
    }
    for (let j = y0; j <= y1; j++) {
      const sy = Math.round((panY + j * zoom) * dpr) + 0.5
      ctx.moveTo((panX + x0 * zoom) * dpr, sy)
      ctx.lineTo((panX + x1 * zoom) * dpr, sy)
    }
    ctx.strokeStyle = 'rgba(120, 124, 132, 0.35)'
    ctx.lineWidth = 1
    ctx.stroke()
  }

  private drawAnts(ctx: CanvasRenderingContext2D, s: Selection): void {
    const off = (performance.now() / 60) % 8
    const path = outline(s)
    ctx.save()
    ctx.lineWidth = 1
    if (!path) {
      const r = this.screenRect(s)
      const box: [number, number, number, number] = [Math.round(r.x) + 0.5, Math.round(r.y) + 0.5, Math.round(r.w), Math.round(r.h)]
      ctx.setLineDash([4, 4])
      ctx.strokeStyle = '#000'
      ctx.lineDashOffset = off
      ctx.strokeRect(...box)
      ctx.strokeStyle = '#fff'
      ctx.lineDashOffset = off + 4
      ctx.strokeRect(...box)
    } else {
      // The outline is in document pixels relative to the selection; scale it to the
      // screen but keep 1px lines and a screen-sized dash.
      const { zoom, panX, panY } = this.d!.view
      const dpr = this.dpr
      ctx.setTransform(dpr * zoom, 0, 0, dpr * zoom, Math.round(dpr * (panX + s.x * zoom)) + 0.5, Math.round(dpr * (panY + s.y * zoom)) + 0.5)
      ctx.lineWidth = 1 / zoom
      ctx.setLineDash([4 / zoom, 4 / zoom])
      ctx.strokeStyle = '#000'
      ctx.lineDashOffset = off / zoom
      ctx.stroke(path)
      ctx.strokeStyle = '#fff'
      ctx.lineDashOffset = (off + 4) / zoom
      ctx.stroke(path)
    }
    ctx.restore()
  }

  private drawSelectionOverlay(ctx: CanvasRenderingContext2D): void {
    const d = this.d!
    // marching ants (hidden while a free transform carries the selection)
    if (d.selection && !d.live.transform) this.drawAnts(ctx, d.selection)

    const showHandles = this.tool === 'select' || VECTOR_TOOLS.includes(this.tool)
    // hover outline
    const hover = d.live.hoverId && !d.selectedIds.includes(d.live.hoverId) ? this.findObject(d.live.hoverId) : null
    if (hover) this.outlineObject(ctx, hover.obj, 'rgba(91,140,255,0.75)')

    const sel = this.selectedObjects()
    for (const o of sel) {
      if (o.type === 'line' && sel.length === 1) {
        const a = this.toScreen({ x: o.x1, y: o.y1 })
        const b = this.toScreen({ x: o.x2, y: o.y2 })
        ctx.strokeStyle = ACCENT
        ctx.lineWidth = 1
        ctx.setLineDash([3, 3])
        ctx.beginPath()
        ctx.moveTo(a.x, a.y)
        ctx.lineTo(b.x, b.y)
        ctx.stroke()
        ctx.setLineDash([])
      } else this.outlineObject(ctx, o, ACCENT, true)
    }
    if (showHandles && sel.length === 1 && !this.textEdit) {
      for (const hd of handlesOf(sel[0])) {
        const s = this.toScreen(hd)
        ctx.fillStyle = '#fff'
        ctx.strokeStyle = ACCENT
        ctx.lineWidth = 1.5
        ctx.beginPath()
        if (hd.id === 'p1' || hd.id === 'p2' || hd.id === 'tail') ctx.arc(s.x, s.y, 5, 0, Math.PI * 2)
        else ctx.rect(Math.round(s.x) - 4, Math.round(s.y) - 4, 8, 8)
        ctx.fill()
        ctx.stroke()
      }
    }
    // rubber band
    if (d.live.band) {
      const r = this.screenRect(d.live.band)
      ctx.fillStyle = 'rgba(91,140,255,0.1)'
      ctx.fillRect(r.x, r.y, r.w, r.h)
      ctx.strokeStyle = ACCENT
      ctx.lineWidth = 1
      ctx.strokeRect(r.x + 0.5, r.y + 0.5, r.w, r.h)
    }
  }

  private outlineObject(ctx: CanvasRenderingContext2D, o: VObj, color: string, dashed = false): void {
    const pad = o.type === 'line' ? 0 : 3
    const b = objBounds(o)
    const r = this.screenRect(b)
    ctx.strokeStyle = color
    ctx.lineWidth = 1
    if (dashed) ctx.setLineDash([4, 3])
    if (o.type === 'line') {
      const a = this.toScreen({ x: o.x1, y: o.y1 })
      const e = this.toScreen({ x: o.x2, y: o.y2 })
      ctx.lineWidth = 2
      ctx.beginPath()
      ctx.moveTo(a.x, a.y)
      ctx.lineTo(e.x, e.y)
      ctx.stroke()
    } else if (o.type === 'step') {
      const c = this.toScreen({ x: o.x, y: o.y })
      ctx.beginPath()
      ctx.arc(c.x, c.y, (o.size / 2) * this.d!.view.zoom + pad, 0, Math.PI * 2)
      ctx.stroke()
    } else {
      ctx.strokeRect(Math.round(r.x - pad) + 0.5, Math.round(r.y - pad) + 0.5, Math.round(r.w + pad * 2), Math.round(r.h + pad * 2))
    }
    ctx.setLineDash([])
  }

  private positionTextArea(): void {
    const ta = this.textArea
    const o = this.editingTextObj()
    if (!ta || !o || !this.d) return
    const L = textLayout(o)
    const z = this.d.view.zoom
    const s = this.toScreen({ x: o.x + L.pad, y: o.y + L.top })
    const inner = (L.w - L.pad * 2) * z
    const align = o.align ?? 'left'
    // A fixed box wraps like the canvas does. A fitted box gets some slack for the
    // next character, placed so the text stays where alignment puts it.
    const slack = o.boxW != null ? 0 : o.fontSize * z * 0.8
    const shift = align === 'center' ? slack / 2 : align === 'right' ? slack : 0
    ta.style.left = `${s.x - shift}px`
    ta.style.top = `${s.y}px`
    ta.style.font = fontOf({ ...o, fontSize: o.fontSize * z })
    ta.style.lineHeight = `${L.lineH * z}px`
    ta.style.width = `${inner + slack}px`
    ta.style.height = `${L.lines.length * L.lineH * z}px`
    ta.style.whiteSpace = o.boxW != null ? 'pre-wrap' : 'pre'
    ta.style.textAlign = align
    ta.style.color = o.color
    ta.style.caretColor = o.color
  }
}

// ---- helpers ------------------------------------------------------------------------------

function cloneOf(c: HTMLCanvasElement): HTMLCanvasElement {
  const out = makeCanvas(c.width, c.height)
  ctx2d(out).drawImage(c, 0, 0)
  return out
}

/** Tool options that mirror a selected object's style. */
function optsFromObject(o: VObj): Partial<ToolOptions> {
  switch (o.type) {
    case 'rect':
    case 'ellipse':
      return { strokeWidth: o.strokeWidth, shapeFill: !!o.fill, cornerRadius: o.radius, dashed: o.dashed, shadow: o.shadow }
    case 'line':
      return { strokeWidth: o.width, arrowStart: o.start, arrowEnd: o.end, arrowHeadScale: o.headScale ?? 1, dashed: o.dashed, shadow: o.shadow }
    case 'text':
      return {
        fontSize: o.fontSize,
        fontFamily: o.fontFamily,
        bold: o.bold,
        shadow: o.shadow,
        textAlign: o.align ?? 'left',
        textVAlign: o.valign ?? 'top',
        ...(o.tail ? {} : { textBg: !!o.bg })
      }
    case 'step':
      return { stepSize: o.size, shadow: o.shadow }
    case 'path':
      return { highlightWidth: o.width, highlightOpacity: o.opacity }
    case 'redact':
      return { redactMode: o.mode, redactStrength: o.strength }
  }
}

/** Apply one tool option to an object; returns true if it changed anything. */
function applyOpt<K extends keyof ToolOptions>(o: VObj, k: K, v: ToolOptions[K], ed: Editor): boolean {
  const set = <T extends VObj>(obj: T, patch: Partial<T>): boolean => {
    Object.assign(obj, patch)
    return true
  }
  switch (o.type) {
    case 'rect':
    case 'ellipse':
      if (k === 'strokeWidth') return set(o, { strokeWidth: v as number })
      if (k === 'shapeFill') return set(o, { fill: v ? ed.secondary : null })
      if (k === 'cornerRadius') return set(o, { radius: v as number })
      if (k === 'dashed') return set(o, { dashed: v as boolean })
      if (k === 'shadow') return set(o, { shadow: v as boolean })
      return false
    case 'line':
      if (k === 'strokeWidth') return set(o, { width: v as number })
      if (k === 'arrowStart') return set(o, { start: v as LineHead })
      if (k === 'arrowEnd') return set(o, { end: v as LineHead })
      if (k === 'arrowHeadScale') return set(o, { headScale: v as number })
      if (k === 'dashed') return set(o, { dashed: v as boolean })
      if (k === 'shadow') return set(o, { shadow: v as boolean })
      return false
    case 'text':
      if (k === 'fontSize') return set(o, { fontSize: v as number })
      if (k === 'fontFamily') return set(o, { fontFamily: v as string })
      if (k === 'bold') return set(o, { bold: v as boolean })
      if (k === 'shadow') return set(o, { shadow: v as boolean })
      if (k === 'textBg' && !o.tail) return set(o, { bg: v ? ed.secondary : null })
      if (k === 'textAlign') return set(o, { align: v as TextObj['align'] })
      if (k === 'textVAlign') return set(o, { valign: v as TextObj['valign'] })
      return false
    case 'step':
      if (k === 'stepSize') return set(o, { size: v as number })
      if (k === 'shadow') return set(o, { shadow: v as boolean })
      return false
    case 'path':
      if (k === 'highlightWidth') return set(o, { width: v as number })
      if (k === 'highlightOpacity') return set(o, { opacity: v as number })
      return false
    case 'redact':
      if (k === 'redactMode') return set(o, { mode: v as ToolOptions['redactMode'] })
      if (k === 'redactStrength') return set(o, { strength: v as number })
      return false
  }
}

type LineHead = ToolOptions['arrowEnd']

