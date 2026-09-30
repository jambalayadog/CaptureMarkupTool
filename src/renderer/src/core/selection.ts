// Pixel selections: rectangles, or arbitrary shapes stored as alpha masks.
import type { FillMask } from './raster'
import type { Rect, SelectMode, Selection, Vec } from './types'
import { ctx2d, intersect, makeCanvas, pixelRect, union } from './util'

export const rectSel = (r: Rect): Selection => ({ x: r.x, y: r.y, w: r.w, h: r.h, mask: null })

/** The selection's mask, creating a solid one for rectangles. */
export function maskCanvas(s: Selection): HTMLCanvasElement {
  if (s.mask) return s.mask
  const c = makeCanvas(s.w, s.h)
  const x = ctx2d(c)
  x.fillStyle = '#fff'
  x.fillRect(0, 0, s.w, s.h)
  return c
}

/** Snap a soft mask to fully in / fully out (hard pixel edges). */
function threshold(c: HTMLCanvasElement): void {
  const x = ctx2d(c)
  const img = x.getImageData(0, 0, c.width, c.height)
  const d = img.data
  for (let i = 0; i < d.length; i += 4) {
    const on = d[i + 3] >= 128
    d[i] = d[i + 1] = d[i + 2] = 255
    d[i + 3] = on ? 255 : 0
  }
  x.putImageData(img, 0, 0)
}

/** Shrink a mask selection to its non-empty pixels; null if nothing is selected. */
export function tighten(s: Selection): Selection | null {
  if (!s.mask) return s.w > 0 && s.h > 0 ? s : null
  const w = s.mask.width
  const h = s.mask.height
  const d = ctx2d(s.mask).getImageData(0, 0, w, h).data
  let x0 = w
  let y0 = h
  let x1 = -1
  let y1 = -1
  for (let y = 0; y < h; y++) {
    const row = y * w
    for (let x = 0; x < w; x++) {
      if (d[(row + x) * 4 + 3]) {
        if (x < x0) x0 = x
        if (x > x1) x1 = x
        if (y < y0) y0 = y
        if (y > y1) y1 = y
      }
    }
  }
  if (x1 < 0) return null
  if (x0 === 0 && y0 === 0 && x1 === w - 1 && y1 === h - 1) return s
  const c = makeCanvas(x1 - x0 + 1, y1 - y0 + 1)
  ctx2d(c).drawImage(s.mask, -x0, -y0)
  return { x: s.x + x0, y: s.y + y0, w: c.width, h: c.height, mask: c }
}

export function polygonSel(pts: Vec[], antiAlias: boolean): Selection | null {
  if (pts.length < 3) return null
  let x0 = Infinity
  let y0 = Infinity
  let x1 = -Infinity
  let y1 = -Infinity
  for (const p of pts) {
    x0 = Math.min(x0, p.x)
    y0 = Math.min(y0, p.y)
    x1 = Math.max(x1, p.x)
    y1 = Math.max(y1, p.y)
  }
  const r = pixelRect({ x: x0, y: y0, w: x1 - x0, h: y1 - y0 })
  if (r.w < 1 || r.h < 1) return null
  const c = makeCanvas(r.w, r.h)
  const x = ctx2d(c)
  x.fillStyle = '#fff'
  x.beginPath()
  pts.forEach((p, i) => (i ? x.lineTo(p.x - r.x, p.y - r.y) : x.moveTo(p.x - r.x, p.y - r.y)))
  x.closePath()
  x.fill()
  if (!antiAlias) threshold(c)
  return tighten({ ...r, mask: c })
}

/** Selection from a flood-fill mask computed on an image whose origin is at doc (ox, oy). */
export function floodSel(fm: FillMask, sampleWidth: number, ox: number, oy: number): Selection {
  const { mask, bbox } = fm
  const c = makeCanvas(bbox.w, bbox.h)
  const x = ctx2d(c)
  const img = x.createImageData(bbox.w, bbox.h)
  const d = img.data
  for (let y = 0; y < bbox.h; y++) {
    const src = (bbox.y + y) * sampleWidth + bbox.x
    for (let i = 0; i < bbox.w; i++) {
      if (!mask[src + i]) continue
      const o = (y * bbox.w + i) * 4
      d[o] = d[o + 1] = d[o + 2] = d[o + 3] = 255
    }
  }
  x.putImageData(img, 0, 0)
  return { x: bbox.x + ox, y: bbox.y + oy, w: bbox.w, h: bbox.h, mask: c }
}

/** Limit a selection to the document. */
export function clipSel(s: Selection, W: number, H: number): Selection | null {
  const r = intersect(s, { x: 0, y: 0, w: W, h: H })
  if (!r) return null
  if (r.x === s.x && r.y === s.y && r.w === s.w && r.h === s.h) return s
  if (!s.mask) return rectSel(r)
  const c = makeCanvas(r.w, r.h)
  ctx2d(c).drawImage(s.mask, s.x - r.x, s.y - r.y)
  return tighten({ ...r, mask: c })
}

/** Combine an existing selection `a` with a new one `b`. */
export function combine(a: Selection | null, b: Selection | null, mode: SelectMode): Selection | null {
  if (mode === 'replace') return b
  if (!a) return mode === 'subtract' ? null : b
  if (!b) return mode === 'intersect' ? null : a
  const bounds = mode === 'add' ? union(a, b) : mode === 'subtract' ? { x: a.x, y: a.y, w: a.w, h: a.h } : intersect(a, b)
  if (!bounds) return null
  const c = makeCanvas(bounds.w, bounds.h)
  const x = ctx2d(c)
  x.drawImage(maskCanvas(a), a.x - bounds.x, a.y - bounds.y)
  x.globalCompositeOperation = mode === 'add' ? 'source-over' : mode === 'subtract' ? 'destination-out' : 'destination-in'
  x.drawImage(maskCanvas(b), b.x - bounds.x, b.y - bounds.y)
  return tighten({ ...bounds, mask: c })
}

export function invertSel(s: Selection | null, W: number, H: number): Selection | null {
  if (!s) return rectSel({ x: 0, y: 0, w: W, h: H })
  const c = makeCanvas(W, H)
  const x = ctx2d(c)
  x.fillStyle = '#fff'
  x.fillRect(0, 0, W, H)
  x.globalCompositeOperation = 'destination-out'
  x.drawImage(maskCanvas(s), s.x, s.y)
  return tighten({ x: 0, y: 0, w: W, h: H, mask: c })
}

/** Keep only the selected pixels of `c`, whose top-left sits at doc (ox, oy). */
export function keepInside(c: HTMLCanvasElement, s: Selection, ox: number, oy: number): void {
  const x = ctx2d(c)
  const bx = s.x - ox
  const by = s.y - oy
  x.save()
  x.beginPath()
  x.rect(0, 0, c.width, c.height)
  x.rect(bx, by, s.w, s.h)
  x.clip('evenodd')
  x.clearRect(0, 0, c.width, c.height)
  x.restore()
  if (s.mask) {
    x.save()
    x.globalCompositeOperation = 'destination-in'
    x.drawImage(s.mask, bx, by)
    x.restore()
  }
}

/** Erase the selected pixels from `c`, whose top-left sits at doc (ox, oy). */
export function clearInside(c: HTMLCanvasElement, s: Selection, ox: number, oy: number): void {
  const x = ctx2d(c)
  if (!s.mask) {
    x.clearRect(s.x - ox, s.y - oy, s.w, s.h)
    return
  }
  x.save()
  x.globalCompositeOperation = 'destination-out'
  x.drawImage(s.mask, s.x - ox, s.y - oy)
  x.restore()
}

const alphaCache = new WeakMap<HTMLCanvasElement, Uint8ClampedArray>()

/** Fast "is document pixel (x, y) selected?" check. */
export function selectionTester(s: Selection): (x: number, y: number) => boolean {
  if (!s.mask) return (x, y) => x >= s.x && y >= s.y && x < s.x + s.w && y < s.y + s.h
  let d = alphaCache.get(s.mask)
  if (!d) {
    d = ctx2d(s.mask).getImageData(0, 0, s.w, s.h).data
    alphaCache.set(s.mask, d)
  }
  return (x, y) => {
    const mx = x - s.x
    const my = y - s.y
    return mx >= 0 && my >= 0 && mx < s.w && my < s.h && d[(my * s.w + mx) * 4 + 3] >= 128
  }
}

/** Carry a selection through a document-space transform. */
export function transformSel(s: Selection, m: DOMMatrix, smooth: boolean): Selection | null {
  const pts = [
    m.transformPoint(new DOMPoint(s.x, s.y)),
    m.transformPoint(new DOMPoint(s.x + s.w, s.y)),
    m.transformPoint(new DOMPoint(s.x, s.y + s.h)),
    m.transformPoint(new DOMPoint(s.x + s.w, s.y + s.h))
  ]
  const xs = pts.map((p) => p.x)
  const ys = pts.map((p) => p.y)
  const r = pixelRect({ x: Math.min(...xs), y: Math.min(...ys), w: Math.max(...xs) - Math.min(...xs), h: Math.max(...ys) - Math.min(...ys) })
  if (r.w < 1 || r.h < 1) return null
  const c = makeCanvas(r.w, r.h)
  const x = ctx2d(c)
  x.imageSmoothingEnabled = smooth
  x.setTransform(new DOMMatrix().translate(-r.x, -r.y).multiply(m))
  x.drawImage(maskCanvas(s), s.x, s.y)
  if (!smooth) threshold(c)
  return tighten({ ...r, mask: c })
}

// ---- marching ants -------------------------------------------------------------------

const outlines = new WeakMap<HTMLCanvasElement, Path2D>()

/**
 * Outline of a mask selection along pixel edges, relative to the selection's
 * top-left. Null for rectangles (just stroke the bounds). Masks are immutable,
 * so the path is cached per mask canvas.
 */
export function outline(s: Selection): Path2D | null {
  if (!s.mask) return null
  const cached = outlines.get(s.mask)
  if (cached) return cached
  const w = s.mask.width
  const h = s.mask.height
  const a = ctx2d(s.mask).getImageData(0, 0, w, h).data
  // padded bitmap so edges at the border compare against "off"
  const W2 = w + 2
  const bits = new Uint8Array(W2 * (h + 2))
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) bits[(y + 1) * W2 + x + 1] = a[(y * w + x) * 4 + 3] >= 128 ? 1 : 0
  }
  const p = new Path2D()
  for (let y = 0; y <= h; y++) {
    const above = y * W2 + 1
    const below = (y + 1) * W2 + 1
    let run = -1
    for (let x = 0; x <= w; x++) {
      const edge = x < w && bits[above + x] !== bits[below + x]
      if (edge) {
        if (run < 0) run = x
      } else if (run >= 0) {
        p.moveTo(run, y)
        p.lineTo(x, y)
        run = -1
      }
    }
  }
  for (let x = 0; x <= w; x++) {
    let run = -1
    for (let y = 0; y <= h; y++) {
      const row = (y + 1) * W2
      const edge = y < h && bits[row + x] !== bits[row + x + 1]
      if (edge) {
        if (run < 0) run = y
      } else if (run >= 0) {
        p.moveTo(x, run)
        p.lineTo(x, y)
        run = -1
      }
    }
  }
  outlines.set(s.mask, p)
  return p
}
