// Layer effects (drop shadow, outer glow, stroke), drawn beneath a layer's own
// pixels and computed from its shape (alpha). They're non-destructive: stored as
// settings on the layer and rendered when compositing.
import type { Rect } from './types'
import { ctx2d, hexToRgb, makeCanvas } from './util'

export interface ShadowFx {
  on: boolean
  color: string
  /** 0..1 */
  opacity: number
  x: number
  y: number
  blur: number
}

export interface GlowFx {
  on: boolean
  color: string
  opacity: number
  size: number
}

export interface StrokeFx {
  on: boolean
  color: string
  opacity: number
  size: number
}

/** Treat as immutable: replace the whole object to change it (undo snapshots share it). */
export interface LayerEffects {
  shadow: ShadowFx
  glow: GlowFx
  stroke: StrokeFx
}

export const DEFAULT_EFFECTS: LayerEffects = {
  shadow: { on: false, color: '#000000', opacity: 0.5, x: 4, y: 6, blur: 10 },
  glow: { on: false, color: '#ffffff', opacity: 0.9, size: 12 },
  stroke: { on: false, color: '#ffffff', opacity: 1, size: 3 }
}

export const hasEffects = (fx: LayerEffects | undefined): fx is LayerEffects => !!fx && (fx.shadow.on || fx.glow.on || fx.stroke.on)

/** How far past the layer's pixels the effects can reach. */
export function effectReach(fx: LayerEffects): number {
  let r = 0
  if (fx.shadow.on) r = Math.max(r, Math.max(Math.abs(fx.shadow.x), Math.abs(fx.shadow.y)) + fx.shadow.blur * 1.5)
  if (fx.glow.on) r = Math.max(r, fx.glow.size * 1.5)
  if (fx.stroke.on) r = Math.max(r, fx.stroke.size + 1)
  return Math.ceil(r) + 2
}

const rgba = (hex: string, a: number): string => {
  const [r, g, b] = hexToRgb(hex)
  return `rgba(${r}, ${g}, ${b}, ${a})`
}

/**
 * Draw the effects for `content` (a document-sized canvas holding the layer's
 * pixels) within `region`. Returns a region-sized canvas to draw at region.x/y.
 */
export function renderEffects(content: HTMLCanvasElement, region: Rect, fx: LayerEffects): HTMLCanvasElement {
  const out = makeCanvas(Math.max(1, region.w), Math.max(1, region.h))
  const o = ctx2d(out)
  if (fx.shadow.on) castShadow(o, content, region, rgba(fx.shadow.color, fx.shadow.opacity), fx.shadow.blur, fx.shadow.x, fx.shadow.y)
  if (fx.glow.on) {
    // twice: a single canvas shadow fades out too quickly to read as a glow
    const c = rgba(fx.glow.color, fx.glow.opacity)
    castShadow(o, content, region, c, fx.glow.size, 0, 0)
    castShadow(o, content, region, c, fx.glow.size / 2, 0, 0)
  }
  if (fx.stroke.on && fx.stroke.size > 0) o.drawImage(strokeAround(content, region, fx.stroke), 0, 0)
  return out
}

/**
 * Just the shadow of `content`: the pixels are drawn far off the canvas and the
 * shadow offset brings only their shadow back (shadow offsets ignore transforms).
 */
function castShadow(o: CanvasRenderingContext2D, content: HTMLCanvasElement, region: Rect, color: string, blur: number, dx: number, dy: number): void {
  const OFF = 100000
  o.save()
  o.shadowColor = color
  o.shadowBlur = blur
  o.shadowOffsetX = OFF + dx
  o.shadowOffsetY = dy
  o.drawImage(content, region.x, region.y, region.w, region.h, -OFF, 0, region.w, region.h)
  o.restore()
}

const FAR = 1e20

/**
 * An outline `size` px wide around the layer's shape, with round corners: every
 * pixel within that distance of a solid pixel, from an exact distance transform.
 * It also fills beneath the shape (the layer's own pixels cover that part).
 */
function strokeAround(content: HTMLCanvasElement, region: Rect, s: StrokeFx): HTMLCanvasElement {
  const { w, h } = region
  const src = ctx2d(content).getImageData(region.x, region.y, w, h).data
  const dist = new Float64Array(w * h)
  for (let i = 0; i < dist.length; i++) dist[i] = src[i * 4 + 3] >= 128 ? 0 : FAR
  distanceTransform(dist, w, h)
  const img = new ImageData(w, h)
  const px = img.data
  const [r, g, b] = hexToRgb(s.color)
  const a255 = s.opacity * 255
  for (let i = 0; i < dist.length; i++) {
    // anti-aliased edge: full inside the width, fading over the last pixel
    const cover = s.size + 0.5 - Math.sqrt(dist[i])
    if (cover <= 0) continue
    const j = i * 4
    px[j] = r
    px[j + 1] = g
    px[j + 2] = b
    px[j + 3] = (cover >= 1 ? 1 : cover) * a255
  }
  const out = makeCanvas(w, h)
  ctx2d(out).putImageData(img, 0, 0)
  return out
}

/** Squared Euclidean distance to the nearest zero, in place (Felzenszwalb & Huttenlocher). */
function distanceTransform(grid: Float64Array, w: number, h: number): void {
  const n = Math.max(w, h)
  const f = new Float64Array(n)
  const d = new Float64Array(n)
  const v = new Int32Array(n)
  const z = new Float64Array(n + 1)
  for (let x = 0; x < w; x++) {
    for (let y = 0; y < h; y++) f[y] = grid[y * w + x]
    edt1d(f, h, d, v, z)
    for (let y = 0; y < h; y++) grid[y * w + x] = d[y]
  }
  for (let y = 0; y < h; y++) {
    const row = y * w
    for (let x = 0; x < w; x++) f[x] = grid[row + x]
    edt1d(f, w, d, v, z)
    for (let x = 0; x < w; x++) grid[row + x] = d[x]
  }
}

/** One dimension: the lower envelope of parabolas rooted at each sample. */
function edt1d(f: Float64Array, n: number, d: Float64Array, v: Int32Array, z: Float64Array): void {
  let k = 0
  v[0] = 0
  z[0] = -FAR
  z[1] = FAR
  for (let q = 1; q < n; q++) {
    let s = (f[q] + q * q - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k])
    while (s <= z[k]) {
      k--
      s = (f[q] + q * q - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k])
    }
    k++
    v[k] = q
    z[k] = s
    z[k + 1] = FAR
  }
  k = 0
  for (let q = 0; q < n; q++) {
    while (z[k + 1] < q) k++
    const dq = q - v[k]
    d[q] = dq * dq + f[v[k]]
  }
}
