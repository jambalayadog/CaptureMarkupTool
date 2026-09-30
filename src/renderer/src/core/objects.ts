import type { LineObj, PathObj, Rect, RedactObj, ShapeObj, StepObj, TextObj, VObj, Vec } from './types'
import { contrastText, ctx2d, distToSegment, normRect, pixelRect, scratch, snap45 } from './util'

// ---- text layout -------------------------------------------------------------

const measure = ctx2d(document.createElement('canvas'))

export const fontOf = (o: Pick<TextObj, 'bold' | 'fontSize' | 'fontFamily'>): string =>
  `${o.bold ? 700 : 400} ${o.fontSize}px ${o.fontFamily}`

export interface TextLayout {
  lines: string[]
  lineH: number
  pad: number
  w: number
  h: number
  /** Distance from the top of a line box to its baseline (CSS line-box model). */
  baseline: number
}

export function textLayout(o: TextObj): TextLayout {
  measure.font = fontOf(o)
  const lines = o.text.split('\n')
  const widths = lines.map((l) => measure.measureText(l).width)
  const m = measure.measureText('Mg')
  const asc = m.fontBoundingBoxAscent ?? o.fontSize * 0.8
  const desc = m.fontBoundingBoxDescent ?? o.fontSize * 0.2
  const lineH = Math.round(o.fontSize * 1.25)
  const pad = o.bg ? Math.round(o.fontSize * 0.45) : Math.round(o.fontSize * 0.12)
  return {
    lines,
    lineH,
    pad,
    w: Math.ceil(Math.max(o.fontSize * 0.5, ...widths) + pad * 2),
    h: lines.length * lineH + pad * 2,
    baseline: (lineH - (asc + desc)) / 2 + asc
  }
}

// ---- drawing -------------------------------------------------------------------

function shadowOn(ctx: CanvasRenderingContext2D, on: boolean): void {
  if (!on) return
  ctx.shadowColor = 'rgba(0, 0, 0, 0.42)'
  ctx.shadowBlur = 8
  ctx.shadowOffsetX = 2
  ctx.shadowOffsetY = 3
}

/** Adds a polygon with positive (clockwise on screen) winding so unions fill cleanly. */
function addPoly(p: Path2D, pts: Vec[]): void {
  let area = 0
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i]
    const b = pts[(i + 1) % pts.length]
    area += a.x * b.y - b.x * a.y
  }
  const ordered = area < 0 ? [...pts].reverse() : pts
  p.moveTo(ordered[0].x, ordered[0].y)
  for (let i = 1; i < ordered.length; i++) p.lineTo(ordered[i].x, ordered[i].y)
  p.closePath()
}

function addCircle(p: Path2D, c: Vec, r: number): void {
  p.moveTo(c.x + r, c.y)
  p.arc(c.x, c.y, r, 0, Math.PI * 2)
}

export function headLength(o: LineObj): number {
  return Math.max(10, o.width * 3.2 + 6)
}

interface LineGeom {
  shaft: [Vec, Vec]
  heads: Path2D
  full: Path2D
}

function lineGeom(o: LineObj): LineGeom {
  const a = { x: o.x1, y: o.y1 }
  const b = { x: o.x2, y: o.y2 }
  const len = Math.hypot(b.x - a.x, b.y - a.y) || 0.0001
  const u = { x: (b.x - a.x) / len, y: (b.y - a.y) / len }
  const n = { x: -u.y, y: u.x }
  const hw = o.width / 2
  const heads = new Path2D()
  const full = new Path2D()
  const both = o.start === 'arrow' && o.end === 'arrow'
  const maxHead = len * (both ? 0.45 : 0.9)
  const L = Math.min(headLength(o), Math.max(maxHead, o.width * 1.5))
  const W = L * 0.52
  let s = a
  let e = b

  const addHead = (tip: Vec, dir: Vec, kind: LineObj['end']): Vec => {
    if (kind === 'arrow') {
      const base = { x: tip.x - dir.x * L, y: tip.y - dir.y * L }
      const notch = { x: tip.x - dir.x * L * 0.74, y: tip.y - dir.y * L * 0.74 }
      const poly = [tip, { x: base.x + n.x * W, y: base.y + n.y * W }, notch, { x: base.x - n.x * W, y: base.y - n.y * W }]
      addPoly(heads, poly)
      addPoly(full, poly)
      return { x: tip.x - dir.x * L * 0.62, y: tip.y - dir.y * L * 0.62 }
    }
    if (kind === 'dot') {
      const r = Math.max(o.width * 1.6, 4)
      addCircle(heads, tip, r)
      addCircle(full, tip, r)
    }
    return tip
  }
  e = addHead(b, u, o.end)
  s = addHead(a, { x: -u.x, y: -u.y }, o.start)

  addPoly(full, [
    { x: s.x + n.x * hw, y: s.y + n.y * hw },
    { x: e.x + n.x * hw, y: e.y + n.y * hw },
    { x: e.x - n.x * hw, y: e.y - n.y * hw },
    { x: s.x - n.x * hw, y: s.y - n.y * hw }
  ])
  if (o.start === 'none') addCircle(full, a, hw)
  if (o.end === 'none') addCircle(full, b, hw)
  return { shaft: [s, e], heads, full }
}

function drawLine(ctx: CanvasRenderingContext2D, o: LineObj): void {
  const g = lineGeom(o)
  ctx.fillStyle = o.color
  shadowOn(ctx, o.shadow)
  if (!o.dashed) {
    ctx.fill(g.full)
    return
  }
  ctx.strokeStyle = o.color
  ctx.lineWidth = o.width
  ctx.lineCap = 'butt'
  ctx.setLineDash([o.width * 2.4, o.width * 1.6])
  ctx.beginPath()
  ctx.moveTo(g.shaft[0].x, g.shaft[0].y)
  ctx.lineTo(g.shaft[1].x, g.shaft[1].y)
  ctx.stroke()
  ctx.setLineDash([])
  ctx.fill(g.heads)
}

function drawShape(ctx: CanvasRenderingContext2D, o: ShapeObj): void {
  const path = new Path2D()
  const r = normRect({ x: o.x, y: o.y }, { x: o.x + o.w, y: o.y + o.h })
  if (o.type === 'ellipse') path.ellipse(r.x + r.w / 2, r.y + r.h / 2, r.w / 2, r.h / 2, 0, 0, Math.PI * 2)
  else path.roundRect(r.x, r.y, r.w, r.h, Math.min(o.radius, r.w / 2, r.h / 2))
  shadowOn(ctx, o.shadow)
  if (o.fill) {
    ctx.fillStyle = o.fill
    ctx.fill(path)
    ctx.shadowColor = 'transparent'
  }
  if (o.stroke && o.strokeWidth > 0) {
    ctx.strokeStyle = o.stroke
    ctx.lineWidth = o.strokeWidth
    ctx.lineJoin = 'round'
    if (o.dashed) ctx.setLineDash([o.strokeWidth * 2.4, o.strokeWidth * 1.6])
    ctx.stroke(path)
    ctx.setLineDash([])
  }
}

function bubblePath(o: TextObj, L: TextLayout): Path2D {
  const p = new Path2D()
  const r = Math.min(o.fontSize * 0.3, L.w / 2, L.h / 2)
  p.roundRect(o.x, o.y, L.w, L.h, r)
  if (o.tail) {
    const c = { x: o.x + L.w / 2, y: o.y + L.h / 2 }
    const dx = o.tail.x - c.x
    const dy = o.tail.y - c.y
    const len = Math.hypot(dx, dy)
    const inside = o.tail.x > o.x && o.tail.x < o.x + L.w && o.tail.y > o.y && o.tail.y < o.y + L.h
    if (len > 1 && !inside) {
      const bw = Math.min(L.w, L.h) * 0.28
      const n = { x: -dy / len, y: dx / len }
      addPoly(p, [{ x: c.x + n.x * bw, y: c.y + n.y * bw }, o.tail, { x: c.x - n.x * bw, y: c.y - n.y * bw }])
    }
  }
  return p
}

function drawText(ctx: CanvasRenderingContext2D, o: TextObj, hideText: boolean): void {
  const L = textLayout(o)
  if (o.bg) {
    shadowOn(ctx, o.shadow)
    ctx.fillStyle = o.bg
    ctx.fill(bubblePath(o, L))
    ctx.shadowColor = 'transparent'
  } else {
    shadowOn(ctx, o.shadow)
  }
  if (hideText) return
  ctx.font = fontOf(o)
  ctx.fillStyle = o.color
  ctx.textBaseline = 'alphabetic'
  L.lines.forEach((line, i) => ctx.fillText(line, o.x + L.pad, o.y + L.pad + i * L.lineH + L.baseline))
}

function drawStep(ctx: CanvasRenderingContext2D, o: StepObj): void {
  const r = o.size / 2
  shadowOn(ctx, o.shadow)
  ctx.fillStyle = o.color
  ctx.beginPath()
  ctx.arc(o.x, o.y, r, 0, Math.PI * 2)
  ctx.fill()
  ctx.shadowColor = 'transparent'
  ctx.lineWidth = Math.max(1.5, o.size * 0.07)
  ctx.strokeStyle = '#ffffff'
  ctx.beginPath()
  ctx.arc(o.x, o.y, r - ctx.lineWidth / 2, 0, Math.PI * 2)
  ctx.stroke()
  const label = String(o.n)
  const fs = o.size * (label.length > 2 ? 0.38 : label.length > 1 ? 0.46 : 0.56)
  ctx.font = `700 ${fs}px "Segoe UI", system-ui, sans-serif`
  ctx.fillStyle = contrastText(o.color)
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillText(label, o.x, o.y + fs * 0.04)
  ctx.textAlign = 'start'
}

function drawPath(ctx: CanvasRenderingContext2D, o: PathObj): void {
  if (!o.points.length) return
  ctx.globalAlpha *= o.opacity
  ctx.globalCompositeOperation = o.blend
  ctx.strokeStyle = o.color
  ctx.lineWidth = o.width
  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'
  ctx.beginPath()
  ctx.moveTo(o.points[0].x, o.points[0].y)
  if (o.points.length === 1) ctx.lineTo(o.points[0].x + 0.01, o.points[0].y)
  for (let i = 1; i < o.points.length; i++) ctx.lineTo(o.points[i].x, o.points[i].y)
  ctx.stroke()
}

/** Redaction samples whatever is already drawn underneath it. */
function drawRedact(ctx: CanvasRenderingContext2D, o: RedactObj, source: HTMLCanvasElement | null): void {
  const r = pixelRect(normRect({ x: o.x, y: o.y }, { x: o.x + o.w, y: o.y + o.h }))
  if (r.w < 1 || r.h < 1) return
  if (o.mode === 'solid' || !source) {
    ctx.fillStyle = o.color
    ctx.fillRect(r.x, r.y, r.w, r.h)
    return
  }
  if (o.mode === 'pixelate') {
    const block = Math.max(2, Math.round(o.strength))
    const sw = Math.max(1, Math.ceil(r.w / block))
    const sh = Math.max(1, Math.ceil(r.h / block))
    const tmp = scratch('redact', sw, sh)
    const t = ctx2d(tmp)
    t.imageSmoothingEnabled = true
    t.imageSmoothingQuality = 'high'
    t.drawImage(source, r.x, r.y, sw * block, sh * block, 0, 0, sw, sh)
    ctx.save()
    ctx.beginPath()
    ctx.rect(r.x, r.y, r.w, r.h)
    ctx.clip()
    ctx.imageSmoothingEnabled = false
    ctx.drawImage(tmp, 0, 0, sw, sh, r.x, r.y, sw * block, sh * block)
    ctx.restore()
    return
  }
  const m = Math.ceil(o.strength * 2)
  const tmp = scratch('redact', r.w + m * 2, r.h + m * 2)
  const t = ctx2d(tmp)
  t.filter = `blur(${o.strength}px)`
  t.drawImage(source, r.x - m, r.y - m, r.w + m * 2, r.h + m * 2, 0, 0, r.w + m * 2, r.h + m * 2)
  t.filter = 'none'
  ctx.drawImage(tmp, m, m, r.w, r.h, r.x, r.y, r.w, r.h)
}

export interface DrawOpts {
  /** Canvas holding everything beneath (for redaction objects). */
  source?: HTMLCanvasElement | null
  hideText?: boolean
}

export function drawObject(ctx: CanvasRenderingContext2D, o: VObj, opts: DrawOpts = {}): void {
  ctx.save()
  switch (o.type) {
    case 'rect':
    case 'ellipse':
      drawShape(ctx, o)
      break
    case 'line':
      drawLine(ctx, o)
      break
    case 'text':
      drawText(ctx, o, !!opts.hideText)
      break
    case 'step':
      drawStep(ctx, o)
      break
    case 'path':
      drawPath(ctx, o)
      break
    case 'redact':
      drawRedact(ctx, o, opts.source ?? null)
      break
  }
  ctx.restore()
}

// ---- geometry --------------------------------------------------------------------

export function objBounds(o: VObj): Rect {
  switch (o.type) {
    case 'rect':
    case 'ellipse':
    case 'redact':
      return normRect({ x: o.x, y: o.y }, { x: o.x + o.w, y: o.y + o.h })
    case 'line': {
      const r = normRect({ x: o.x1, y: o.y1 }, { x: o.x2, y: o.y2 })
      return r
    }
    case 'text': {
      const L = textLayout(o)
      return { x: o.x, y: o.y, w: L.w, h: L.h }
    }
    case 'step':
      return { x: o.x - o.size / 2, y: o.y - o.size / 2, w: o.size, h: o.size }
    case 'path': {
      let x0 = Infinity
      let y0 = Infinity
      let x1 = -Infinity
      let y1 = -Infinity
      for (const p of o.points) {
        x0 = Math.min(x0, p.x)
        y0 = Math.min(y0, p.y)
        x1 = Math.max(x1, p.x)
        y1 = Math.max(y1, p.y)
      }
      const h = o.width / 2
      return { x: x0 - h, y: y0 - h, w: x1 - x0 + o.width, h: y1 - y0 + o.width }
    }
  }
}

export function hitObject(o: VObj, p: Vec, tol: number): boolean {
  switch (o.type) {
    case 'rect':
    case 'ellipse': {
      const r = objBounds(o)
      const edge = o.stroke ? o.strokeWidth / 2 + tol : tol
      if (o.type === 'rect') {
        const inOuter = p.x >= r.x - edge && p.x <= r.x + r.w + edge && p.y >= r.y - edge && p.y <= r.y + r.h + edge
        if (!inOuter) return false
        if (o.fill) return true
        const inInner = p.x > r.x + edge && p.x < r.x + r.w - edge && p.y > r.y + edge && p.y < r.y + r.h - edge
        return !inInner
      }
      const cx = r.x + r.w / 2
      const cy = r.y + r.h / 2
      const rx = r.w / 2
      const ry = r.h / 2
      const d = Math.hypot((p.x - cx) / Math.max(rx + edge, 1), (p.y - cy) / Math.max(ry + edge, 1))
      if (d > 1) return false
      if (o.fill) return true
      const di = Math.hypot((p.x - cx) / Math.max(rx - edge, 1), (p.y - cy) / Math.max(ry - edge, 1))
      return di >= 1 || rx <= edge || ry <= edge
    }
    case 'redact':
    case 'text': {
      const r = objBounds(o)
      if (p.x >= r.x - tol && p.x <= r.x + r.w + tol && p.y >= r.y - tol && p.y <= r.y + r.h + tol) return true
      if (o.type === 'text' && o.tail && o.bg) {
        const c = { x: r.x + r.w / 2, y: r.y + r.h / 2 }
        return distToSegment(p, c, o.tail) <= tol + 4
      }
      return false
    }
    case 'line':
      return distToSegment(p, { x: o.x1, y: o.y1 }, { x: o.x2, y: o.y2 }) <= o.width / 2 + tol + (o.end === 'arrow' ? 3 : 0)
    case 'step':
      return Math.hypot(p.x - o.x, p.y - o.y) <= o.size / 2 + tol
    case 'path': {
      const lim = o.width / 2 + tol
      if (o.points.length === 1) return Math.hypot(p.x - o.points[0].x, p.y - o.points[0].y) <= lim
      for (let i = 1; i < o.points.length; i++) if (distToSegment(p, o.points[i - 1], o.points[i]) <= lim) return true
      return false
    }
  }
}

export type HandleId = 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w' | 'p1' | 'p2' | 'tail'

export interface Handle {
  id: HandleId
  x: number
  y: number
}

export function rectHandles(r: Rect): Handle[] {
  const { x, y, w, h } = r
  return [
    { id: 'nw', x, y },
    { id: 'n', x: x + w / 2, y },
    { id: 'ne', x: x + w, y },
    { id: 'e', x: x + w, y: y + h / 2 },
    { id: 'se', x: x + w, y: y + h },
    { id: 's', x: x + w / 2, y: y + h },
    { id: 'sw', x, y: y + h },
    { id: 'w', x, y: y + h / 2 }
  ]
}

export function handlesOf(o: VObj): Handle[] {
  switch (o.type) {
    case 'rect':
    case 'ellipse':
    case 'redact':
      return rectHandles(objBounds(o))
    case 'line':
      return [
        { id: 'p1', x: o.x1, y: o.y1 },
        { id: 'p2', x: o.x2, y: o.y2 }
      ]
    case 'text':
      return o.tail && o.bg ? [{ id: 'tail', x: o.tail.x, y: o.tail.y }] : []
    default:
      return []
  }
}

export const HANDLE_CURSORS: Record<HandleId, string> = {
  nw: 'nwse-resize',
  se: 'nwse-resize',
  ne: 'nesw-resize',
  sw: 'nesw-resize',
  n: 'ns-resize',
  s: 'ns-resize',
  e: 'ew-resize',
  w: 'ew-resize',
  p1: 'crosshair',
  p2: 'crosshair',
  tail: 'crosshair'
}

/** Resize a rectangle by dragging one of its 8 handles. */
export function dragRectHandle(orig: Rect, id: HandleId, p: Vec, keepAspect: boolean): Rect {
  let l = orig.x
  let t = orig.y
  let r = orig.x + orig.w
  let b = orig.y + orig.h
  if (id.includes('w')) l = p.x
  if (id.includes('e')) r = p.x
  if (id.includes('n')) t = p.y
  if (id.includes('s')) b = p.y
  if (keepAspect && id.length === 2 && orig.w > 0 && orig.h > 0) {
    const aspect = orig.w / orig.h
    const w = Math.abs(r - l)
    const h = Math.abs(b - t)
    if (w / h > aspect) {
      const nh = w / aspect
      if (id.includes('n')) t = b - nh * Math.sign(b - t || 1)
      else b = t + nh * Math.sign(b - t || 1)
    } else {
      const nw = h * aspect
      if (id.includes('w')) l = r - nw * Math.sign(r - l || 1)
      else r = l + nw * Math.sign(r - l || 1)
    }
  }
  return normRect({ x: l, y: t }, { x: r, y: b })
}

/** Apply a handle drag to `o`, starting from the untouched copy `orig`. */
export function dragHandle(o: VObj, orig: VObj, id: HandleId, p: Vec, shift: boolean): void {
  if ((o.type === 'rect' || o.type === 'ellipse' || o.type === 'redact') && orig.type === o.type) {
    const r = dragRectHandle(objBounds(orig), id, p, shift)
    Object.assign(o, r)
  } else if (o.type === 'line' && orig.type === 'line') {
    if (id === 'p1') {
      const q = shift ? snap45({ x: o.x2, y: o.y2 }, p) : p
      o.x1 = q.x
      o.y1 = q.y
    } else if (id === 'p2') {
      const q = shift ? snap45({ x: o.x1, y: o.y1 }, p) : p
      o.x2 = q.x
      o.y2 = q.y
    }
  } else if (o.type === 'text' && id === 'tail') {
    o.tail = { x: p.x, y: p.y }
  }
}

/** Translate `o` to `orig` + (dx, dy). */
export function moveObject(o: VObj, orig: VObj, dx: number, dy: number): void {
  switch (o.type) {
    case 'rect':
    case 'ellipse':
    case 'redact':
    case 'step': {
      const src = orig as typeof o
      o.x = src.x + dx
      o.y = src.y + dy
      break
    }
    case 'text': {
      const src = orig as TextObj
      o.x = src.x + dx
      o.y = src.y + dy
      if (src.tail) o.tail = { x: src.tail.x + dx, y: src.tail.y + dy }
      break
    }
    case 'line': {
      const src = orig as LineObj
      o.x1 = src.x1 + dx
      o.y1 = src.y1 + dy
      o.x2 = src.x2 + dx
      o.y2 = src.y2 + dy
      break
    }
    case 'path': {
      const src = orig as PathObj
      o.points = src.points.map((q) => ({ x: q.x + dx, y: q.y + dy }))
      break
    }
  }
}

/** Translate an object in place. */
export function offsetObject(o: VObj, dx: number, dy: number): void {
  switch (o.type) {
    case 'rect':
    case 'ellipse':
    case 'redact':
    case 'step':
      o.x += dx
      o.y += dy
      break
    case 'text':
      o.x += dx
      o.y += dy
      if (o.tail) o.tail = { x: o.tail.x + dx, y: o.tail.y + dy }
      break
    case 'line':
      o.x1 += dx
      o.y1 += dy
      o.x2 += dx
      o.y2 += dy
      break
    case 'path':
      o.points = o.points.map((p) => ({ x: p.x + dx, y: p.y + dy }))
      break
  }
}

/** Apply a document-level transform (rotate/flip/scale) to an object in place. */
export function transformObject(o: VObj, map: (p: Vec) => Vec, scale: number): void {
  const mapRect = (r: { x: number; y: number; w: number; h: number }): Rect => {
    const a = map({ x: r.x, y: r.y })
    const b = map({ x: r.x + r.w, y: r.y + r.h })
    return normRect(a, b)
  }
  switch (o.type) {
    case 'rect':
    case 'ellipse':
      Object.assign(o, mapRect(o))
      o.strokeWidth *= scale
      o.radius *= scale
      break
    case 'redact':
      Object.assign(o, mapRect(o))
      o.strength = Math.max(1, o.strength * scale)
      break
    case 'line': {
      const a = map({ x: o.x1, y: o.y1 })
      const b = map({ x: o.x2, y: o.y2 })
      Object.assign(o, { x1: a.x, y1: a.y, x2: b.x, y2: b.y })
      o.width *= scale
      break
    }
    case 'text': {
      const before = textLayout(o)
      const c = map({ x: o.x + before.w / 2, y: o.y + before.h / 2 })
      o.fontSize = Math.max(4, o.fontSize * scale)
      const after = textLayout(o)
      o.x = c.x - after.w / 2
      o.y = c.y - after.h / 2
      if (o.tail) o.tail = map(o.tail)
      break
    }
    case 'step': {
      const c = map({ x: o.x, y: o.y })
      o.x = c.x
      o.y = c.y
      o.size *= scale
      break
    }
    case 'path':
      o.points = o.points.map(map)
      o.width *= scale
      break
  }
}

/** Is the object big enough to keep after a drag-create? */
export function isDegenerate(o: VObj): boolean {
  switch (o.type) {
    case 'rect':
    case 'ellipse':
    case 'redact':
      return Math.abs(o.w) < 3 && Math.abs(o.h) < 3
    case 'line':
      return Math.hypot(o.x2 - o.x1, o.y2 - o.y1) < 4
    default:
      return false
  }
}

/** The object's main colour (used when the palette is clicked with it selected). */
export function setObjectColor(o: VObj, color: string): void {
  switch (o.type) {
    case 'rect':
    case 'ellipse':
      if (o.stroke) o.stroke = color
      else o.fill = color
      break
    case 'line':
    case 'text':
    case 'step':
    case 'path':
    case 'redact':
      o.color = color
      break
  }
}

export function objectColor(o: VObj): string | null {
  switch (o.type) {
    case 'rect':
    case 'ellipse':
      return o.stroke ?? o.fill
    default:
      return o.color
  }
}
