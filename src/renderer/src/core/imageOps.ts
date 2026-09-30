import type { DocState } from './doc'
import { layerBounds, rasterLayer } from './doc'
import type { Editor } from './editor'
import { drawObject, offsetObject, transformObject } from './objects'
import { filteredLayer, flattenDoc, renderDoc } from './render'
import type { Layer, RasterLayer, Rect, Vec, VectorLayer } from './types'
import { ctx2d, intersect, makeCanvas, normalize, pixelRect, scratch, union } from './util'

function resetComp(d: DocState): void {
  d.comp = makeCanvas(d.width, d.height)
  d.compDirty = true
  d.selection = null
}

/** Cut raster layers down to the document bounds so hidden pixels don't linger. */
function trimLayersToDoc(d: DocState): void {
  const docRect = { x: 0, y: 0, w: d.width, h: d.height }
  for (const l of d.layers) {
    if (l.kind !== 'raster') continue
    const b = layerBounds(l)
    const r = intersect(b, docRect)
    if (r && r.x === b.x && r.y === b.y && r.w === b.w && r.h === b.h) continue
    const c = makeCanvas(r?.w ?? 1, r?.h ?? 1)
    if (r) ctx2d(c).drawImage(l.canvas, l.x - r.x, l.y - r.y)
    l.canvas = c
    l.x = r?.x ?? 0
    l.y = r?.y ?? 0
  }
}

function shiftAll(d: DocState, dx: number, dy: number): void {
  for (const l of d.layers) {
    if (l.kind === 'raster') {
      l.x += dx
      l.y += dy
    } else for (const o of l.objects) offsetObject(o, dx, dy)
  }
}

export function cropTo(ed: Editor, rect: Rect): void {
  const d = ed.d
  if (!d) return
  const r = pixelRect(normalize(rect))
  if (r.w < 1 || r.h < 1) return
  const before = ed.snapshot()
  shiftAll(d, -r.x, -r.y)
  d.width = r.w
  d.height = r.h
  trimLayersToDoc(d)
  resetComp(d)
  ed.commit('Crop', before)
  ed.fit()
}

/** Scale down in halving steps for much better quality than one big jump. */
function resample(src: HTMLCanvasElement, w: number, h: number, smooth: boolean): HTMLCanvasElement {
  w = Math.max(1, Math.round(w))
  h = Math.max(1, Math.round(h))
  let cur = src
  if (smooth) {
    while (cur.width / 2 >= w && cur.height / 2 >= h) {
      const half = makeCanvas(Math.ceil(cur.width / 2), Math.ceil(cur.height / 2))
      const x = ctx2d(half)
      x.imageSmoothingQuality = 'high'
      x.drawImage(cur, 0, 0, half.width, half.height)
      cur = half
    }
  }
  const out = makeCanvas(w, h)
  const x = ctx2d(out)
  x.imageSmoothingEnabled = smooth
  x.imageSmoothingQuality = 'high'
  x.drawImage(cur, 0, 0, w, h)
  return out
}

export function resizeImage(ed: Editor, w: number, h: number, smooth: boolean): void {
  const d = ed.d
  if (!d || w < 1 || h < 1) return
  const sx = w / d.width
  const sy = h / d.height
  const before = ed.snapshot()
  for (const l of d.layers) {
    if (l.kind === 'raster') {
      l.canvas = resample(l.canvas, l.canvas.width * sx, l.canvas.height * sy, smooth)
      l.x = Math.round(l.x * sx)
      l.y = Math.round(l.y * sy)
    } else {
      for (const o of l.objects) transformObject(o, (p) => ({ x: p.x * sx, y: p.y * sy }), Math.sqrt(sx * sy))
    }
  }
  d.width = Math.round(w)
  d.height = Math.round(h)
  resetComp(d)
  ed.commit('Resize image', before)
  ed.fit()
}

/** Change the canvas size; `anchor` 0..1 per axis says where the old image sits. */
export function resizeCanvas(ed: Editor, w: number, h: number, anchor: Vec, fill: string | null): void {
  const d = ed.d
  if (!d || w < 1 || h < 1) return
  const before = ed.snapshot()
  const dx = Math.round((w - d.width) * anchor.x)
  const dy = Math.round((h - d.height) * anchor.y)
  shiftAll(d, dx, dy)
  d.width = Math.round(w)
  d.height = Math.round(h)
  trimLayersToDoc(d)
  const bottom = d.layers[0]
  if (fill && bottom?.kind === 'raster') {
    const c = makeCanvas(d.width, d.height)
    const x = ctx2d(c)
    x.fillStyle = fill
    x.fillRect(0, 0, d.width, d.height)
    x.drawImage(bottom.canvas, bottom.x, bottom.y)
    bottom.canvas = c
    bottom.x = 0
    bottom.y = 0
  }
  resetComp(d)
  ed.commit('Canvas size', before)
  ed.fit()
}

export type TransformKind = 'cw' | 'ccw' | '180' | 'flipH' | 'flipV'

export function transformImage(ed: Editor, kind: TransformKind): void {
  const d = ed.d
  if (!d) return
  const W = d.width
  const H = d.height
  // canvas matrix [a b c d e f]: x' = a x + c y + e, y' = b x + d y + f
  const M: Record<TransformKind, [number, number, number, number, number, number]> = {
    cw: [0, 1, -1, 0, H, 0],
    ccw: [0, -1, 1, 0, 0, W],
    '180': [-1, 0, 0, -1, W, H],
    flipH: [-1, 0, 0, 1, W, 0],
    flipV: [1, 0, 0, -1, 0, H]
  }
  const [a, b, c, dd, e, f] = M[kind]
  const map = (p: Vec): Vec => ({ x: a * p.x + c * p.y + e, y: b * p.x + dd * p.y + f })
  const before = ed.snapshot()
  for (const l of d.layers) {
    if (l.kind === 'raster') {
      const p0 = map({ x: l.x, y: l.y })
      const p1 = map({ x: l.x + l.canvas.width, y: l.y + l.canvas.height })
      const nr = { x: Math.min(p0.x, p1.x), y: Math.min(p0.y, p1.y), w: Math.abs(p1.x - p0.x), h: Math.abs(p1.y - p0.y) }
      const out = makeCanvas(nr.w, nr.h)
      const x = ctx2d(out)
      x.setTransform(a, b, c, dd, e - nr.x, f - nr.y)
      x.drawImage(l.canvas, l.x, l.y)
      l.canvas = out
      l.x = nr.x
      l.y = nr.y
    } else {
      for (const o of l.objects) transformObject(o, map, 1)
    }
  }
  if (kind === 'cw' || kind === 'ccw') {
    d.width = H
    d.height = W
  }
  resetComp(d)
  const labels: Record<TransformKind, string> = {
    cw: 'Rotate 90° clockwise',
    ccw: 'Rotate 90° counter-clockwise',
    '180': 'Rotate 180°',
    flipH: 'Flip horizontal',
    flipV: 'Flip vertical'
  }
  ed.commit(labels[kind], before)
  if (kind === 'cw' || kind === 'ccw') ed.fit()
}

/** Apply a CSS filter to the active raster layer (inside the selection if there is one). */
export function applyFilter(ed: Editor, filter: string, label: string): void {
  const d = ed.d
  const l = ed.activeLayer()
  if (!d) return
  if (l?.kind !== 'raster') return ed.warn('Adjustments apply to pixel layers. Select one in the Layers panel.')
  if (l.locked) return ed.warn('Layer is locked')
  const before = ed.snapshot()
  l.canvas = filteredLayer(l, filter, d.selection)
  ed.commit(label, before)
}

/** Crop away fully transparent borders. */
export function trim(ed: Editor): void {
  const d = ed.d
  if (!d) return
  const flat = flattenDoc(d)
  const data = ctx2d(flat).getImageData(0, 0, d.width, d.height).data
  let x0 = d.width
  let y0 = d.height
  let x1 = -1
  let y1 = -1
  for (let y = 0; y < d.height; y++) {
    for (let x = 0; x < d.width; x++) {
      if (data[(y * d.width + x) * 4 + 3] > 0) {
        if (x < x0) x0 = x
        if (x > x1) x1 = x
        if (y < y0) y0 = y
        if (y > y1) y1 = y
      }
    }
  }
  if (x1 < 0) return ed.warn('Nothing to trim: the image is empty')
  if (x0 === 0 && y0 === 0 && x1 === d.width - 1 && y1 === d.height - 1) return ed.warn('No transparent edges to trim')
  cropTo(ed, { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 })
}

/** Render a vector layer to pixels. Redactions sample the layers beneath. */
function rasterizeVector(d: DocState, index: number): HTMLCanvasElement {
  const l = d.layers[index] as VectorLayer
  const below = makeCanvas(d.width, d.height)
  renderDoc(d, below, false, index)
  const out = makeCanvas(d.width, d.height)
  const o = ctx2d(out)
  for (const obj of l.objects) {
    let source: HTMLCanvasElement | null = null
    if (obj.type === 'redact') {
      source = scratch('rasterize-src', d.width, d.height)
      const s = ctx2d(source)
      s.drawImage(below, 0, 0)
      s.drawImage(out, 0, 0)
    }
    drawObject(o, obj, { source })
  }
  return out
}

function layerContent(d: DocState, index: number): { canvas: HTMLCanvasElement; x: number; y: number } {
  const l = d.layers[index]
  if (l.kind === 'raster') return { canvas: l.canvas, x: l.x, y: l.y }
  return { canvas: rasterizeVector(d, index), x: 0, y: 0 }
}

function withProps(target: RasterLayer, src: Layer): RasterLayer {
  return Object.assign(target, { id: src.id, name: src.name, visible: src.visible, opacity: src.opacity, blend: src.blend })
}

export function rasterizeLayer(ed: Editor, id: string): void {
  const d = ed.d
  const i = d?.layers.findIndex((l) => l.id === id) ?? -1
  if (!d || i < 0 || d.layers[i].kind !== 'vector') return
  const before = ed.snapshot()
  d.layers[i] = withProps(rasterLayer('', rasterizeVector(d, i)), d.layers[i])
  d.selectedIds = []
  ed.commit('Rasterize layer', before)
}

export function mergeDown(ed: Editor, id: string): void {
  const d = ed.d
  const i = d?.layers.findIndex((l) => l.id === id) ?? -1
  if (!d || i < 1) return
  const top = d.layers[i]
  const below = d.layers[i - 1]
  const before = ed.snapshot()
  if (top.kind === 'vector' && below.kind === 'vector' && top.opacity >= 1 && top.blend === 'source-over') {
    below.objects.push(...top.objects)
    d.layers.splice(i, 1)
    d.activeLayerId = below.id
    ed.commit('Merge down', before)
    return
  }
  const lo = layerContent(d, i - 1)
  const hi = layerContent(d, i)
  const bounds = union({ x: lo.x, y: lo.y, w: lo.canvas.width, h: lo.canvas.height }, { x: hi.x, y: hi.y, w: hi.canvas.width, h: hi.canvas.height })
  const c = makeCanvas(bounds.w, bounds.h)
  const x = ctx2d(c)
  x.drawImage(lo.canvas, lo.x - bounds.x, lo.y - bounds.y)
  x.globalAlpha = top.opacity
  x.globalCompositeOperation = top.blend
  if (top.visible) x.drawImage(hi.canvas, hi.x - bounds.x, hi.y - bounds.y)
  const merged = withProps(rasterLayer('', c, bounds.x, bounds.y), below)
  d.layers.splice(i - 1, 2, merged)
  d.activeLayerId = merged.id
  d.selectedIds = []
  ed.commit('Merge down', before)
}

export function flattenImage(ed: Editor): void {
  const d = ed.d
  if (!d) return
  const before = ed.snapshot()
  const l = rasterLayer('Background', flattenDoc(d))
  d.layers = [l]
  d.activeLayerId = l.id
  d.selectedIds = []
  ed.commit('Flatten image', before)
}

export function cropToSelection(ed: Editor): void {
  const s = ed.d?.selection
  if (!s) return ed.warn('Make a selection first (M)')
  cropTo(ed, s)
}
