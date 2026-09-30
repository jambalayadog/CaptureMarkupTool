// Free transform (Ctrl+T): scale, rotate and move a pixel layer, or just the
// selected pixels. Nothing is written until Enter / Apply; Esc cancels.
import { layerBounds } from '../core/doc'
import type { Editor } from '../core/editor'
import { ACCENT } from '../core/constants'
import { alphaBounds } from '../core/raster'
import { drawTransformed, transformMatrix } from '../core/render'
import { clearInside, keepInside, transformSel } from '../core/selection'
import type { RasterLayer, Rect, TransformState, Vec } from '../core/types'
import { cloneCanvas, ctx2d, intersect, makeCanvas, pixelRect, union } from '../core/util'
import type { PointerInfo, Tool } from './types'

type Drag =
  | { kind: 'move'; start: Vec; cx: number; cy: number }
  | { kind: 'rotate'; start: number; angle: number }
  | { kind: 'scale'; hx: number; hy: number; t0: TransformState }

let drag: Drag | null = null

const HANDLES: [number, number][] = [
  [-1, -1],
  [0, -1],
  [1, -1],
  [1, 0],
  [1, 1],
  [0, 1],
  [-1, 1],
  [-1, 0]
]

const ROTATE_CURSOR =
  `url("data:image/svg+xml,${encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24"><path d="M19 12a7 7 0 1 1-2.05-4.95" fill="none" stroke="#fff" stroke-width="4" stroke-linecap="round"/><path d="M19 12a7 7 0 1 1-2.05-4.95" fill="none" stroke="#000" stroke-width="2" stroke-linecap="round"/><path d="M20 3v5h-5" fill="none" stroke="#fff" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/><path d="M20 3v5h-5" fill="none" stroke="#000" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>'
  )}") 12 12, crosshair`

const session = (ed: Editor): TransformState | null => ed.d?.live.transform ?? null

/** Local (untransformed, centred) coordinates → document. */
function toDoc(t: TransformState, lx: number, ly: number): Vec {
  const c = Math.cos(t.angle)
  const s = Math.sin(t.angle)
  const x = lx * t.sx
  const y = ly * t.sy
  return { x: t.cx + c * x - s * y, y: t.cy + s * x + c * y }
}

/** Document → local (untransformed, centred) coordinates. */
function toLocal(t: TransformState, p: Vec): Vec {
  const c = Math.cos(-t.angle)
  const s = Math.sin(-t.angle)
  const dx = p.x - t.cx
  const dy = p.y - t.cy
  return { x: (c * dx - s * dy) / t.sx, y: (s * dx + c * dy) / t.sy }
}

function handleAt(ed: Editor, t: TransformState, screen: Vec): [number, number] | null {
  const hw = t.start.w / 2
  const hh = t.start.h / 2
  for (const [hx, hy] of HANDLES) {
    const s = ed.toScreen(toDoc(t, hx * hw, hy * hh))
    if (Math.abs(s.x - screen.x) <= 8 && Math.abs(s.y - screen.y) <= 8) return [hx, hy]
  }
  return null
}

/** Screen position of the rotation knob above the top edge. */
function rotateKnob(ed: Editor, t: TransformState): { knob: Vec; top: Vec } {
  const top = ed.toScreen(toDoc(t, 0, -t.start.h / 2))
  const c = ed.toScreen({ x: t.cx, y: t.cy })
  const len = Math.hypot(top.x - c.x, top.y - c.y) || 1
  return { top, knob: { x: top.x + ((top.x - c.x) / len) * 26, y: top.y + ((top.y - c.y) / len) * 26 } }
}

function inside(t: TransformState, p: Vec): boolean {
  const q = toLocal(t, p)
  return Math.abs(q.x) <= t.start.w / 2 && Math.abs(q.y) <= t.start.h / 2
}

function resizeCursor(ed: Editor, t: TransformState, hx: number, hy: number): string {
  const c = ed.toScreen({ x: t.cx, y: t.cy })
  const h = ed.toScreen(toDoc(t, (hx * t.start.w) / 2, (hy * t.start.h) / 2))
  const deg = ((Math.atan2(h.y - c.y, h.x - c.x) * 180) / Math.PI + 180) % 180
  return ['ew-resize', 'nwse-resize', 'ns-resize', 'nesw-resize'][Math.round(deg / 45) % 4]
}

function crop(src: HTMLCanvasElement, r: Rect): HTMLCanvasElement {
  const c = makeCanvas(r.w, r.h)
  ctx2d(c).drawImage(src, -r.x, -r.y)
  return c
}

/** Start transforming the active layer (or its selected pixels). */
function begin(ed: Editor): boolean {
  const d = ed.d
  if (!d) return false
  const l = ed.activeLayer()
  if (l?.kind !== 'raster') {
    ed.warn('Free transform works on pixel layers. To resize annotations, use the Select tool (V).')
    return false
  }
  if (l.locked || !l.visible) {
    ed.warn(l.locked ? 'Layer is locked' : 'Layer is hidden')
    return false
  }
  const sel = d.selection
  let src: HTMLCanvasElement
  let base: HTMLCanvasElement | null = null
  let start: Rect
  if (sel) {
    const r = intersect(sel, layerBounds(l))
    const piece = r && makeCanvas(r.w, r.h)
    if (r && piece) {
      ctx2d(piece).drawImage(l.canvas, l.x - r.x, l.y - r.y)
      keepInside(piece, sel, r.x, r.y)
    }
    const b = piece && alphaBounds(piece)
    if (!r || !piece || !b) {
      ed.warn('The selection is empty on this layer')
      return false
    }
    src = crop(piece, b)
    start = { x: r.x + b.x, y: r.y + b.y, w: b.w, h: b.h }
    base = cloneCanvas(l.canvas)
    clearInside(base, sel, l.x, l.y)
  } else {
    const b = alphaBounds(l.canvas)
    if (!b) {
      ed.warn('This layer is empty')
      return false
    }
    src = crop(l.canvas, b)
    start = { x: l.x + b.x, y: l.y + b.y, w: b.w, h: b.h }
  }
  d.live.transform = {
    layerId: l.id,
    src,
    base,
    cx: start.x + start.w / 2,
    cy: start.y + start.h / 2,
    sx: 1,
    sy: 1,
    angle: 0,
    start,
    selection: sel,
    // pixel art keeps hard pixels; photos and screenshots resample smoothly
    smooth: !(d.width <= 256 && d.height <= 256)
  }
  ed.invalidate()
  ed.emit()
  return true
}

function isIdentity(t: TransformState): boolean {
  return (
    t.sx === 1 &&
    t.sy === 1 &&
    Math.abs(t.angle % (Math.PI * 2)) < 1e-9 &&
    t.cx === t.start.x + t.start.w / 2 &&
    t.cy === t.start.y + t.start.h / 2
  )
}

export function cancelTransform(ed: Editor): void {
  if (!ed.d?.live.transform) return
  ed.d.live.transform = null
  drag = null
  ed.invalidate()
  ed.emit()
}

export function applyTransform(ed: Editor): void {
  const d = ed.d
  const t = d?.live.transform
  if (!d || !t) return
  drag = null
  const l = ed.layer(t.layerId) as RasterLayer | null
  if (!l || isIdentity(t)) return cancelTransform(ed)
  const m = transformMatrix(t)
  const pts = [
    [t.start.x, t.start.y],
    [t.start.x + t.start.w, t.start.y],
    [t.start.x, t.start.y + t.start.h],
    [t.start.x + t.start.w, t.start.y + t.start.h]
  ].map(([x, y]) => m.transformPoint(new DOMPoint(x, y)))
  const xs = pts.map((p) => p.x)
  const ys = pts.map((p) => p.y)
  const box = pixelRect({ x: Math.min(...xs), y: Math.min(...ys), w: Math.max(...xs) - Math.min(...xs), h: Math.max(...ys) - Math.min(...ys) })
  const out = t.base ? union(layerBounds(l), box) : box
  const c = makeCanvas(out.w, out.h)
  const x = ctx2d(c)
  x.translate(-out.x, -out.y)
  drawTransformed(x, t, l)
  const before = ed.snapshot()
  l.canvas = c
  l.x = out.x
  l.y = out.y
  const sel = t.selection ? transformSel(t.selection, m, t.smooth) : null
  ed.commit('Free transform', before)
  ed.setSelection(sel)
}

/** Nudge the live transform from the options bar (flip, rotate, typed values). */
export function adjustTransform(ed: Editor, patch: Partial<Pick<TransformState, 'sx' | 'sy' | 'angle' | 'smooth'>>): void {
  const t = session(ed)
  if (!t) return
  Object.assign(t, patch)
  ed.invalidate()
  ed.emit()
}

/** Keep sizes whole pixels in pixel-art mode; never collapse to zero. */
function fixScale(s: number, n: number, smooth: boolean): number {
  const size = smooth ? s * n : Math.round(s * n)
  const safe = Math.abs(size) < 1 ? (Math.sign(size) || 1) * 1 : size
  return safe / n
}

function exitTo(ed: Editor): void {
  ed.setTool(ed.previousTool === 'transform' ? 'select' : ed.previousTool)
}

export const transformTool: Tool = {
  id: 'transform',
  cursor(ed, p) {
    const t = session(ed)
    if (!t || !p) return 'default'
    const h = handleAt(ed, t, p.screen)
    if (h) return resizeCursor(ed, t, h[0], h[1])
    return inside(t, p.doc) ? 'move' : ROTATE_CURSOR
  },
  activate(ed) {
    drag = null
    if (!begin(ed)) queueMicrotask(() => exitTo(ed))
  },
  deactivate(ed) {
    applyTransform(ed)
  },
  down(ed, p: PointerInfo) {
    let t = session(ed)
    if (!t) {
      if (!begin(ed)) return
      t = session(ed)!
    }
    const h = handleAt(ed, t, p.screen)
    if (h) {
      drag = { kind: 'scale', hx: h[0], hy: h[1], t0: { ...t } }
    } else if (inside(t, p.doc)) {
      drag = { kind: 'move', start: p.doc, cx: t.cx, cy: t.cy }
    } else {
      drag = { kind: 'rotate', start: Math.atan2(p.doc.y - t.cy, p.doc.x - t.cx), angle: t.angle }
    }
  },
  move(ed, p, dragging) {
    const t = session(ed)
    if (!dragging || !t || !drag) return
    if (drag.kind === 'move') {
      let dx = Math.round(p.doc.x - drag.start.x)
      let dy = Math.round(p.doc.y - drag.start.y)
      if (p.shift) {
        if (Math.abs(dx) > Math.abs(dy)) dy = 0
        else dx = 0
      }
      t.cx = drag.cx + dx
      t.cy = drag.cy + dy
    } else if (drag.kind === 'rotate') {
      let a = drag.angle + Math.atan2(p.doc.y - t.cy, p.doc.x - t.cx) - drag.start
      if (p.shift) a = Math.round(a / (Math.PI / 12)) * (Math.PI / 12)
      t.angle = a
    } else {
      const { hx, hy, t0 } = drag
      const hw = t0.start.w / 2
      const hh = t0.start.h / 2
      // the opposite handle stays put (or the centre, with Alt)
      const fixed = p.alt ? { x: 0, y: 0 } : { x: -hx * hw, y: -hy * hh }
      const F = toDoc(t0, fixed.x, fixed.y)
      const c = Math.cos(-t0.angle)
      const s = Math.sin(-t0.angle)
      const ux = c * (p.doc.x - F.x) - s * (p.doc.y - F.y)
      const uy = s * (p.doc.x - F.x) + c * (p.doc.y - F.y)
      const span = p.alt ? 1 : 2
      let sx = hx ? ux / (hx * hw * span) : t0.sx
      let sy = hy ? uy / (hy * hh * span) : t0.sy
      if (p.shift && hx && hy) {
        const k = Math.max(Math.abs(sx / t0.sx), Math.abs(sy / t0.sy))
        sx = Math.sign(sx || 1) * Math.abs(t0.sx) * k
        sy = Math.sign(sy || 1) * Math.abs(t0.sy) * k
      }
      sx = fixScale(sx, t0.start.w, t.smooth)
      sy = fixScale(sy, t0.start.h, t.smooth)
      const ox = sx * fixed.x
      const oy = sy * fixed.y
      const cr = Math.cos(t0.angle)
      const sr = Math.sin(t0.angle)
      t.sx = sx
      t.sy = sy
      t.cx = F.x - (cr * ox - sr * oy)
      t.cy = F.y - (sr * ox + cr * oy)
    }
    ed.invalidate()
  },
  up(ed) {
    drag = null
    ed.emit()
  },
  dblclick(ed, p) {
    const t = session(ed)
    if (t && inside(t, p.doc)) {
      applyTransform(ed)
      exitTo(ed)
    }
  },
  key(ed, e) {
    if (e.key === 'Enter') {
      applyTransform(ed)
      exitTo(ed)
      return true
    }
    if (e.key === 'Escape') {
      cancelTransform(ed)
      exitTo(ed)
      return true
    }
    return false
  },
  cancel(ed) {
    drag = null
    cancelTransform(ed)
  },
  undo(ed) {
    const t = session(ed)
    if (!t) return false
    drag = null
    cancelTransform(ed)
    // Undo first resets the transform, and you stay in it. With nothing left to
    // reset, it leaves free transform so the step before it (say, a rasterize) undoes.
    if (isIdentity(t)) {
      exitTo(ed)
      return false
    }
    if (!begin(ed)) exitTo(ed)
    return true
  },
  overlay(ed, ctx) {
    const t = session(ed)
    if (!t) return
    const hw = t.start.w / 2
    const hh = t.start.h / 2
    const corners = [
      [-1, -1],
      [1, -1],
      [1, 1],
      [-1, 1]
    ].map(([a, b]) => ed.toScreen(toDoc(t, a * hw, b * hh)))
    const { knob, top } = rotateKnob(ed, t)
    ctx.save()
    ctx.strokeStyle = ACCENT
    ctx.lineWidth = 1.5
    ctx.beginPath()
    corners.forEach((c, i) => (i ? ctx.lineTo(c.x, c.y) : ctx.moveTo(c.x, c.y)))
    ctx.closePath()
    ctx.moveTo(top.x, top.y)
    ctx.lineTo(knob.x, knob.y)
    ctx.stroke()
    ctx.fillStyle = '#fff'
    ctx.beginPath()
    ctx.arc(knob.x, knob.y, 5, 0, Math.PI * 2)
    ctx.fill()
    ctx.stroke()
    for (const [hx, hy] of HANDLES) {
      const s = ed.toScreen(toDoc(t, hx * hw, hy * hh))
      ctx.fillStyle = '#fff'
      ctx.fillRect(Math.round(s.x) - 4, Math.round(s.y) - 4, 8, 8)
      ctx.strokeRect(Math.round(s.x) - 4 + 0.5, Math.round(s.y) - 4 + 0.5, 7, 7)
    }
    ctx.restore()
  }
}

/** Apply (or cancel) the transform and return to the previous tool. */
export function finishTransform(ed: Editor, apply: boolean): void {
  if (apply) applyTransform(ed)
  else cancelTransform(ed)
  exitTo(ed)
}
