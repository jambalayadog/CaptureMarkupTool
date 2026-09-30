import type { FileKind, Layer, LiveState, RasterLayer, Rect, VectorLayer, ViewState } from './types'
import { ctx2d, makeCanvas, uid } from './util'

// ---- history -------------------------------------------------------------------

/** Structural state of a document. Raster canvases are shared by reference. */
export interface Snapshot {
  width: number
  height: number
  activeLayerId: string
  layers: Layer[]
}

/** Pixel change on one raster layer, in that layer's canvas coordinates. */
export interface Patch {
  layerId: string
  x: number
  y: number
  before: ImageData
  after: ImageData
}

export interface Entry {
  label: string
  before: Snapshot
  after: Snapshot
  patches: Patch[]
  /** Consecutive entries with the same key (e.g. slider drags) merge into one. */
  mergeKey?: string
  time?: number
}

const MAX_HISTORY = 150

export class History {
  entries: Entry[] = []
  /** Number of entries currently applied. */
  index = 0
  savedIndex = 0

  push(e: Entry): void {
    this.entries.length = this.index
    if (this.savedIndex > this.index) this.savedIndex = -1
    this.entries.push(e)
    this.index++
    if (this.entries.length > MAX_HISTORY) {
      this.entries.shift()
      this.index--
      this.savedIndex--
    }
  }

  get canUndo(): boolean {
    return this.index > 0
  }
  get canRedo(): boolean {
    return this.index < this.entries.length
  }
  get dirty(): boolean {
    return this.index !== this.savedIndex
  }
  markSaved(): void {
    this.savedIndex = this.index
  }
}

// ---- document -------------------------------------------------------------------

export interface DocState {
  id: string
  name: string
  filePath: string | null
  fileKind: FileKind | null
  fileHandle: FileSystemFileHandle | null
  width: number
  height: number
  layers: Layer[]
  activeLayerId: string
  history: History
  view: ViewState
  viewReady: boolean
  /** Marquee selection in document pixels. */
  selection: Rect | null
  selectedIds: string[]
  live: LiveState
  /** Cached composite of all layers at document resolution. */
  comp: HTMLCanvasElement
  compDirty: boolean
}

export function emptyLive(): LiveState {
  return { stroke: null, editingTextId: null, previewFilter: null, crop: null, band: null, hoverId: null }
}

export function createDoc(width: number, height: number, name: string, layers: Layer[]): DocState {
  return {
    id: uid(),
    name,
    filePath: null,
    fileKind: null,
    fileHandle: null,
    width,
    height,
    layers,
    activeLayerId: layers[layers.length - 1]?.id ?? '',
    history: new History(),
    view: { zoom: 1, panX: 0, panY: 0 },
    viewReady: false,
    selection: null,
    selectedIds: [],
    live: emptyLive(),
    comp: makeCanvas(width, height),
    compDirty: true
  }
}

export function rasterLayer(name: string, canvas: HTMLCanvasElement, x = 0, y = 0): RasterLayer {
  return { id: uid(), kind: 'raster', name, visible: true, opacity: 1, blend: 'source-over', locked: false, canvas, x, y }
}

export function vectorLayer(name: string): VectorLayer {
  return { id: uid(), kind: 'vector', name, visible: true, opacity: 1, blend: 'source-over', locked: false, objects: [] }
}

function copyLayer(l: Layer): Layer {
  return l.kind === 'raster' ? { ...l } : { ...l, objects: structuredClone(l.objects) }
}

export function snapshot(d: DocState): Snapshot {
  return { width: d.width, height: d.height, activeLayerId: d.activeLayerId, layers: d.layers.map(copyLayer) }
}

export function restore(d: DocState, s: Snapshot): void {
  d.width = s.width
  d.height = s.height
  d.layers = s.layers.map(copyLayer)
  d.activeLayerId = d.layers.some((l) => l.id === s.activeLayerId) ? s.activeLayerId : (d.layers[d.layers.length - 1]?.id ?? '')
  const ids = new Set<string>()
  for (const l of d.layers) if (l.kind === 'vector') for (const o of l.objects) ids.add(o.id)
  d.selectedIds = d.selectedIds.filter((id) => ids.has(id))
  if (d.comp.width !== d.width || d.comp.height !== d.height) d.comp = makeCanvas(d.width, d.height)
  d.compDirty = true
}

function applyPatches(d: DocState, patches: Patch[], which: 'before' | 'after'): void {
  const list = which === 'before' ? [...patches].reverse() : patches
  for (const p of list) {
    const l = d.layers.find((x) => x.id === p.layerId)
    if (l?.kind === 'raster') ctx2d(l.canvas).putImageData(p[which], p.x, p.y)
  }
}

export function undo(d: DocState): Entry | null {
  const h = d.history
  if (!h.canUndo) return null
  const e = h.entries[h.index - 1]
  applyPatches(d, e.patches, 'before')
  restore(d, e.before)
  h.index--
  return e
}

export function redo(d: DocState): Entry | null {
  const h = d.history
  if (!h.canRedo) return null
  const e = h.entries[h.index]
  restore(d, e.after)
  applyPatches(d, e.patches, 'after')
  h.index++
  return e
}

export function layerBounds(l: RasterLayer): Rect {
  return { x: l.x, y: l.y, w: l.canvas.width, h: l.canvas.height }
}
