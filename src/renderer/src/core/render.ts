import type { DocState } from './doc'
import type { Layer, RasterLayer, Selection, TransformState } from './types'
import { drawObject } from './objects'
import { clearInside, keepInside } from './selection'
import { ctx2d, makeCanvas, scratch } from './util'

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
