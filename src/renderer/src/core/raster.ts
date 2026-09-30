import type { Rect } from './types'
import { ctx2d, hexToRgb, makeCanvas } from './util'

export interface FillMask {
  mask: Uint8Array
  bbox: Rect
}

/**
 * Pixels to fill starting at (x, y) in `img`, limited to `limit`.
 * Fully transparent pixels always match each other regardless of their RGB.
 */
export function floodMask(img: ImageData, x0: number, y0: number, tol: number, contiguous: boolean, limit: Rect): FillMask | null {
  const { width: w, data } = img
  const L = Math.max(0, limit.x)
  const T = Math.max(0, limit.y)
  const R = Math.min(img.width, limit.x + limit.w)
  const B = Math.min(img.height, limit.y + limit.h)
  if (x0 < L || y0 < T || x0 >= R || y0 >= B) return null
  const si = (y0 * w + x0) * 4
  const sr = data[si]
  const sg = data[si + 1]
  const sb = data[si + 2]
  const sa = data[si + 3]
  const mask = new Uint8Array(img.width * img.height)
  const match = (i: number): boolean => {
    const a = data[i + 3]
    if (a === 0 && sa === 0) return true
    return (
      Math.abs(data[i] - sr) <= tol &&
      Math.abs(data[i + 1] - sg) <= tol &&
      Math.abs(data[i + 2] - sb) <= tol &&
      Math.abs(a - sa) <= tol
    )
  }
  let bx0 = x0
  let by0 = y0
  let bx1 = x0
  let by1 = y0

  if (!contiguous) {
    for (let y = T; y < B; y++) {
      for (let x = L; x < R; x++) {
        if (match((y * w + x) * 4)) {
          mask[y * w + x] = 1
          if (x < bx0) bx0 = x
          if (x > bx1) bx1 = x
          if (y < by0) by0 = y
          if (y > by1) by1 = y
        }
      }
    }
    return { mask, bbox: { x: bx0, y: by0, w: bx1 - bx0 + 1, h: by1 - by0 + 1 } }
  }

  const ok = (x: number, y: number): boolean => !mask[y * w + x] && match((y * w + x) * 4)
  const stack: number[] = [x0, y0]
  while (stack.length) {
    const y = stack.pop()!
    const x = stack.pop()!
    if (!ok(x, y)) continue
    let lx = x
    while (lx > L && ok(lx - 1, y)) lx--
    let rx = x
    while (rx < R - 1 && ok(rx + 1, y)) rx++
    for (let i = lx; i <= rx; i++) mask[y * w + i] = 1
    if (lx < bx0) bx0 = lx
    if (rx > bx1) bx1 = rx
    if (y < by0) by0 = y
    if (y > by1) by1 = y
    for (const ny of [y - 1, y + 1]) {
      if (ny < T || ny >= B) continue
      let inSpan = false
      for (let i = lx; i <= rx; i++) {
        if (ok(i, ny)) {
          if (!inSpan) {
            stack.push(i, ny)
            inSpan = true
          }
        } else inSpan = false
      }
    }
  }
  return { mask, bbox: { x: bx0, y: by0, w: bx1 - bx0 + 1, h: by1 - by0 + 1 } }
}

/** Integer line from (x0,y0) to (x1,y1), inclusive. */
export function bresenham(x0: number, y0: number, x1: number, y1: number, plot: (x: number, y: number) => void): void {
  const dx = Math.abs(x1 - x0)
  const dy = -Math.abs(y1 - y0)
  const sx = x0 < x1 ? 1 : -1
  const sy = y0 < y1 ? 1 : -1
  let err = dx + dy
  for (;;) {
    plot(x0, y0)
    if (x0 === x1 && y0 === y1) break
    const e2 = 2 * err
    if (e2 >= dy) {
      err += dy
      x0 += sx
    }
    if (e2 <= dx) {
      err += dx
      y0 += sy
    }
  }
}

const stampCache = new Map<string, HTMLCanvasElement>()

/** Aliased round (or square for tiny sizes) brush tip. */
export function pixelStamp(size: number, color: string): HTMLCanvasElement {
  const key = `${size}|${color}`
  let c = stampCache.get(key)
  if (c) return c
  if (stampCache.size > 64) stampCache.clear()
  c = makeCanvas(size, size)
  const x = ctx2d(c)
  const img = x.createImageData(size, size)
  const [r, g, b] = hexToRgb(color)
  const rad = size / 2
  for (let py = 0; py < size; py++) {
    for (let px = 0; px < size; px++) {
      const dx = px + 0.5 - rad
      const dy = py + 0.5 - rad
      if (size <= 2 || dx * dx + dy * dy <= rad * rad + 0.3) {
        const i = (py * size + px) * 4
        img.data[i] = r
        img.data[i + 1] = g
        img.data[i + 2] = b
        img.data[i + 3] = 255
      }
    }
  }
  x.putImageData(img, 0, 0)
  stampCache.set(key, c)
  return c
}

/** Top-left offset so a stamp of `size` is centred on a pixel. */
export const stampOffset = (size: number): number => Math.floor((size - 1) / 2)
