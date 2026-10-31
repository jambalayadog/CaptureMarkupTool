import type { DocState } from './doc'
import { effectReach, hasEffects, renderEffects, type LayerEffects } from './effects'
import type { Layer, Rect, RasterLayer, Selection, TransformState, VObj } from './types'
import { drawObject, headLength, objBounds, tailArrowSize, tailsOf } from './objects'
import { clearInside, keepInside } from './selection'
import { ctx2d, intersect, makeCanvas, scratch, union } from './util'

/** Composite every visible layer of `d` into `target` (document-sized). */
export function renderDoc(d: DocState, target: HTMLCanvasElement, live: boolean, upTo?: number): void {
  const ctx = ctx2d(target)
  ctx.setTransform(1, 0, 0, 1, 0, 0)
  ctx.globalAlpha = 1
  ctx.globalCompositeOperation = 'source-over'
  ctx.filter = 'none'
  ctx.clearRect(0, 0, target.width, target.height)
  const n = upTo ?? d.layers.length
  for (let i = 0; i < n; i++) {
    const l = d.layers[i]
    if (l.visible) renderLayer(d, l, ctx, live)
  }
}

/** Copy of a raster layer with a CSS filter applied (optionally only inside `sel`). */
export function filteredLayer(l: RasterLayer, filter: string, sel: Selection | null, into?: HTMLCanvasElement): HTMLCanvasElement {
  const out = into ?? makeCanvas(l.canvas.width, l.canvas.height)
  const c = ctx2d(out)
  if (!sel) {
    c.filter = filter
    c.drawImage(l.canvas, 0, 0)
    c.filter = 'none'
    return out
  }
  // Original outside the selection plus filtered inside it. 'lighter' adds the two
  // premultiplied halves, which also blends soft (anti-aliased) mask edges correctly.
  const f = scratch('filter-full', l.canvas.width, l.canvas.height)
  const fc = ctx2d(f)
  fc.filter = filter
  fc.drawImage(l.canvas, 0, 0)
  fc.filter = 'none'
  keepInside(f, sel, l.x, l.y)
  c.drawImage(l.canvas, 0, 0)
  clearInside(out, sel, l.x, l.y)
  c.globalCompositeOperation = 'lighter'
  c.drawImage(f, 0, 0)
  c.globalCompositeOperation = 'source-over'
  return out
}

/** Document-space matrix of a free transform (maps the start position to the current one). */
export function transformMatrix(t: TransformState): DOMMatrix {
  return new DOMMatrix()
    .translate(t.cx, t.cy)
    .rotate((t.angle * 180) / Math.PI)
    .scale(t.sx, t.sy)
    .translate(-(t.start.x + t.start.w / 2), -(t.start.y + t.start.h / 2))
}

/** Draw the transformed pixels of `t` (plus the untouched rest of the layer) into `ctx`. */
export function drawTransformed(ctx: CanvasRenderingContext2D, t: TransformState, l: RasterLayer): void {
  if (t.base) ctx.drawImage(t.base, l.x, l.y)
  ctx.save()
  ctx.imageSmoothingEnabled = t.smooth
  ctx.imageSmoothingQuality = 'high'
  ctx.setTransform(ctx.getTransform().multiply(transformMatrix(t)))
  ctx.drawImage(t.src, t.start.x, t.start.y)
  ctx.restore()
}

export function renderLayer(d: DocState, l: Layer, ctx: CanvasRenderingContext2D, live: boolean): void {
  if (hasEffects(l.effects)) return renderWithEffects(d, l, l.effects, ctx, live)
  const W = ctx.canvas.width
  const H = ctx.canvas.height
  if (l.kind === 'raster') {
    const tf = live ? d.live.transform : null
    if (tf && tf.layerId === l.id) {
      const tmp = scratch('transform-preview', W, H)
      drawTransformed(ctx2d(tmp), tf, l)
      ctx.save()
      ctx.globalAlpha = l.opacity
      ctx.globalCompositeOperation = l.blend
      ctx.drawImage(tmp, 0, 0)
      ctx.restore()
      return
    }
    let src: HTMLCanvasElement = l.canvas
    const st = live ? d.live.stroke : null
    if (st && st.layerId === l.id) {
      let buf = st.buffer
      if (st.mask) {
        buf = scratch('stroke-masked', buf.width, buf.height)
        ctx2d(buf).drawImage(st.buffer, 0, 0)
        keepInside(buf, st.mask, l.x, l.y)
      }
      src = scratch('stroke-merge', l.canvas.width, l.canvas.height)
      const s = ctx2d(src)
      s.drawImage(l.canvas, 0, 0)
      s.globalAlpha = st.alpha
      s.globalCompositeOperation = st.erase ? 'destination-out' : 'source-over'
      s.drawImage(buf, 0, 0)
      s.globalAlpha = 1
      s.globalCompositeOperation = 'source-over'
    }
    const pf = live ? d.live.previewFilter : null
    if (pf && pf.layerId === l.id) {
      src = filteredLayer({ ...l, canvas: src }, pf.filter, d.selection, scratch('filter-preview', src.width, src.height))
    }
    ctx.save()
    ctx.globalAlpha = l.opacity
    ctx.globalCompositeOperation = l.blend
    ctx.drawImage(src, l.x, l.y)
    ctx.restore()
    return
  }

  const hideId = live ? d.live.editingTextId : null
  if (l.opacity >= 1 && l.blend === 'source-over') {
    // Draw straight onto the composite so per-object blends (highlighter) and
    // redaction see everything beneath them.
    for (const o of l.objects) drawObject(ctx, o, { source: ctx.canvas, hideText: o.id === hideId })
    return
  }
  const tmp = scratch('vector-layer', W, H)
  const t = ctx2d(tmp)
  for (const o of l.objects) {
    let source: HTMLCanvasElement | null = null
    if (o.type === 'redact') {
      source = scratch('redact-src', W, H)
      const s = ctx2d(source)
      s.drawImage(ctx.canvas, 0, 0)
      s.drawImage(tmp, 0, 0)
    }
    drawObject(t, o, { source, hideText: o.id === hideId })
  }
  ctx.save()
  ctx.globalAlpha = l.opacity
  ctx.globalCompositeOperation = l.blend
  ctx.drawImage(tmp, 0, 0)
  ctx.restore()
}

// ---- layer effects ------------------------------------------------------------------

/**
 * A layer with effects is drawn on its own first, so its shape can cast them. That
 * also means a highlighter on such a layer can't multiply with the layers beneath.
 */
function renderWithEffects(d: DocState, l: Layer, fx: LayerEffects, ctx: CanvasRenderingContext2D, live: boolean): void {
  const W = ctx.canvas.width
  const H = ctx.canvas.height
  const content = scratch('fx-content', W, H)
  const busy = drawContent(d, l, ctx2d(content), ctx.canvas, live)
  const effects = effectsFor(d, l, fx, content, busy, live)
  if (l.opacity >= 1 && l.blend === 'source-over') {
    if (effects) ctx.drawImage(effects.canvas, effects.x, effects.y)
    ctx.drawImage(content, 0, 0)
    return
  }
  // opacity and blend apply to the layer and its effects together
  const group = scratch('fx-group', W, H)
  const g = ctx2d(group)
  if (effects) g.drawImage(effects.canvas, effects.x, effects.y)
  g.drawImage(content, 0, 0)
  ctx.save()
  ctx.globalAlpha = l.opacity
  ctx.globalCompositeOperation = l.blend
  ctx.drawImage(group, 0, 0)
  ctx.restore()
}

/**
 * The layer's own pixels at full opacity, in document space. Returns true while a
 * live edit (brush stroke, free transform, adjustment preview) is changing them.
 */
function drawContent(d: DocState, l: Layer, c: CanvasRenderingContext2D, backdrop: HTMLCanvasElement, live: boolean): boolean {
  const W = c.canvas.width
  const H = c.canvas.height
  if (l.kind === 'raster') {
    const tf = live ? d.live.transform : null
    if (tf && tf.layerId === l.id) {
      drawTransformed(c, tf, l)
      return true
    }
    let src: HTMLCanvasElement = l.canvas
    let busy = false
    const st = live ? d.live.stroke : null
    if (st && st.layerId === l.id) {
      let buf = st.buffer
      if (st.mask) {
        buf = scratch('fx-stroke-masked', buf.width, buf.height)
        ctx2d(buf).drawImage(st.buffer, 0, 0)
        keepInside(buf, st.mask, l.x, l.y)
      }
      src = scratch('fx-stroke-merge', l.canvas.width, l.canvas.height)
      const s = ctx2d(src)
      s.drawImage(l.canvas, 0, 0)
      s.globalAlpha = st.alpha
      s.globalCompositeOperation = st.erase ? 'destination-out' : 'source-over'
      s.drawImage(buf, 0, 0)
      busy = true
    }
    const pf = live ? d.live.previewFilter : null
    if (pf && pf.layerId === l.id) {
      src = filteredLayer({ ...l, canvas: src }, pf.filter, d.selection, scratch('fx-filter-preview', src.width, src.height))
      busy = true
    }
    c.drawImage(src, l.x, l.y)
    return busy
  }
  const hideId = live ? d.live.editingTextId : null
  for (const o of l.objects) {
    let source: HTMLCanvasElement | null = null
    if (o.type === 'redact') {
      source = scratch('fx-redact-src', W, H)
      const s = ctx2d(source)
      s.drawImage(backdrop, 0, 0)
      s.drawImage(c.canvas, 0, 0)
    }
    drawObject(c, o, { source, hideText: o.id === hideId })
  }
  return false
}

const canvasIds = new WeakMap<HTMLCanvasElement, number>()
let nextCanvasId = 1
function canvasId(c: HTMLCanvasElement): number {
  let id = canvasIds.get(c)
  if (!id) canvasIds.set(c, (id = nextCanvasId++))
  return id
}

/** Rendered effects per layer, reused until the layer's content or settings change. */
const fxCache = new Map<string, { key: string; canvas: HTMLCanvasElement; x: number; y: number }>()

function effectsFor(d: DocState, l: Layer, fx: LayerEffects, content: HTMLCanvasElement, busy: boolean, live: boolean): { canvas: HTMLCanvasElement; x: number; y: number } | null {
  const W = content.width
  const H = content.height
  // Pixel layers change through committed edits (rev); annotation layers can change
  // mid-drag, so they key on their objects (and on rev if a redaction samples beneath).
  const what =
    l.kind === 'raster'
      ? `r${canvasId(l.canvas)}@${l.x},${l.y}#${d.rev}`
      : `v${JSON.stringify(l.objects)}|${live ? d.live.editingTextId : ''}|${l.objects.some((o) => o.type === 'redact') ? d.rev : ''}`
  const key = `${what}|${W}x${H}|${JSON.stringify(fx)}`
  const hit = fxCache.get(l.id)
  // mid-stroke or mid-transform, keep showing the last effects until the edit is applied
  if (hit && (hit.key === key || busy)) return hit
  const doc = { x: 0, y: 0, w: W, h: H }
  const shape = busy ? doc : l.kind === 'raster' ? { x: l.x, y: l.y, w: l.canvas.width, h: l.canvas.height } : objectsBounds(l.objects)
  if (!shape) return null
  const reach = effectReach(fx)
  const region = intersect({ x: Math.floor(shape.x - reach), y: Math.floor(shape.y - reach), w: Math.ceil(shape.w + reach * 2), h: Math.ceil(shape.h + reach * 2) }, doc)
  if (!region) return null
  const entry = { key, canvas: renderEffects(content, region, fx), x: region.x, y: region.y }
  if (fxCache.size > 64) fxCache.clear()
  fxCache.set(l.id, entry)
  return entry
}

/** Everything the objects draw: arrowheads, outlines, callout pointers and object shadows. */
function objectsBounds(objects: VObj[]): Rect | null {
  let b: Rect | null = null
  for (const o of objects) {
    let r = objBounds(o)
    if (o.type === 'text') for (const t of tailsOf(o)) r = union(r, { x: t.x, y: t.y, w: 1, h: 1 })
    const reach =
      o.type === 'line' ? headLength(o) + o.width : o.type === 'rect' || o.type === 'ellipse' ? o.strokeWidth : o.type === 'text' ? tailArrowSize(o).head : 0
    const pad = 12 + reach
    b = union(b, { x: r.x - pad, y: r.y - pad, w: r.w + pad * 2, h: r.h + pad * 2 })
  }
  return b
}

/** A layer's pixels with its effects baked in (document-sized), for merging. */
export function bakeLayer(d: DocState, l: Layer): HTMLCanvasElement {
  const out = makeCanvas(d.width, d.height)
  const o = ctx2d(out)
  renderLayer(d, { ...l, opacity: 1, blend: 'source-over' }, o, false)
  return out
}

/** Flattened copy of the document. `background` fills transparent areas (for JPEG). */
export function flattenDoc(d: DocState, background?: string): HTMLCanvasElement {
  const c = makeCanvas(d.width, d.height)
  renderDoc(d, c, false)
  if (!background) return c
  const out = makeCanvas(d.width, d.height)
  const o = ctx2d(out)
  o.fillStyle = background
  o.fillRect(0, 0, d.width, d.height)
  o.drawImage(c, 0, 0)
  return out
}

/** Small preview of a single layer for the layers panel. */
export function renderThumb(d: DocState, l: Layer, thumb: HTMLCanvasElement): void {
  const c = ctx2d(thumb)
  c.setTransform(1, 0, 0, 1, 0, 0)
  c.clearRect(0, 0, thumb.width, thumb.height)
  const s = Math.min(thumb.width / d.width, thumb.height / d.height)
  const ox = (thumb.width - d.width * s) / 2
  const oy = (thumb.height - d.height * s) / 2
  c.save()
  c.beginPath()
  c.rect(ox, oy, d.width * s, d.height * s)
  c.clip()
  c.setTransform(s, 0, 0, s, ox, oy)
  c.imageSmoothingEnabled = true
  c.imageSmoothingQuality = 'medium'
  if (l.kind === 'raster') c.drawImage(l.canvas, l.x, l.y)
  else for (const o of l.objects) drawObject(c, o, { source: null })
  c.restore()
}
