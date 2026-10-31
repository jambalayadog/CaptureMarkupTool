import type { LineObj, PathObj, Rect, RedactObj, ShapeObj, StepObj, Tail, TextObj, VObj, Vec } from './types'
import { clamp, contrastText, ctx2d, distToSegment, normRect, pixelRect, scratch, snap45 } from './util'

// ---- text layout -------------------------------------------------------------

const measure = ctx2d(document.createElement('canvas'))

export const fontOf = (o: Pick<TextObj, 'bold' | 'fontSize' | 'fontFamily'>): string =>
  `${o.bold ? 700 : 400} ${o.fontSize}px ${o.fontFamily}`

export interface TextLayout {
  /** Lines after wrapping, as drawn. */
  lines: string[]
  /** Width of each line, for alignment. */
  widths: number[]
  lineH: number
  pad: number
  w: number
  h: number
  /** Top of the first line, from the top of the box (vertical alignment). */
  top: number
  /** Distance from the top of a line box to its baseline (CSS line-box model). */
  baseline: number
}

/**
 * Word-wrap one paragraph to `maxW` the way a textarea with pre-wrap and
 * overflow-wrap: break-word does, so editing and the final render agree.
 */
function wrapParagraph(text: string, maxW: number): string[] {
  const width = (s: string): number => measure.measureText(s).width
  if (width(text) <= maxW) return [text]
  const out: string[] = []
  let line = ''
  for (let tok of text.match(/\s+|\S+\s*/g) ?? ['']) {
    // trailing spaces hang past the edge, so they never force a wrap
    if (width((line + tok).trimEnd()) <= maxW) {
      line += tok
      continue
    }
    if (line) out.push(line)
    line = ''
    // a word wider than the box breaks between characters
    while (tok.trimEnd().length > 1 && width(tok.trimEnd()) > maxW) {
      let n = 1
      while (n < tok.length && width(tok.slice(0, n + 1)) <= maxW) n++
      out.push(tok.slice(0, n))
      tok = tok.slice(n)
    }
    line = tok
  }
  out.push(line)
  return out
}

export function textLayout(o: TextObj): TextLayout {
  measure.font = fontOf(o)
  const m = measure.measureText('Mg')
  const asc = m.fontBoundingBoxAscent ?? o.fontSize * 0.8
  const desc = m.fontBoundingBoxDescent ?? o.fontSize * 0.2
  const lineH = Math.round(o.fontSize * 1.25)
  const pad = o.bg ? Math.round(o.fontSize * 0.45) : Math.round(o.fontSize * 0.12)
  // older projects have no box or alignment fields
  const boxW = o.boxW ?? null
  const paragraphs = o.text.split('\n')
  const lines = boxW == null ? paragraphs : paragraphs.flatMap((p) => wrapParagraph(p, Math.max(1, boxW - pad * 2)))
  const widths = lines.map((l) => measure.measureText(boxW == null ? l : l.trimEnd()).width)
  const natural = lines.length * lineH + pad * 2
  const h = Math.max(natural, o.boxH ?? 0)
  const valign = o.valign ?? 'top'
  return {
    lines,
    widths,
    lineH,
    pad,
    w: boxW ?? Math.ceil(Math.max(o.fontSize * 0.5, ...widths) + pad * 2),
    h,
    top: pad + (valign === 'middle' ? (h - natural) / 2 : valign === 'bottom' ? h - natural : 0),
    baseline: (lineH - (asc + desc)) / 2 + asc
  }
}

/** Left edge of line `i`, following the object's horizontal alignment. */
export function lineX(o: TextObj, L: TextLayout, i: number): number {
  const room = L.w - L.pad * 2 - L.widths[i]
  const align = o.align ?? 'left'
  return o.x + L.pad + (align === 'center' ? room / 2 : align === 'right' ? room : 0)
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

/** Older arrows sized their heads from the line width (times a percentage). */
const legacyHead = (o: LineObj): number => Math.max(10, o.width * 3.2 + 6) * ((o as { headScale?: number }).headScale ?? 1)

/** Arrowhead size in px at one end of a line. */
export function headSize(o: LineObj, end: 'start' | 'end'): number {
  return (end === 'start' ? o.startSize : o.endSize) ?? legacyHead(o)
}

/** The bigger of a line's two heads (for bounds). */
export function headLength(o: LineObj): number {
  return Math.max(headSize(o, 'start'), headSize(o, 'end'))
}

// ---- line paths: straight, or a smooth curve through bend points ---------------

const pointsOf = (o: LineObj): Vec[] => [{ x: o.x1, y: o.y1 }, ...(o.via ?? []), { x: o.x2, y: o.y2 }]

type Cubic = [Vec, Vec, Vec, Vec]

/** The stretch of curve from point i to i+1, as a cubic Bézier (Catmull-Rom through every point). */
function curveSegment(pts: Vec[], i: number): Cubic {
  const p0 = pts[i - 1] ?? pts[i]
  const p1 = pts[i]
  const p2 = pts[i + 1]
  const p3 = pts[i + 2] ?? pts[i + 1]
  return [p1, { x: p1.x + (p2.x - p0.x) / 6, y: p1.y + (p2.y - p0.y) / 6 }, { x: p2.x - (p3.x - p1.x) / 6, y: p2.y - (p3.y - p1.y) / 6 }, p2]
}

function bezierAt(c: Cubic, t: number): Vec {
  const u = 1 - t
  const a = u * u * u
  const b = 3 * u * u * t
  const d = 3 * u * t * t
  const e = t * t * t
  return { x: a * c[0].x + b * c[1].x + d * c[2].x + e * c[3].x, y: a * c[0].y + b * c[1].y + d * c[2].y + e * c[3].y }
}

/** A line's centre as a polyline: its two ends, or samples along the curve through its bends. */
export function linePath(o: LineObj): Vec[] {
  const pts = pointsOf(o)
  if (pts.length === 2) return pts
  const out = [pts[0]]
  for (let i = 0; i < pts.length - 1; i++) {
    const seg = curveSegment(pts, i)
    const n = Math.max(8, Math.ceil(Math.hypot(seg[3].x - seg[0].x, seg[3].y - seg[0].y) / 5))
    for (let k = 1; k <= n; k++) out.push(bezierAt(seg, k / n))
  }
  return out
}

function pathLength(pts: Vec[]): number {
  let len = 0
  for (let i = 1; i < pts.length; i++) len += Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y)
  return len
}

/** The path with `d` px cut off its start. */
function trimStart(pts: Vec[], d: number): Vec[] {
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1]
    const b = pts[i]
    const seg = Math.hypot(b.x - a.x, b.y - a.y)
    if (d <= seg) {
      const t = seg ? d / seg : 0
      return [{ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t }, ...pts.slice(i)]
    }
    d -= seg
  }
  return [pts[pts.length - 1], pts[pts.length - 1]]
}

const trimEnd = (pts: Vec[], d: number): Vec[] => trimStart([...pts].reverse(), d).reverse()

/** A filled outline of the path at width 2·hw (a rectangle for a straight line). */
function outlineOf(pts: Vec[], hw: number): Vec[] {
  const left: Vec[] = []
  const right: Vec[] = []
  for (let i = 0; i < pts.length; i++) {
    const a = pts[Math.max(0, i - 1)]
    const b = pts[Math.min(pts.length - 1, i + 1)]
    const len = Math.hypot(b.x - a.x, b.y - a.y) || 1
    const nx = (-(b.y - a.y) / len) * hw
    const ny = ((b.x - a.x) / len) * hw
    left.push({ x: pts[i].x + nx, y: pts[i].y + ny })
    right.push({ x: pts[i].x - nx, y: pts[i].y - ny })
  }
  return [...left, ...right.reverse()]
}

interface LineGeom {
  /** The centre line between the heads. */
  shaft: Vec[]
  heads: Path2D
  full: Path2D
}

function lineGeom(o: LineObj): LineGeom {
  const path = linePath(o)
  const len = pathLength(path) || 0.0001
  const hw = o.width / 2
  const heads = new Path2D()
  const full = new Path2D()
  const both = o.start === 'arrow' && o.end === 'arrow'
  const maxHead = len * (both ? 0.45 : 0.9)

  // Returns how much of the path the head covers (the shaft stops there).
  const addHead = (end: 'start' | 'end', kind: LineObj['end']): number => {
    const ordered = end === 'end' ? path : [...path].reverse()
    const tip = ordered[ordered.length - 1]
    if (kind === 'arrow') {
      // never narrower than the line, and shrunk to fit a short line
      const L = Math.max(o.width * 1.5, Math.min(headSize(o, end), Math.max(maxHead, o.width * 1.5)))
      // point along the curve: from L back along the path to the tip
      const back = trimEnd(ordered, Math.min(L, len)).at(-1)!
      const dl = Math.hypot(tip.x - back.x, tip.y - back.y) || 1
      const dir = { x: (tip.x - back.x) / dl, y: (tip.y - back.y) / dl }
      const n = { x: -dir.y, y: dir.x }
      const W = L * 0.52
      const base = { x: tip.x - dir.x * L, y: tip.y - dir.y * L }
      const notch = { x: tip.x - dir.x * L * 0.74, y: tip.y - dir.y * L * 0.74 }
      const poly = [tip, { x: base.x + n.x * W, y: base.y + n.y * W }, notch, { x: base.x - n.x * W, y: base.y - n.y * W }]
      addPoly(heads, poly)
      addPoly(full, poly)
      return L * 0.62
    }
    if (kind === 'dot') {
      const r = Math.max(o.width * 0.8, headSize(o, end) * 0.4)
      addCircle(heads, tip, r)
      addCircle(full, tip, r)
    }
    return 0
  }
  const cutEnd = addHead('end', o.end)
  const cutStart = addHead('start', o.start)
  let shaft = trimEnd(trimStart(path, cutStart), cutEnd)
  if (cutStart + cutEnd >= len) {
    // the heads meet: no shaft between them
    const mid = trimStart(path, len / 2)[0]
    shaft = [mid, mid]
  }
  addPoly(full, outlineOf(shaft, hw))
  if (o.start === 'none') addCircle(full, path[0], hw)
  if (o.end === 'none') addCircle(full, path[path.length - 1], hw)
  return { shaft, heads, full }
}

/** Knobs beside the middle of each stretch of a line, for adding a bend there. */
function bendKnobs(o: LineObj, gap: number): Handle[] {
  const pts = pointsOf(o)
  const out: Handle[] = []
  for (let i = 0; i < pts.length - 1; i++) {
    const seg = curveSegment(pts, i)
    const mid = bezierAt(seg, 0.5)
    const a = bezierAt(seg, 0.45)
    const b = bezierAt(seg, 0.55)
    const len = Math.hypot(b.x - a.x, b.y - a.y) || 1
    out.push({ id: `add-via-${i}`, x: mid.x - ((b.y - a.y) / len) * gap, y: mid.y + ((b.x - a.x) / len) * gap })
  }
  return out
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
  ctx.lineJoin = 'round'
  ctx.setLineDash([o.width * 2.4, o.width * 1.6])
  ctx.beginPath()
  g.shaft.forEach((q, i) => (i ? ctx.lineTo(q.x, q.y) : ctx.moveTo(q.x, q.y)))
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

/** A text object's callout pointers (older projects had a single `tail`). */
export const tailsOf = (o: TextObj): Tail[] => o.tails ?? []

const bubbleRadius = (o: TextObj, L: TextLayout): number => Math.min(o.fontSize * 0.3, L.w / 2, L.h / 2)

/** The point inside the box a pointer comes from. */
function anchorOf(o: TextObj, L: TextLayout, t: Tail): Vec {
  return { x: o.x + (t.ax ?? 0.5) * L.w, y: o.y + (t.ay ?? 0.5) * L.h }
}

const tipInside = (o: TextObj, L: TextLayout, t: Tail): boolean => t.x > o.x && t.x < o.x + L.w && t.y > o.y && t.y < o.y + L.h

/** Pointers are wedges of the bubble, or arrows: when chosen, and always on text without a background. */
const arrowTails = (o: TextObj): boolean => !o.bg || !!o.arrows

/** A pointer's width (an arrow's line; a wedge is 6× that across its base). */
const tailWidthOf = (o: TextObj): number => o.tailWidth ?? Math.max(2, Math.round(o.fontSize / 7))

/** A pointer arrow's line width and head size (which follows the width). */
export function tailArrowSize(o: TextObj): { width: number; head: number } {
  const width = tailWidthOf(o)
  return { width, head: Math.round(width * 3 + 16) }
}

/** A wedge from base corners b1, b2 to a blunt tip `tipW` wide. */
function wedge(b1: Vec, b2: Vec, tip: Vec, tipW: number): Vec[] {
  const m = { x: (b1.x + b2.x) / 2, y: (b1.y + b2.y) / 2 }
  const len = Math.hypot(tip.x - m.x, tip.y - m.y) || 1
  let n = { x: -(tip.y - m.y) / len, y: (tip.x - m.x) / len }
  // the tip's corners go on the same sides as the base's, so the outline doesn't cross itself
  if (n.x * (b1.x - m.x) + n.y * (b1.y - m.y) < 0) n = { x: -n.x, y: -n.y }
  const h = tipW / 2
  return [b1, { x: tip.x + n.x * h, y: tip.y + n.y * h }, { x: tip.x - n.x * h, y: tip.y - n.y * h }, b2]
}

/**
 * Where a pointer leaves the box (on the line from its anchor to its tip) and the
 * shape it draws: a wedge with its base along that side of the box, or an arrow.
 * Null when the tip is inside the box.
 */
function tailShape(o: TextObj, L: TextLayout, t: Tail): { base: Vec; path: Path2D } | null {
  if (tipInside(o, L, t)) return null
  const a = anchorOf(o, L, t)
  const dx = t.x - a.x
  const dy = t.y - a.y
  const sx = dx > 0 ? (o.x + L.w - a.x) / dx : dx < 0 ? (o.x - a.x) / dx : Infinity
  const sy = dy > 0 ? (o.y + L.h - a.y) / dy : dy < 0 ? (o.y - a.y) / dy : Infinity
  const s = Math.max(0, Math.min(sx, sy))
  const base = { x: a.x + dx * s, y: a.y + dy * s }
  const r = bubbleRadius(o, L)
  const path = new Path2D()
  if (arrowTails(o)) {
    // starts inside a box (so it meets a rounded corner too), or a little way off plain text
    const dist = Math.hypot(dx, dy)
    const left = Math.hypot(t.x - base.x, t.y - base.y)
    const off = o.bg ? -r : Math.min(o.fontSize * 0.15, left / 2)
    const { width, head } = tailArrowSize(o)
    const line: LineObj = {
      id: '',
      type: 'line',
      x1: base.x + (dx / dist) * off,
      y1: base.y + (dy / dist) * off,
      x2: t.x,
      y2: t.y,
      color: '',
      width,
      start: 'none',
      end: 'arrow',
      startSize: head,
      endSize: head,
      via: [],
      dashed: false,
      shadow: false
    }
    path.addPath(lineGeom(line).full)
    return { base, path }
  }
  // the base fits on the straight part of the side it leaves from; the tip is at least 2px across
  const w = tailWidthOf(o)
  const tipW = Math.max(2, w / 2)
  const half = clamp(w * 3, tipW, Math.max(tipW, ((sx < sy ? L.h : L.w) - r * 2) / 2))
  // keep the base on the straight part of that side; nudge it 1px in so it joins without a seam
  if (sx < sy) {
    const lo = o.y + r + half
    const hi = o.y + L.h - r - half
    const y = lo <= hi ? clamp(base.y, lo, hi) : o.y + L.h / 2
    const x = base.x + (dx > 0 ? -1 : 1)
    addPoly(path, wedge({ x, y: y - half }, { x, y: y + half }, t, tipW))
    return { base: { x: base.x, y }, path }
  }
  const lo = o.x + r + half
  const hi = o.x + L.w - r - half
  const x = lo <= hi ? clamp(base.x, lo, hi) : o.x + L.w / 2
  const y = base.y + (dy > 0 ? -1 : 1)
  addPoly(path, wedge({ x: x - half, y }, { x: x + half, y }, t, tipW))
  return { base: { x, y: base.y }, path }
}

/** The background box and pointers, filled in one go so the shadow falls behind them all. Null if nothing shows. */
function textShape(o: TextObj, L: TextLayout): Path2D | null {
  const p = new Path2D()
  let any = false
  if (o.bg) {
    p.roundRect(o.x, o.y, L.w, L.h, bubbleRadius(o, L))
    any = true
  }
  for (const t of tailsOf(o)) {
    const shape = tailShape(o, L, t)
    if (!shape) continue
    p.addPath(shape.path)
    any = true
  }
  return any ? p : null
}

function drawText(ctx: CanvasRenderingContext2D, o: TextObj, hideText: boolean): void {
  const L = textLayout(o)
  shadowOn(ctx, o.shadow)
  const shape = textShape(o, L)
  if (shape) {
    // pointers on plain text are drawn in the text colour
    ctx.fillStyle = o.bg ?? o.color
    ctx.fill(shape)
  }
  // text on a box casts no shadow of its own
  if (o.bg) ctx.shadowColor = 'transparent'
  if (hideText) return
  ctx.font = fontOf(o)
  ctx.fillStyle = o.color
  ctx.textBaseline = 'alphabetic'
  const wrapped = o.boxW != null
  L.lines.forEach((line, i) => ctx.fillText(wrapped ? line.trimEnd() : line, lineX(o, L, i), o.y + L.top + i * L.lineH + L.baseline))
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
  ctx.fillStyle = o.textColor ?? contrastText(o.color)
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
      const path = linePath(o)
      const xs = path.map((q) => q.x)
      const ys = path.map((q) => q.y)
      return normRect({ x: Math.min(...xs), y: Math.min(...ys) }, { x: Math.max(...xs), y: Math.max(...ys) })
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
      if (o.type === 'text') {
        const L = textLayout(o)
        return tailsOf(o).some((t) => distToSegment(p, anchorOf(o, L, t), t) <= tol + 4)
      }
      return false
    }
    case 'line': {
      // the shaft (with some slack), or anywhere on the drawn heads
      const path = linePath(o)
      for (let i = 1; i < path.length; i++) if (distToSegment(p, path[i - 1], path[i]) <= o.width / 2 + tol) return true
      return (o.start !== 'none' || o.end !== 'none') && measure.isPointInPath(lineGeom(o).full, p.x, p.y)
    }
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

export type RectHandleId = 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w'
/** Callout pointers: `tail-N` is a tip, `base-N` slides where it leaves the box, `add-tail` makes a new one. */
export type HandleId =
  | RectHandleId
  | 'p1'
  | 'p2'
  | `via-${number}`
  | `add-via-${number}`
  | `tail-${number}`
  | `base-${number}`
  | 'add-tail'

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

/** Handles of `o`, topmost first. `zoom` keeps the "add pointer" knob a fixed distance away on screen. */
export function handlesOf(o: VObj, zoom = 1): Handle[] {
  switch (o.type) {
    case 'rect':
    case 'ellipse':
    case 'redact':
      return rectHandles(objBounds(o))
    case 'line':
      // ends, bend points, then a "+" beside each stretch to add a bend
      return [
        { id: 'p1', x: o.x1, y: o.y1 },
        { id: 'p2', x: o.x2, y: o.y2 },
        ...(o.via ?? []).map((v, i): Handle => ({ id: `via-${i}`, x: v.x, y: v.y })),
        ...bendKnobs(o, 14 / zoom)
      ]
    case 'text': {
      // the box resizes (text wraps to it); then its pointers and a knob for adding one
      const box = rectHandles(objBounds(o))
      const L = textLayout(o)
      const pointers: Handle[] = []
      tailsOf(o).forEach((t, i) => {
        const shape = tailShape(o, L, t)
        pointers.push({ id: `tail-${i}`, x: t.x, y: t.y })
        if (shape) pointers.push({ id: `base-${i}`, ...shape.base })
      })
      const gap = 18 / zoom
      return [...pointers, ...box, { id: 'add-tail', x: o.x + L.w + gap, y: o.y - gap }]
    }
    default:
      return []
  }
}

const RESIZE_CURSORS: Record<RectHandleId, string> = {
  nw: 'nwse-resize',
  se: 'nwse-resize',
  ne: 'nesw-resize',
  sw: 'nesw-resize',
  n: 'ns-resize',
  s: 'ns-resize',
  e: 'ew-resize',
  w: 'ew-resize'
}

export function handleCursor(id: HandleId): string {
  if (id === 'add-tail' || id.startsWith('add-via-')) return 'copy'
  if (id.startsWith('base-')) return 'move'
  return RESIZE_CURSORS[id as RectHandleId] ?? 'crosshair'
}

const handleIndex = (id: string): number => Number(id.slice(id.lastIndexOf('-') + 1))

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

/**
 * Apply a handle drag to `o`, starting from the untouched copy `orig`. Returns the
 * handle to keep dragging (dragging "add pointer" turns into dragging the new tip).
 */
export function dragHandle(o: VObj, orig: VObj, id: HandleId, p: Vec, shift: boolean): HandleId {
  if (o.type === 'line' && (id.startsWith('via-') || id.startsWith('add-via-'))) {
    o.via = [...(o.via ?? [])]
    const i = handleIndex(id)
    if (id.startsWith('add-via-')) {
      o.via.splice(i, 0, { x: p.x, y: p.y })
      return `via-${i}`
    }
    if (o.via[i]) o.via[i] = { x: p.x, y: p.y }
    return id
  }
  if (o.type === 'text' && (id === 'add-tail' || id.startsWith('tail-') || id.startsWith('base-'))) {
    o.tails = [...tailsOf(o)]
    if (id === 'add-tail') {
      o.tails.push({ x: p.x, y: p.y, ax: 0.5, ay: 0.5 })
      return `tail-${o.tails.length - 1}`
    }
    const i = handleIndex(id)
    const t = o.tails[i]
    if (!t) return id
    if (id.startsWith('tail-')) o.tails[i] = { ...t, x: p.x, y: p.y }
    else {
      // the base follows the pointer, kept inside the box
      const L = textLayout(o)
      o.tails[i] = { ...t, ax: clamp((p.x - o.x) / L.w, 0, 1), ay: clamp((p.y - o.y) / L.h, 0, 1) }
    }
    return id
  }
  dragOther(o, orig, id, p, shift)
  return id
}

/** A click on a handle without dragging it: the "add pointer" knob adds one below the bubble. */
export function clickHandle(o: VObj, id: HandleId): boolean {
  if (o.type !== 'text' || id !== 'add-tail') return false
  const L = textLayout(o)
  o.tails = [...tailsOf(o), { x: o.x + L.w + o.fontSize * 1.5, y: o.y + L.h + o.fontSize * 1.5, ax: 0.5, ay: 0.5 }]
  return true
}

/** Double-clicking a bend point straightens the line there. */
export function removeBend(o: VObj, id: HandleId): boolean {
  if (o.type !== 'line' || !id.startsWith('via-') || id.startsWith('add-')) return false
  o.via = (o.via ?? []).filter((_, i) => i !== handleIndex(id))
  return true
}

/** After a handle drag: a pointer dragged back inside its bubble is removed. */
export function endHandleDrag(o: VObj): void {
  if (o.type !== 'text' || !tailsOf(o).length) return
  const L = textLayout(o)
  o.tails = tailsOf(o).filter((t) => !tipInside(o, L, t))
}

function dragOther(o: VObj, orig: VObj, id: HandleId, p: Vec, shift: boolean): void {
  if ((o.type === 'rect' || o.type === 'ellipse' || o.type === 'redact') && orig.type === o.type) {
    const r = dragRectHandle(objBounds(orig), id, p, shift)
    Object.assign(o, r)
  } else if (o.type === 'line' && orig.type === 'line') {
    // Shift snaps an end to 45° from its neighbour (the nearest bend, or the other end)
    const via = o.via ?? []
    if (id === 'p1') {
      const q = shift ? snap45(via[0] ?? { x: o.x2, y: o.y2 }, p) : p
      o.x1 = q.x
      o.y1 = q.y
    } else if (id === 'p2') {
      const q = shift ? snap45(via[via.length - 1] ?? { x: o.x1, y: o.y1 }, p) : p
      o.x2 = q.x
      o.y2 = q.y
    }
  } else if (o.type === 'text' && orig.type === 'text') {
    // Resizing a text box changes the box, not the font: width wraps the text, and
    // height can add room (it never shrinks past the text).
    const r = dragRectHandle(objBounds(orig), id, p, false)
    if (id.includes('e') || id.includes('w')) {
      const L = textLayout(orig)
      o.boxW = Math.max(Math.ceil(o.fontSize + L.pad * 2), Math.round(r.w))
      o.x = id.includes('w') ? Math.round(r.x + r.w - o.boxW) : Math.round(r.x)
    }
    if (id.includes('n') || id.includes('s')) {
      const natural = textLayout({ ...o, boxH: null }).h
      o.boxH = Math.max(natural, Math.round(r.h))
      o.y = id.includes('n') ? Math.round(r.y + r.h - o.boxH) : Math.round(r.y)
    }
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
      o.tails = tailsOf(src).map((t) => ({ ...t, x: t.x + dx, y: t.y + dy }))
      break
    }
    case 'line': {
      const src = orig as LineObj
      o.x1 = src.x1 + dx
      o.y1 = src.y1 + dy
      o.x2 = src.x2 + dx
      o.y2 = src.y2 + dy
      o.via = (src.via ?? []).map((v) => ({ x: v.x + dx, y: v.y + dy }))
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
      o.tails = tailsOf(o).map((t) => ({ ...t, x: t.x + dx, y: t.y + dy }))
      break
    case 'line':
      o.x1 += dx
      o.y1 += dy
      o.x2 += dx
      o.y2 += dy
      o.via = (o.via ?? []).map((v) => ({ x: v.x + dx, y: v.y + dy }))
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
      o.via = (o.via ?? []).map(map)
      o.width *= scale
      o.startSize = headSize(o, 'start') * scale
      o.endSize = headSize(o, 'end') * scale
      break
    }
    case 'text': {
      const before = textLayout(o)
      const anchors = tailsOf(o).map((t) => map(anchorOf(o, before, t)))
      const c = map({ x: o.x + before.w / 2, y: o.y + before.h / 2 })
      o.tailWidth = Math.max(1, tailWidthOf(o) * scale)
      o.fontSize = Math.max(4, o.fontSize * scale)
      if (o.boxW != null) o.boxW *= scale
      if (o.boxH != null) o.boxH *= scale
      const after = textLayout(o)
      o.x = c.x - after.w / 2
      o.y = c.y - after.h / 2
      // pointer tips follow the transform; each base keeps its spot on the (unrotated) box
      o.tails = tailsOf(o).map((t, i) => {
        const tip = map(t)
        return { x: tip.x, y: tip.y, ax: clamp((anchors[i].x - o.x) / after.w, 0, 1), ay: clamp((anchors[i].y - o.y) / after.h, 0, 1) }
      })
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

/** A short name for an object, for menus and lists: "Arrow", "Text “Hello…”", "Step 3". */
export function describeObject(o: VObj): string {
  switch (o.type) {
    case 'line': {
      const name = o.start === 'arrow' && o.end === 'arrow' ? 'Double arrow' : o.start === 'none' && o.end === 'none' ? 'Line' : 'Arrow'
      return o.via?.length ? `Curved ${name.toLowerCase()}` : name
    }
    case 'rect':
      return 'Rectangle'
    case 'ellipse':
      return 'Ellipse'
    case 'text': {
      const kind = tailsOf(o).length ? 'Callout' : 'Text'
      const first = o.text.trim().split('\n')[0]
      if (!first) return kind
      return `${kind} “${first.length > 24 ? `${first.slice(0, 23)}…` : first}”`
    }
    case 'step':
      return `Step ${o.n}`
    case 'path':
      return o.blend === 'multiply' ? 'Highlight' : 'Stroke'
    case 'redact':
      return { pixelate: 'Pixelate', blur: 'Blur', solid: 'Solid' }[o.mode] + ' redaction'
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
