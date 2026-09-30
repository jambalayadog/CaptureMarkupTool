// Full-screen capture overlay (one per display). Shows the frozen screen,
// lets the user drag a region or click a window, and reports the rectangle
// (in screenshot pixels) back to the main process.
import type { CaptureApi, CaptureShowPayload, CaptureWindowRect } from '../../shared/api'

declare global {
  interface Window {
    captureApi: CaptureApi
  }
}

interface R {
  x: number
  y: number
  w: number
  h: number
}

const ACCENT = '#ff5e4d'
const canvas = document.getElementById('c') as HTMLCanvasElement
const ctx = canvas.getContext('2d')!
const shot = document.createElement('canvas')
const shotCtx = shot.getContext('2d')!

let pixels: Uint8ClampedArray | null = null
let windows: CaptureWindowRect[] = []
let mouse: { x: number; y: number } | null = null
let dragStart: { x: number; y: number } | null = null
let active = false
let frame = 0

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
  dragStart = null
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

function hide(): void {
  active = false
  pixels = null
  mouse = null
  dragStart = null
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
  return isDragging() ? dragRect() : hoverWindow()
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
    drawLabel(r, s)
  }

  if (mouse && !isDragging()) {
    // full-length guides through the cursor
    ctx.fillStyle = 'rgba(255,255,255,0.35)'
    const lw = Math.max(1, Math.round(s))
    ctx.fillRect(0, Math.floor(mouse.y), W, lw)
    ctx.fillRect(Math.floor(mouse.x), 0, lw, H)
  }
  if (mouse) drawLoupe(s)
  if (!mouse) drawHint(s)
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

function drawLoupe(s: number): void {
  if (!mouse || !pixels) return
  const cells = 15
  const cell = Math.round(8 * s)
  const size = cells * cell
  const mx = Math.floor(mouse.x)
  const my = Math.floor(mouse.y)
  let lx = mouse.x + 24 * s
  let ly = mouse.y + 24 * s
  const infoH = Math.round(38 * s)
  if (lx + size > canvas.width) lx = mouse.x - 24 * s - size
  if (ly + size + infoH > canvas.height) ly = mouse.y - 24 * s - size - infoH

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

function drawHint(s: number): void {
  const text = 'Drag to capture a region · Click a window · Enter for full screen · Esc to cancel'
  ctx.font = `500 ${Math.round(14 * s)}px "Segoe UI", system-ui, sans-serif`
  const tw = ctx.measureText(text).width
  const pw = tw + 32 * s
  const ph = 40 * s
  const x = (canvas.width - pw) / 2
  const y = 32 * s
  ctx.fillStyle = 'rgba(20, 22, 28, 0.9)'
  roundRect(x, y, pw, ph, ph / 2)
  ctx.fill()
  ctx.fillStyle = '#fff'
  ctx.textBaseline = 'middle'
  ctx.fillText(text, x + 16 * s, y + ph / 2)
}

function toShot(e: MouseEvent): { x: number; y: number } {
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
  requestDraw()
})
window.addEventListener('mouseleave', () => {
  if (dragStart) return
  mouse = null
  requestDraw()
})
window.addEventListener('mousedown', (e) => {
  if (e.button === 2) return cancel()
  if (!active || e.button !== 0) return
  mouse = toShot(e)
  dragStart = { ...mouse }
  requestDraw()
})
window.addEventListener('mouseup', (e) => {
  if (!active || e.button !== 0 || !dragStart) return
  mouse = toShot(e)
  if (isDragging()) finish(dragRect())
  else finish(hoverWindow() ?? { x: 0, y: 0, w: shot.width, h: shot.height })
  dragStart = null
})
window.addEventListener('contextmenu', (e) => e.preventDefault())
window.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') return cancel()
  if (active && e.key === 'Enter') finish({ x: 0, y: 0, w: shot.width, h: shot.height })
})
window.addEventListener('resize', requestDraw)

window.captureApi.onShow(show)
window.captureApi.onHide(hide)
