import { restore, type Snapshot } from '../core/doc'
import type { Editor, RasterEdit } from '../core/editor'
import { bresenham, floodMask, pixelStamp, stampOffset } from '../core/raster'
import { renderDoc } from '../core/render'
import { keepInside, selectionTester } from '../core/selection'
import type { RasterLayer, Selection, Vec } from '../core/types'
import { ctx2d, hexToRgb, makeCanvas, rgbToHex, scratch } from '../core/util'
import type { PointerInfo, Tool } from './types'

type PaintKind = 'brush' | 'pencil' | 'eraser'

interface Stroke {
  kind: PaintKind
  layer: RasterLayer
  edit: RasterEdit
  before: Snapshot
  bctx: CanvasRenderingContext2D
  clipped: boolean
  color: string
  size: number
  pixel: boolean
  erase: boolean
  /** Last point in layer coordinates. */
  last: Vec
  /** Plotted pixels (pixel-perfect mode). */
  pts: Vec[]
  /** Shaped selection to confine the stroke to (rectangles use a clip instead). */
  mask: Selection | null
}

let stroke: Stroke | null = null
/** End of the previous stroke, for shift-click straight lines. */
let lastEnd: { doc: Vec; layerId: string } | null = null

function sizeFor(ed: Editor, kind: PaintKind): number {
  return kind === 'brush' ? ed.opts.brushSize : kind === 'pencil' ? ed.opts.pencilSize : ed.opts.eraserSize
}

function toLayer(l: RasterLayer, p: Vec): Vec {
  return { x: p.x - l.x, y: p.y - l.y }
}

function smoothSegment(s: Stroke, a: Vec, b: Vec, pressure: number): void {
  const w = Math.max(0.5, s.size * pressure)
  const c = s.bctx
  c.strokeStyle = s.color
  c.fillStyle = s.color
  c.lineWidth = w
  c.lineCap = 'round'
  c.lineJoin = 'round'
  if (a.x === b.x && a.y === b.y) {
    c.beginPath()
    c.arc(a.x, a.y, w / 2, 0, Math.PI * 2)
    c.fill()
  } else {
    c.beginPath()
    c.moveTo(a.x, a.y)
    c.lineTo(b.x, b.y)
    c.stroke()
  }
  const pad = w / 2 + 2
  s.edit.mark({ x: Math.min(a.x, b.x) - pad, y: Math.min(a.y, b.y) - pad, w: Math.abs(b.x - a.x) + pad * 2, h: Math.abs(b.y - a.y) + pad * 2 })
}

function pixelSegment(s: Stroke, a: Vec, b: Vec, perfect: boolean): void {
  const stamp = pixelStamp(s.size, s.color)
  const off = stampOffset(s.size)
  const ax = Math.floor(a.x)
  const ay = Math.floor(a.y)
  const bx = Math.floor(b.x)
  const by = Math.floor(b.y)
  bresenham(ax, ay, bx, by, (x, y) => {
    if (perfect) {
      const prev = s.pts[s.pts.length - 1]
      if (prev && prev.x === x && prev.y === y) return
      s.pts.push({ x, y })
      const n = s.pts.length
      if (n >= 3) {
        const [p0, p1, p2] = [s.pts[n - 3], s.pts[n - 2], s.pts[n - 1]]
        const diag = Math.abs(p0.x - p2.x) === 1 && Math.abs(p0.y - p2.y) === 1
        const corner = (p1.x === p0.x || p1.y === p0.y) && (p1.x === p2.x || p1.y === p2.y)
        if (diag && corner) {
          // remove the L-corner pixel for clean 1px lines
          s.bctx.clearRect(p1.x, p1.y, 1, 1)
          s.pts.splice(n - 2, 1)
        }
      }
    }
    s.bctx.drawImage(stamp, x - off, y - off)
  })
  s.edit.mark({ x: Math.min(ax, bx) - off - 1, y: Math.min(ay, by) - off - 1, w: Math.abs(bx - ax) + s.size + 2, h: Math.abs(by - ay) + s.size + 2 })
}

function segment(ed: Editor, s: Stroke, a: Vec, b: Vec, pressure: number): void {
  if (s.pixel) pixelSegment(s, a, b, s.kind === 'pencil' && s.size === 1 && ed.opts.pixelPerfect)
  else smoothSegment(s, a, b, s.kind === 'brush' && ed.opts.brushPressure ? pressure : 1)
}

function begin(ed: Editor, kind: PaintKind, p: PointerInfo): void {
  const d = ed.d!
  const before = ed.snapshot()
  const { layer } = ed.ensureRasterLayer()
  const edit = ed.beginRasterEdit(layer, before)
  const buffer = scratch('stroke-buffer', layer.canvas.width, layer.canvas.height)
  const bctx = ctx2d(buffer)
  let clipped = false
  if (d.selection) {
    bctx.save()
    bctx.beginPath()
    bctx.rect(d.selection.x - layer.x, d.selection.y - layer.y, d.selection.w, d.selection.h)
    bctx.clip()
    clipped = true
  }
  const erase = kind === 'eraser'
  const mask = d.selection?.mask ? d.selection : null
  const s: Stroke = {
    kind,
    layer,
    edit,
    before,
    bctx,
    clipped,
    color: erase ? '#000000' : p.button === 2 ? ed.secondary : ed.primary,
    size: sizeFor(ed, kind),
    pixel: kind === 'pencil' || (erase && ed.opts.eraserHard),
    erase,
    last: toLayer(layer, p.doc),
    pts: [],
    mask
  }
  stroke = s
  d.live.stroke = { layerId: layer.id, buffer, erase, alpha: kind === 'brush' ? ed.opts.brushOpacity : 1, mask }
  const from = p.shift && lastEnd?.layerId === layer.id ? toLayer(layer, lastEnd.doc) : s.last
  segment(ed, s, from, s.last, p.pressure)
  ed.invalidate()
}

function finish(ed: Editor): void {
  const s = stroke
  const d = ed.d
  stroke = null
  if (!s || !d) return
  if (s.clipped) s.bctx.restore()
  if (s.mask) keepInside(s.bctx.canvas, s.mask, s.layer.x, s.layer.y)
  const st = d.live.stroke
  const l = ctx2d(s.layer.canvas)
  l.save()
  l.globalAlpha = st?.alpha ?? 1
  l.globalCompositeOperation = s.erase ? 'destination-out' : 'source-over'
  l.drawImage(s.bctx.canvas, 0, 0)
  l.restore()
  d.live.stroke = null
  lastEnd = { doc: { x: s.last.x + s.layer.x, y: s.last.y + s.layer.y }, layerId: s.layer.id }
  if (!s.erase) ed.pushRecent(s.color)
  s.edit.commit(s.kind === 'eraser' ? 'Erase' : s.kind === 'pencil' ? 'Pencil' : 'Brush')
}

function drawBrushCursor(ed: Editor, ctx: CanvasRenderingContext2D, kind: PaintKind): void {
  const d = ed.d!
  const c = ed.cursor
  if (!c) return
  const size = sizeFor(ed, kind)
  const z = d.view.zoom
  const pixel = kind === 'pencil' || (kind === 'eraser' && ed.opts.eraserHard)
  ctx.lineWidth = 1
  if (pixel) {
    const off = stampOffset(size)
    const r = ed.screenRect({ x: Math.floor(c.x) - off, y: Math.floor(c.y) - off, w: size, h: size })
    if (r.w < 4) return
    ctx.strokeStyle = 'rgba(0,0,0,0.6)'
    ctx.strokeRect(Math.round(r.x) - 0.5, Math.round(r.y) - 0.5, Math.round(r.w) + 1, Math.round(r.h) + 1)
    ctx.strokeStyle = 'rgba(255,255,255,0.9)'
    ctx.strokeRect(Math.round(r.x) + 0.5, Math.round(r.y) + 0.5, Math.round(r.w) - 1, Math.round(r.h) - 1)
    return
  }
  const rad = (size * z) / 2
  if (rad < 3) return
  const s = ed.toScreen(c)
  ctx.strokeStyle = 'rgba(0,0,0,0.6)'
  ctx.beginPath()
  ctx.arc(s.x, s.y, rad + 0.5, 0, Math.PI * 2)
  ctx.stroke()
  ctx.strokeStyle = 'rgba(255,255,255,0.9)'
  ctx.beginPath()
  ctx.arc(s.x, s.y, rad - 0.5, 0, Math.PI * 2)
  ctx.stroke()
}

function makePaintTool(kind: PaintKind): Tool {
  return {
    id: kind,
    cursor: () => 'crosshair',
    down(ed, p) {
      begin(ed, kind, p)
    },
    move(ed, p, dragging) {
      if (!dragging || !stroke) return
      const b = toLayer(stroke.layer, p.doc)
      segment(ed, stroke, stroke.last, b, p.pressure)
      stroke.last = b
      ed.invalidate()
    },
    up(ed) {
      finish(ed)
    },
    cancel(ed) {
      const s = stroke
      stroke = null
      if (!s || !ed.d) return
      if (s.clipped) s.bctx.restore()
      ed.d.live.stroke = null
      restore(ed.d, s.before)
      ed.invalidate()
    },
    overlay(ed, ctx) {
      drawBrushCursor(ed, ctx, kind)
    }
  }
}

export const brushTool = makePaintTool('brush')
export const pencilTool = makePaintTool('pencil')
export const eraserTool = makePaintTool('eraser')

// ---- fill bucket -----------------------------------------------------------------------

export const fillTool: Tool = {
  id: 'fill',
  cursor: () => 'crosshair',
  down(ed, p) {
    const d = ed.d!
    const color = p.button === 2 ? ed.secondary : ed.primary
    const active = ed.activeLayer()
    if (active?.kind === 'vector') {
      const hit = ed.hitTest(p.doc)
      if (hit) {
        const before = ed.snapshot()
        const o = hit.obj
        if (o.type === 'rect' || o.type === 'ellipse') o.fill = color
        else if (o.type === 'text') {
          if (o.bg) o.bg = color
          else o.color = color
        } else if (o.type === 'redact') {
          if (o.mode === 'solid') o.color = color
        } else if (o.type === 'line' || o.type === 'step' || o.type === 'path') o.color = color
        ed.pushRecent(color)
        ed.commit('Fill', before)
        return
      }
    }
    if (p.px.x < 0 || p.px.y < 0 || p.px.x >= d.width || p.px.y >= d.height) return
    const before = ed.snapshot()
    const { layer, created } = ed.ensureRasterLayer()
    const edit = ed.beginRasterEdit(layer, before)
    const merged = ed.opts.fillSampleMerged || created
    let sample: ImageData
    let off: Vec
    if (merged) {
      const c = makeCanvas(d.width, d.height)
      renderDoc(d, c, false)
      sample = ctx2d(c).getImageData(0, 0, d.width, d.height)
      off = { x: 0, y: 0 }
    } else {
      sample = ctx2d(layer.canvas).getImageData(0, 0, layer.canvas.width, layer.canvas.height)
      off = { x: layer.x, y: layer.y }
    }
    const lim = d.selection ?? { x: 0, y: 0, w: d.width, h: d.height }
    const res = floodMask(
      sample,
      p.px.x - off.x,
      p.px.y - off.y,
      ed.opts.fillTolerance,
      ed.opts.fillContiguous,
      { x: lim.x - off.x, y: lim.y - off.y, w: lim.w, h: lim.h }
    )
    if (!res) {
      restore(d, before)
      return
    }
    const { mask, bbox } = res
    const lx = bbox.x + off.x - layer.x
    const ly = bbox.y + off.y - layer.y
    const lctx = ctx2d(layer.canvas)
    const tgt = lctx.getImageData(lx, ly, bbox.w, bbox.h)
    const [r, g, b] = hexToRgb(color)
    const selected = d.selection?.mask ? selectionTester(d.selection) : null
    for (let y = 0; y < bbox.h; y++) {
      for (let x = 0; x < bbox.w; x++) {
        if (!mask[(bbox.y + y) * sample.width + bbox.x + x]) continue
        if (selected && !selected(bbox.x + off.x + x, bbox.y + off.y + y)) continue
        const i = (y * bbox.w + x) * 4
        tgt.data[i] = r
        tgt.data[i + 1] = g
        tgt.data[i + 2] = b
        tgt.data[i + 3] = 255
      }
    }
    lctx.putImageData(tgt, lx, ly)
    edit.mark({ x: lx, y: ly, w: bbox.w, h: bbox.h })
    ed.pushRecent(color)
    edit.commit('Fill')
  }
}

// ---- eyedropper ---------------------------------------------------------------------------

function pick(ed: Editor, p: PointerInfo): void {
  const d = ed.d!
  if (p.px.x < 0 || p.px.y < 0 || p.px.x >= d.width || p.px.y >= d.height) return
  let data: Uint8ClampedArray
  const l = ed.activeLayer()
  if (!ed.opts.sampleMerged && l?.kind === 'raster') {
    const x = p.px.x - l.x
    const y = p.px.y - l.y
    if (x < 0 || y < 0 || x >= l.canvas.width || y >= l.canvas.height) return
    data = ctx2d(l.canvas).getImageData(x, y, 1, 1).data
  } else {
    if (d.compDirty) {
      renderDoc(d, d.comp, true)
      d.compDirty = false
    }
    data = ctx2d(d.comp).getImageData(p.px.x, p.px.y, 1, 1).data
  }
  if (data[3] === 0) return
  const hex = rgbToHex(data[0], data[1], data[2])
  if (p.button === 2) ed.setSecondary(hex)
  else ed.setPrimary(hex, false)
}

export const eyedropperTool: Tool = {
  id: 'eyedropper',
  cursor: () => 'crosshair',
  down: pick,
  move(ed, p, dragging) {
    if (dragging) pick(ed, p)
  },
  up(ed) {
    ed.pushRecent(ed.primary)
    ed.emit()
  },
  overlay(ed, ctx) {
    const c = ed.cursor
    if (!c) return
    const s = ed.toScreen(c)
    ctx.fillStyle = ed.primary
    ctx.strokeStyle = '#fff'
    ctx.lineWidth = 2
    ctx.beginPath()
    ctx.arc(s.x + 18, s.y - 18, 9, 0, Math.PI * 2)
    ctx.fill()
    ctx.stroke()
  }
}
