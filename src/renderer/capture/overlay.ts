// Full-screen capture overlay (one per display). Shows the frozen screen,
// lets the user drag a region or click a window, and reports the rectangle
// (in screenshot pixels) back to the main process.
import type { CaptureApi, CaptureShowPayload, CaptureWindowRect } from '../../shared/api'

declare global {
  interface Window {
    captureApi: CaptureApi
  }
}

interface Pt {
  x: number
  y: number
}

interface R {
  x: number
  y: number
  w: number
  h: number
}

/** Which edges a mouse drag on the adjustable region moves ('move' drags all of it). */
type Grip = 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w' | 'move'

const ACCENT = '#ff5e4d'
const GRIP_CURSORS: Record<Grip, string> = {
  nw: 'nwse-resize',
  se: 'nwse-resize',
  ne: 'nesw-resize',
  sw: 'nesw-resize',
  n: 'ns-resize',
  s: 'ns-resize',
  e: 'ew-resize',
  w: 'ew-resize',
  move: 'move'
}
const canvas = document.getElementById('c') as HTMLCanvasElement
const toolbar = document.getElementById('tb') as HTMLDivElement
const sizeText = document.getElementById('tb-size') as HTMLSpanElement
const fields = Array.from(toolbar.querySelectorAll('input')) as HTMLInputElement[]
const ctx = canvas.getContext('2d')!
const shot = document.createElement('canvas')
const shotCtx = shot.getContext('2d')!

let pixels: Uint8ClampedArray | null = null
let windows: CaptureWindowRect[] = []
let mouse: Pt | null = null
let dragStart: Pt | null = null
let active = false
let frame = 0
/** Adjust a dragged region before capturing (a setting). */
let adjust = false
/** The dragged region while it's being adjusted. */
let region: R | null = null
/** A mouse drag that's adjusting `region`. */
let grip: { kind: Grip; from: Pt; orig: R } | null = null
/** After a keyboard nudge, the loupe shows the corner that moved instead of the cursor. */
let focus: Pt | null = null
/** This press dropped the region being adjusted: a plain click then captures nothing. */
let dropped = false

/** Screenshot pixels per CSS pixel. */
const scale = (): number => (shot.width || 1) / window.innerWidth

function show(p: CaptureShowPayload): void {
  // BGRA -> RGBA
  const data = new Uint8ClampedArray(p.bitmap)
  const u32 = new Uint32Array(data.buffer, data.byteOffset, data.byteLength >> 2)
  for (let i = 0; i < u32.length; i++) {
    const v = u32[i]
    u32[i] = (v & 0xff00ff00) | ((v & 0xff) << 16) | ((v >> 16) & 0xff)
  }
  shot.width = canvas.width = p.width
  shot.height = canvas.height = p.height
  shotCtx.putImageData(new ImageData(data, p.width, p.height), 0, 0)
  pixels = data
  windows = p.windows
  mouse = p.cursor
  adjust = p.adjust
  reset()
  active = true
  draw()
  // Wait until the new frame is presented before the window is shown, but don't
  // rely on animation frames alone: a hidden page (e.g. one that just reloaded)
  // may not get any, and then the capture would never appear.
  let sent = false
  const ready = (): void => {
    if (sent) return
    sent = true
    window.captureApi.ready()
  }
  requestAnimationFrame(() => requestAnimationFrame(ready))
  setTimeout(ready, 120)
}

function reset(): void {
  dragStart = null
  region = null
  grip = null
  focus = null
  dropped = false
  canvas.style.cursor = ''
  toolbar.hidden = true
}

function hide(): void {
  active = false
  pixels = null
  mouse = null
  reset()
  ctx.fillStyle = '#000'
  ctx.fillRect(0, 0, canvas.width, canvas.height)
}

function dragRect(): R | null {
  if (!dragStart || !mouse) return null
  const x0 = Math.round(Math.min(dragStart.x, mouse.x))
  const y0 = Math.round(Math.min(dragStart.y, mouse.y))
  const x1 = Math.round(Math.max(dragStart.x, mouse.x))
  const y1 = Math.round(Math.max(dragStart.y, mouse.y))
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 }
}

function hoverWindow(): R | null {
  if (!mouse) return null
  for (const w of windows) {
    if (mouse.x >= w.x && mouse.x < w.x + w.w && mouse.y >= w.y && mouse.y < w.y + w.h) return w
  }
  return null
}

function isDragging(): boolean {
  const r = dragRect()
  return !!r && (r.w > 3 || r.h > 3)
}

function currentRect(): R | null {
  if (region) return region
  if (isDragging()) return dragRect()
  return dropped ? null : hoverWindow()
}

const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v))

/** The part of the adjustable region under `p`, if any. */
function gripAt(p: Pt): Grip | null {
  const r = region
  if (!r) return null
  const t = 10 * scale()
  const nearL = Math.abs(p.x - r.x) <= t
  const nearR = Math.abs(p.x - (r.x + r.w)) <= t
  const nearT = Math.abs(p.y - r.y) <= t
  const nearB = Math.abs(p.y - (r.y + r.h)) <= t
  const inX = p.x >= r.x - t && p.x <= r.x + r.w + t
  const inY = p.y >= r.y - t && p.y <= r.y + r.h + t
  if (!inX || !inY) return null
  const v = nearT ? 'n' : nearB ? 's' : ''
  const h = nearL ? 'w' : nearR ? 'e' : ''
  if (v || h) return (v + h) as Grip
  return 'move'
}

function applyGrip(g: NonNullable<typeof grip>, p: Pt): R {
  const dx = Math.round(p.x - g.from.x)
  const dy = Math.round(p.y - g.from.y)
  const o = g.orig
  if (g.kind === 'move') {
    return { x: clamp(o.x + dx, 0, shot.width - o.w), y: clamp(o.y + dy, 0, shot.height - o.h), w: o.w, h: o.h }
  }
  let l = o.x
  let t = o.y
  let r = o.x + o.w
  let b = o.y + o.h
  if (g.kind.includes('w')) l += dx
  if (g.kind.includes('e')) r += dx
  if (g.kind.includes('n')) t += dy
  if (g.kind.includes('s')) b += dy
  const x0 = clamp(Math.min(l, r), 0, shot.width - 1)
  const y0 = clamp(Math.min(t, b), 0, shot.height - 1)
  const x1 = clamp(Math.max(l, r), x0 + 1, shot.width)
  const y1 = clamp(Math.max(t, b), y0 + 1, shot.height)
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 }
}

type Field = 'x1' | 'y1' | 'x2' | 'y2'

/** The region's corner pixels: top-left (x1, y1) and bottom-right (x2, y2), both inside it. */
function corners(r: R): Record<Field, number> {
  return { x1: r.x, y1: r.y, x2: r.x + r.w - 1, y2: r.y + r.h - 1 }
}

/** Move one corner coordinate (keyboard, toolbar, typing). The loupe follows that corner. */
function setCorner(f: Field, v: number): void {
  const r = region
  if (!r || !Number.isFinite(v)) return
  const c = corners(r)
  v = Math.round(v)
  if (f === 'x1') c.x1 = clamp(v, 0, c.x2)
  if (f === 'y1') c.y1 = clamp(v, 0, c.y2)
  if (f === 'x2') c.x2 = clamp(v, c.x1, shot.width - 1)
  if (f === 'y2') c.y2 = clamp(v, c.y1, shot.height - 1)
  region = { x: c.x1, y: c.y1, w: c.x2 - c.x1 + 1, h: c.y2 - c.y1 + 1 }
  focus = f === 'x1' || f === 'y1' ? { x: c.x1, y: c.y1 } : { x: c.x2, y: c.y2 }
  requestDraw()
}

/** Arrow keys: move the bottom-right corner, or with Shift the top-left one. */
function nudge(key: string, shift: boolean, big: boolean): void {
  if (!region) return
  const step = big ? 10 : 1
  const c = corners(region)
  const horizontal = key === 'ArrowLeft' || key === 'ArrowRight'
  const d = key === 'ArrowLeft' || key === 'ArrowUp' ? -step : step
  const f: Field = shift ? (horizontal ? 'x1' : 'y1') : horizontal ? 'x2' : 'y2'
  setCorner(f, c[f] + d)
}

/** Keep the toolbar's numbers current and place it next to the region. */
function updateToolbar(): void {
  const r = region
  toolbar.hidden = !r
  if (!r) return
  const c = corners(r)
  for (const input of fields) {
    // don't fight the user while they're typing
    if (document.activeElement !== input) input.value = String(c[input.dataset['f'] as Field])
  }
  sizeText.textContent = `${r.w} × ${r.h}`
  const s = scale()
  const tw = toolbar.offsetWidth
  const th = toolbar.offsetHeight
  const gap = 12
  let top = (r.y + r.h) / s + gap
  if (top + th > window.innerHeight - 8) top = r.y / s - th - gap
  if (top < 8) top = Math.min(window.innerHeight - th - 8, (r.y + r.h) / s - th - gap)
  toolbar.style.left = `${clamp(r.x / s, 8, Math.max(8, window.innerWidth - tw - 8))}px`
  toolbar.style.top = `${Math.max(8, top)}px`
}

function requestDraw(): void {
  if (!frame) frame = requestAnimationFrame(() => ((frame = 0), draw()))
}

function draw(): void {
  if (!active) return
  const W = canvas.width
  const H = canvas.height
  const s = scale()
  ctx.imageSmoothingEnabled = false
  ctx.drawImage(shot, 0, 0)
  ctx.fillStyle = 'rgba(8, 10, 16, 0.5)'
  ctx.fillRect(0, 0, W, H)

  const r = currentRect()
  if (r && r.w > 0 && r.h > 0) {
    ctx.drawImage(shot, r.x, r.y, r.w, r.h, r.x, r.y, r.w, r.h)
    ctx.lineWidth = Math.max(1, Math.round(2 * s))
    ctx.strokeStyle = ACCENT
    const o = ctx.lineWidth / 2
    ctx.strokeRect(r.x - o, r.y - o, r.w + ctx.lineWidth, r.h + ctx.lineWidth)
    if (region) drawGrips(region, s)
    drawLabel(r, s)
  }

  if (mouse && !isDragging() && !region) {
    // full-length guides through the cursor
    ctx.fillStyle = 'rgba(255,255,255,0.35)'
    const lw = Math.max(1, Math.round(s))
    ctx.fillRect(0, Math.floor(mouse.y), W, lw)
    ctx.fillRect(Math.floor(mouse.x), 0, lw, H)
  }
  const target = focus ?? mouse
  if (target) drawLoupe(target, s)
  if (region) drawHint('Drag the edges, use the controls, or arrows (Shift: top-left) · Enter or double-click to capture · Esc to cancel', s)
  else if (!mouse) drawHint('Drag to capture a region · Click a window · Enter for full screen · Esc to cancel', s)
  updateToolbar()
}

function drawGrips(r: R, s: number): void {
  const size = Math.round(10 * s)
  const pts = [
    [r.x, r.y],
    [r.x + r.w / 2, r.y],
    [r.x + r.w, r.y],
    [r.x + r.w, r.y + r.h / 2],
    [r.x + r.w, r.y + r.h],
    [r.x + r.w / 2, r.y + r.h],
    [r.x, r.y + r.h],
    [r.x, r.y + r.h / 2]
  ]
  ctx.fillStyle = '#fff'
  ctx.strokeStyle = ACCENT
  ctx.lineWidth = Math.max(1, Math.round(1.5 * s))
  for (const [x, y] of pts) {
    ctx.fillRect(Math.round(x - size / 2), Math.round(y - size / 2), size, size)
    ctx.strokeRect(Math.round(x - size / 2), Math.round(y - size / 2), size, size)
  }
}

function roundRect(x: number, y: number, w: number, h: number, r: number): void {
  ctx.beginPath()
  ctx.roundRect(x, y, w, h, r)
}

function drawLabel(r: R, s: number): void {
  const text = `${r.w} × ${r.h}`
  ctx.font = `600 ${Math.round(12 * s)}px "Segoe UI", system-ui, sans-serif`
  const tw = ctx.measureText(text).width
  const ph = Math.round(22 * s)
  const pw = tw + 16 * s
  let lx = r.x
  let ly = r.y - ph - 6 * s
  if (ly < 4 * s) ly = r.y + 6 * s
  if (lx + pw > canvas.width - 4 * s) lx = canvas.width - pw - 4 * s
  ctx.fillStyle = 'rgba(20, 22, 28, 0.9)'
  roundRect(lx, ly, pw, ph, 5 * s)
  ctx.fill()
  ctx.fillStyle = '#fff'
  ctx.textBaseline = 'middle'
  ctx.fillText(text, lx + 8 * s, ly + ph / 2)
}

function drawLoupe(at: Pt, s: number): void {
  if (!pixels) return
  const cells = 15
  const cell = Math.round(8 * s)
  const size = cells * cell
  const mx = Math.floor(at.x)
  const my = Math.floor(at.y)
  let lx = at.x + 24 * s
  let ly = at.y + 24 * s
  const infoH = Math.round(38 * s)
  if (lx + size > canvas.width) lx = at.x - 24 * s - size
  if (ly + size + infoH > canvas.height) ly = at.y - 24 * s - size - infoH

  ctx.save()
  ctx.fillStyle = 'rgba(20, 22, 28, 0.95)'
  roundRect(lx - 3 * s, ly - 3 * s, size + 6 * s, size + infoH + 6 * s, 8 * s)
  ctx.fill()
  roundRect(lx, ly, size, size, 5 * s)
  ctx.clip()
  ctx.fillStyle = '#000'
  ctx.fillRect(lx, ly, size, size)
  ctx.imageSmoothingEnabled = false
  const half = Math.floor(cells / 2)
  ctx.drawImage(shot, mx - half, my - half, cells, cells, lx, ly, size, size)
  ctx.strokeStyle = 'rgba(255,255,255,0.08)'
  ctx.lineWidth = 1
  ctx.beginPath()
  for (let i = 1; i < cells; i++) {
    ctx.moveTo(lx + i * cell + 0.5, ly)
    ctx.lineTo(lx + i * cell + 0.5, ly + size)
    ctx.moveTo(lx, ly + i * cell + 0.5)
    ctx.lineTo(lx + size, ly + i * cell + 0.5)
  }
  ctx.stroke()
  ctx.strokeStyle = ACCENT
  ctx.lineWidth = Math.max(1, Math.round(1.5 * s))
  ctx.strokeRect(lx + half * cell, ly + half * cell, cell, cell)
  ctx.restore()

  // coordinates + colour
  let hex = ''
  if (mx >= 0 && my >= 0 && mx < shot.width && my < shot.height) {
    const i = (my * shot.width + mx) * 4
    hex = '#' + [pixels[i], pixels[i + 1], pixels[i + 2]].map((v) => v.toString(16).padStart(2, '0')).join('')
    ctx.fillStyle = hex
    roundRect(lx + 2 * s, ly + size + 9 * s, 20 * s, 20 * s, 4 * s)
    ctx.fill()
    ctx.strokeStyle = 'rgba(255,255,255,0.3)'
    ctx.lineWidth = 1
    ctx.stroke()
  }
  ctx.fillStyle = '#e8e9ec'
  ctx.textBaseline = 'middle'
  ctx.font = `500 ${Math.round(11 * s)}px "Segoe UI", system-ui, sans-serif`
  ctx.fillText(`${mx}, ${my}`, lx + 30 * s, ly + size + 13 * s)
  ctx.fillStyle = '#9aa0aa'
  ctx.fillText(hex.toUpperCase(), lx + 30 * s, ly + size + 27 * s)
}

function drawHint(text: string, s: number): void {
  ctx.font = `500 ${Math.round(14 * s)}px "Segoe UI", system-ui, sans-serif`
  const tw = ctx.measureText(text).width
  const pw = tw + 32 * s
  const ph = 40 * s
  const x = (canvas.width - pw) / 2
  // move out of the way of a region near the top
  let y = 32 * s
  if (region && region.y < y + ph + 12 * s && region.x < x + pw && region.x + region.w > x) y = canvas.height - ph - 32 * s
  ctx.fillStyle = 'rgba(20, 22, 28, 0.9)'
  roundRect(x, y, pw, ph, ph / 2)
  ctx.fill()
  ctx.fillStyle = '#fff'
  ctx.textBaseline = 'middle'
  ctx.fillText(text, x + 16 * s, y + ph / 2)
}

function toShot(e: MouseEvent): Pt {
  const s = scale()
  return { x: e.clientX * s, y: e.clientY * s }
}

function finish(rect: R | null): void {
  if (!active) return
  active = false
  window.captureApi.finish(rect)
}

/** Esc / right-click always cancel, even if this page never got its screenshot. */
function cancel(): void {
  active = false
  window.captureApi.finish(null)
}

window.addEventListener('mousemove', (e) => {
  mouse = toShot(e)
  focus = null
  if (grip) region = applyGrip(grip, mouse)
  else if (region) {
    const g = gripAt(mouse)
    canvas.style.cursor = g ? GRIP_CURSORS[g] : ''
  }
  requestDraw()
})
window.addEventListener('mouseleave', () => {
  if (dragStart || grip) return
  mouse = null
  requestDraw()
})
window.addEventListener('mousedown', (e) => {
  if (e.button === 2) return cancel()
  if (!active || e.button !== 0) return
  // Windows doesn't always give the overlay keyboard focus: ask for it on every press
  window.captureApi.claim()
  mouse = toShot(e)
  focus = null
  dropped = false
  if (region) {
    const g = gripAt(mouse)
    if (g) {
      grip = { kind: g, from: mouse, orig: { ...region } }
      return
    }
    // pressing outside starts over
    region = null
    dropped = true
    canvas.style.cursor = ''
  }
  dragStart = { ...mouse }
  requestDraw()
})
window.addEventListener('mouseup', (e) => {
  if (!active || e.button !== 0) return
  if (grip) {
    grip = null
    return
  }
  if (!dragStart) return
  mouse = toShot(e)
  const r = dragRect()
  const dragged = isDragging()
  dragStart = null
  if (dragged && r && adjust) {
    region = r
    requestDraw()
  } else if (dragged && r) finish(r)
  else if (!dropped) finish(hoverWindow() ?? { x: 0, y: 0, w: shot.width, h: shot.height })
  dropped = false
  requestDraw()
})
window.addEventListener('dblclick', (e) => {
  if (!active || !region || e.button !== 0) return
  const p = toShot(e)
  if (gripAt(p)) finish(region)
})
window.addEventListener('contextmenu', (e) => e.preventDefault())
window.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') return cancel()
  if (!active) return
  if (e.key === 'Enter') return finish(region ?? { x: 0, y: 0, w: shot.width, h: shot.height })
  if (e.target instanceof HTMLInputElement) return
  if (region && e.key.startsWith('Arrow')) {
    e.preventDefault()
    nudge(e.key, e.shiftKey, e.ctrlKey)
  }
})
window.addEventListener('resize', requestDraw)

// ---- toolbar ---------------------------------------------------------------------

// Clicks on the toolbar mustn't start a new region underneath it.
for (const type of ['mousedown', 'mouseup', 'dblclick'] as const) {
  toolbar.addEventListener(type, (e) => {
    e.stopPropagation()
    if (type === 'mousedown') window.captureApi.claim()
  })
}
toolbar.addEventListener('mousemove', (e) => e.stopPropagation())

const fieldValue = (f: Field): number => (region ? corners(region)[f] : 0)

for (const input of fields) {
  const f = input.dataset['f'] as Field
  input.addEventListener('input', () => {
    if (input.value.trim() !== '') setCorner(f, Number(input.value))
  })
  input.addEventListener('blur', () => requestDraw())
  input.addEventListener('wheel', (e) => {
    e.preventDefault()
    setCorner(f, fieldValue(f) + (e.deltaY < 0 ? 1 : -1) * (e.shiftKey ? 10 : 1))
    input.value = String(fieldValue(f))
  })
}

// − / + steppers: Shift steps 10 px, and holding one down repeats.
for (const btn of Array.from(toolbar.querySelectorAll<HTMLButtonElement>('button[data-f]'))) {
  const f = btn.dataset['f'] as Field
  const d = Number(btn.dataset['d'])
  let delay = 0
  let repeat = 0
  const stop = (): void => {
    clearTimeout(delay)
    clearInterval(repeat)
  }
  btn.addEventListener('pointerdown', (e) => {
    e.preventDefault()
    const step = (): void => setCorner(f, fieldValue(f) + d * (e.shiftKey ? 10 : 1))
    step()
    delay = window.setTimeout(() => (repeat = window.setInterval(step, 50)), 350)
  })
  btn.addEventListener('pointerup', stop)
  btn.addEventListener('pointerleave', stop)
}

document.getElementById('tb-ok')!.addEventListener('click', () => region && finish(region))
document.getElementById('tb-cancel')!.addEventListener('click', () => cancel())

window.captureApi.onShow(show)
window.captureApi.onHide(hide)
window.captureApi.onClear(() => {
  if (!region && !dragStart) return
  reset()
  requestDraw()
})
