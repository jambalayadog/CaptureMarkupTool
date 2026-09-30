import { cropTo } from '../core/imageOps'
import { dragRectHandle, rectHandles, HANDLE_CURSORS, type HandleId } from '../core/objects'
import type { Rect, Vec } from '../core/types'
import { clamp, contains, normRect } from '../core/util'
import type { Editor } from '../core/editor'
import type { Tool } from './types'

const snapPx = (p: Vec): Vec => ({ x: Math.round(p.x), y: Math.round(p.y) })

function squareFrom(a: Vec, b: Vec): Vec {
  const s = Math.max(Math.abs(b.x - a.x), Math.abs(b.y - a.y))
  return { x: a.x + Math.sign(b.x - a.x || 1) * s, y: a.y + Math.sign(b.y - a.y || 1) * s }
}

// ---- rectangular marquee -------------------------------------------------------------------

let marquee: { kind: 'new'; start: Vec } | { kind: 'move'; start: Vec; orig: Rect } | null = null

export const marqueeTool: Tool = {
  id: 'marquee',
  cursor: (ed, p) => (p && ed.d?.selection && contains(ed.d.selection, p.doc) ? 'move' : 'crosshair'),
  down(ed, p) {
    const d = ed.d!
    if (d.selection && contains(d.selection, p.doc) && !p.shift) {
      marquee = { kind: 'move', start: p.doc, orig: { ...d.selection } }
      return
    }
    const s = snapPx(p.doc)
    marquee = { kind: 'new', start: { x: clamp(s.x, 0, d.width), y: clamp(s.y, 0, d.height) } }
  },
  move(ed, p, dragging) {
    const d = ed.d!
    if (!dragging || !marquee) return
    if (marquee.kind === 'move') {
      const o = marquee.orig
      const dx = Math.round(p.doc.x - marquee.start.x)
      const dy = Math.round(p.doc.y - marquee.start.y)
      d.selection = {
        x: clamp(o.x + dx, 0, d.width - o.w),
        y: clamp(o.y + dy, 0, d.height - o.h),
        w: o.w,
        h: o.h
      }
      return
    }
    let e = snapPx(p.doc)
    if (p.shift) e = squareFrom(marquee.start, e)
    e = { x: clamp(e.x, 0, d.width), y: clamp(e.y, 0, d.height) }
    const r = normRect(marquee.start, e)
    d.selection = r.w && r.h ? r : null
  },
  up(ed) {
    const d = ed.d!
    marquee = null
    ed.setSelection(d.selection)
  },
  cancel() {
    marquee = null
  },
  dblclick(ed) {
    ed.setSelection(null)
  }
}

// ---- crop ---------------------------------------------------------------------------------------

let crop: { kind: 'new'; start: Vec } | { kind: 'move'; start: Vec; orig: Rect } | { kind: 'handle'; id: HandleId; orig: Rect } | null = null

function cropRect(ed: Editor): Rect {
  const d = ed.d!
  if (!d.live.crop) d.live.crop = { x: 0, y: 0, w: d.width, h: d.height }
  return d.live.crop
}

function cropHandleAt(ed: Editor, screen: Vec): HandleId | null {
  for (const h of rectHandles(cropRect(ed))) {
    const s = ed.toScreen(h)
    if (Math.abs(s.x - screen.x) <= 8 && Math.abs(s.y - screen.y) <= 8) return h.id
  }
  return null
}

export function applyCrop(ed: Editor): void {
  const d = ed.d
  if (!d) return
  const r = cropRect(ed)
  if (r.x === 0 && r.y === 0 && r.w === d.width && r.h === d.height) return
  cropTo(ed, r)
  d.live.crop = null
  ed.requestRender()
}

export function resetCrop(ed: Editor): void {
  if (!ed.d) return
  ed.d.live.crop = null
  ed.requestRender()
  ed.emit()
}

export const cropTool: Tool = {
  id: 'crop',
  cursor(ed, p) {
    if (!p || !ed.d) return 'crosshair'
    const h = cropHandleAt(ed, p.screen)
    if (h) return HANDLE_CURSORS[h]
    return contains(cropRect(ed), p.doc) ? 'move' : 'crosshair'
  },
  activate(ed) {
    if (ed.d) ed.d.live.crop = null
  },
  deactivate(ed) {
    if (ed.d) ed.d.live.crop = null
  },
  down(ed, p) {
    const h = cropHandleAt(ed, p.screen)
    const r = cropRect(ed)
    if (h) crop = { kind: 'handle', id: h, orig: { ...r } }
    else if (contains(r, p.doc)) crop = { kind: 'move', start: p.doc, orig: { ...r } }
    else crop = { kind: 'new', start: snapPx(p.doc) }
  },
  move(ed, p, dragging) {
    const d = ed.d!
    if (!dragging || !crop) return
    if (crop.kind === 'new') {
      let e = snapPx(p.doc)
      if (p.shift) e = squareFrom(crop.start, e)
      const r = normRect(crop.start, e)
      if (r.w >= 1 && r.h >= 1) d.live.crop = r
    } else if (crop.kind === 'move') {
      d.live.crop = {
        ...crop.orig,
        x: Math.round(crop.orig.x + p.doc.x - crop.start.x),
        y: Math.round(crop.orig.y + p.doc.y - crop.start.y)
      }
    } else {
      const r = dragRectHandle(crop.orig, crop.id, snapPx(p.doc), p.shift)
      d.live.crop = { x: Math.round(r.x), y: Math.round(r.y), w: Math.max(1, Math.round(r.w)), h: Math.max(1, Math.round(r.h)) }
    }
  },
  up(ed) {
    crop = null
    ed.emit()
  },
  dblclick(ed, p) {
    if (contains(cropRect(ed), p.doc)) applyCrop(ed)
  },
  key(ed, e) {
    if (e.key === 'Enter') {
      applyCrop(ed)
      return true
    }
    if (e.key === 'Escape') {
      resetCrop(ed)
      return true
    }
    return false
  },
  cancel() {
    crop = null
  },
  overlay(ed, ctx) {
    const d = ed.d!
    const r = ed.screenRect(cropRect(ed))
    const W = ed.vw
    const H = ed.vh
    ctx.fillStyle = 'rgba(10, 11, 14, 0.62)'
    ctx.beginPath()
    ctx.rect(0, 0, W, H)
    ctx.rect(r.x, r.y, r.w, r.h)
    ctx.fill('evenodd')
    // rule of thirds
    ctx.strokeStyle = 'rgba(255,255,255,0.28)'
    ctx.lineWidth = 1
    ctx.beginPath()
    for (let i = 1; i < 3; i++) {
      const x = Math.round(r.x + (r.w * i) / 3) + 0.5
      const y = Math.round(r.y + (r.h * i) / 3) + 0.5
      ctx.moveTo(x, r.y)
      ctx.lineTo(x, r.y + r.h)
      ctx.moveTo(r.x, y)
      ctx.lineTo(r.x + r.w, y)
    }
    ctx.stroke()
    ctx.strokeStyle = '#fff'
    ctx.lineWidth = 1.5
    ctx.strokeRect(r.x, r.y, r.w, r.h)
    for (const h of rectHandles(cropRect(ed))) {
      const s = ed.toScreen(h)
      ctx.fillStyle = '#fff'
      ctx.fillRect(Math.round(s.x) - 4, Math.round(s.y) - 4, 8, 8)
    }
    const c = cropRect(ed)
    const label = `${c.w} × ${c.h}`
    ctx.font = '600 12px "Segoe UI", system-ui, sans-serif'
    const tw = ctx.measureText(label).width
    const lx = r.x + r.w / 2 - tw / 2 - 8
    const ly = r.y + r.h + 10
    ctx.fillStyle = 'rgba(20,22,28,0.9)'
    ctx.beginPath()
    ctx.roundRect(lx, ly, tw + 16, 22, 11)
    ctx.fill()
    ctx.fillStyle = '#fff'
    ctx.textBaseline = 'middle'
    ctx.fillText(label, lx + 8, ly + 11)
    if (c.x < 0 || c.y < 0 || c.x + c.w > d.width || c.y + c.h > d.height) {
      ctx.fillStyle = 'rgba(255,255,255,0.7)'
      ctx.fillText('Canvas will expand', lx + 8, ly + 34)
    }
  }
}

// ---- view tools ----------------------------------------------------------------------------------

export const handTool: Tool = {
  id: 'hand',
  cursor: () => 'grab'
}

export const zoomTool: Tool = {
  id: 'zoom',
  cursor: (_ed, p) => (p?.alt ? 'zoom-out' : 'zoom-in'),
  down(ed, p) {
    ed.zoomStep(p.alt ? -1 : 1, p.screen)
  }
}
