// Pixel selection tools: rectangle marquee, lasso (freehand + polygon) and magic wand.
// Shift adds to the selection, Alt subtracts, Shift+Alt intersects.
import type { Editor } from '../core/editor'
import { floodMask } from '../core/raster'
import { renderDoc } from '../core/render'
import { floodSel, polygonSel, rectSel, selectionTester } from '../core/selection'
import type { SelectMode, Selection, Vec } from '../core/types'
import { clamp, ctx2d, normRect, snap45 } from '../core/util'
import type { Tool } from './types'

const snapPx = (p: Vec): Vec => ({ x: Math.round(p.x), y: Math.round(p.y) })

function squareFrom(a: Vec, b: Vec): Vec {
  const s = Math.max(Math.abs(b.x - a.x), Math.abs(b.y - a.y))
  return { x: a.x + Math.sign(b.x - a.x || 1) * s, y: a.y + Math.sign(b.y - a.y || 1) * s }
}

function insideSelection(ed: Editor, p: Vec): boolean {
  const s = ed.d?.selection
  return !!s && selectionTester(s)(Math.floor(p.x), Math.floor(p.y))
}

/** Dashed black/white line for a selection that's still being drawn (screen space). */
function strokeAnts(ctx: CanvasRenderingContext2D, trace: () => void): void {
  ctx.save()
  ctx.lineWidth = 1
  ctx.setLineDash([4, 4])
  ctx.strokeStyle = '#000'
  ctx.beginPath()
  trace()
  ctx.stroke()
  ctx.strokeStyle = '#fff'
  ctx.lineDashOffset = 4
  ctx.beginPath()
  trace()
  ctx.stroke()
  ctx.restore()
}

// ---- rectangle marquee ----------------------------------------------------------------------

type MarqueeDrag = { kind: 'new'; start: Vec; end: Vec | null; mode: SelectMode } | { kind: 'move'; start: Vec; orig: Selection }

let marquee: MarqueeDrag | null = null

export const marqueeTool: Tool = {
  id: 'marquee',
  cursor: (ed, p) => (p && ed.selectModeFor(p) === 'replace' && insideSelection(ed, p.doc) ? 'move' : 'crosshair'),
  down(ed, p) {
    const d = ed.d!
    const mode = ed.selectModeFor(p)
    if (mode === 'replace' && insideSelection(ed, p.doc)) {
      marquee = { kind: 'move', start: p.doc, orig: d.selection! }
      return
    }
    if (mode === 'replace' && d.selection) ed.setSelection(null)
    const s = snapPx(p.doc)
    marquee = { kind: 'new', start: { x: clamp(s.x, 0, d.width), y: clamp(s.y, 0, d.height) }, end: null, mode }
  },
  move(ed, p, dragging) {
    const d = ed.d!
    if (!dragging || !marquee) return
    if (marquee.kind === 'move') {
      const o = marquee.orig
      const dx = Math.round(p.doc.x - marquee.start.x)
      const dy = Math.round(p.doc.y - marquee.start.y)
      d.selection = { ...o, x: clamp(o.x + dx, 0, d.width - o.w), y: clamp(o.y + dy, 0, d.height - o.h) }
      return
    }
    let e = snapPx(p.doc)
    if (p.shift && marquee.mode === 'replace') e = squareFrom(marquee.start, e)
    marquee.end = { x: clamp(e.x, 0, d.width), y: clamp(e.y, 0, d.height) }
  },
  up(ed) {
    const m = marquee
    marquee = null
    if (!m) return
    if (m.kind === 'move') return ed.setSelection(ed.d!.selection)
    const r = m.end ? normRect(m.start, m.end) : null
    if (r && r.w >= 1 && r.h >= 1) ed.applySelection(rectSel(r), m.mode)
    else if (m.mode === 'replace') ed.setSelection(null)
    ed.requestRender()
  },
  cancel(ed) {
    if (marquee?.kind === 'move' && ed.d) ed.d.selection = marquee.orig
    marquee = null
    ed.requestRender()
  },
  overlay(ed, ctx) {
    if (marquee?.kind !== 'new' || !marquee.end) return
    const r = ed.screenRect(normRect(marquee.start, marquee.end))
    strokeAnts(ctx, () => ctx.rect(Math.round(r.x) + 0.5, Math.round(r.y) + 0.5, Math.round(r.w), Math.round(r.h)))
  }
}

// ---- lasso ------------------------------------------------------------------------------------

interface LassoState {
  pts: Vec[]
  mode: SelectMode
  /** 'pending' until the pointer either drags (freehand) or releases (polygon). */
  phase: 'pending' | 'free' | 'poly'
  downAt: Vec
  hover: Vec | null
}

let lasso: LassoState | null = null

function finishLasso(ed: Editor): void {
  const l = lasso
  lasso = null
  if (!l) return
  const pts = l.pts.filter((p, i) => i === 0 || Math.hypot(p.x - l.pts[i - 1].x, p.y - l.pts[i - 1].y) >= 0.5)
  const sel = polygonSel(pts, ed.opts.lassoAntiAlias)
  if (sel) ed.applySelection(sel, l.mode)
  else if (l.mode === 'replace') ed.setSelection(null)
  ed.requestRender()
}

function nearStart(ed: Editor, l: LassoState, screen: Vec): boolean {
  const s = ed.toScreen(l.pts[0])
  return l.pts.length >= 3 && Math.hypot(s.x - screen.x, s.y - screen.y) <= 8
}

export const lassoTool: Tool = {
  id: 'lasso',
  cursor: () => 'crosshair',
  down(ed, p) {
    if (lasso?.phase === 'poly') {
      if (nearStart(ed, lasso, p.screen)) return finishLasso(ed)
      const last = lasso.pts[lasso.pts.length - 1]
      lasso.pts.push(p.shift ? snap45(last, p.doc) : p.doc)
      return
    }
    const mode = ed.selectModeFor(p)
    if (mode === 'replace' && ed.d!.selection) ed.setSelection(null)
    lasso = { pts: [p.doc], mode, phase: 'pending', downAt: p.screen, hover: null }
  },
  move(ed, p, dragging) {
    if (!lasso) return
    if (lasso.phase === 'poly') {
      const last = lasso.pts[lasso.pts.length - 1]
      lasso.hover = p.shift ? snap45(last, p.doc) : p.doc
      ed.requestRender()
      return
    }
    if (!dragging) return
    if (lasso.phase === 'pending' && Math.hypot(p.screen.x - lasso.downAt.x, p.screen.y - lasso.downAt.y) < 4) return
    lasso.phase = 'free'
    const last = lasso.pts[lasso.pts.length - 1]
    if (Math.hypot(p.doc.x - last.x, p.doc.y - last.y) * ed.d!.view.zoom >= 2) lasso.pts.push(p.doc)
  },
  up(ed) {
    if (!lasso) return
    if (lasso.phase === 'free') finishLasso(ed)
    else if (lasso.phase === 'pending') lasso.phase = 'poly'
  },
  dblclick(ed) {
    if (lasso?.phase === 'poly') finishLasso(ed)
  },
  key(ed, e) {
    if (lasso?.phase !== 'poly') return false
    if (e.key === 'Enter') finishLasso(ed)
    else if (e.key === 'Escape') lasso = null
    else if (e.key === 'Backspace' || e.key === 'Delete') {
      if (lasso.pts.length > 1) lasso.pts.pop()
      else lasso = null
    } else return false
    ed.requestRender()
    return true
  },
  cancel(ed) {
    lasso = null
    ed.requestRender()
  },
  deactivate() {
    lasso = null
  },
  overlay(ed, ctx) {
    const l = lasso
    if (!l) return
    const pts = l.phase === 'poly' && l.hover ? [...l.pts, l.hover] : l.pts
    strokeAnts(ctx, () => {
      pts.forEach((q, i) => {
        const s = ed.toScreen(q)
        if (i) ctx.lineTo(s.x, s.y)
        else ctx.moveTo(s.x, s.y)
      })
      if (l.phase === 'free') ctx.closePath()
    })
    if (l.phase !== 'poly') return
    const closing = l.hover && nearStart(ed, l, ed.toScreen(l.hover))
    l.pts.forEach((q, i) => {
      const s = ed.toScreen(q)
      const big = i === 0 && closing
      ctx.fillStyle = big ? '#5b8cff' : '#fff'
      ctx.strokeStyle = '#000'
      ctx.lineWidth = 1
      const r = big ? 5 : 3
      ctx.fillRect(Math.round(s.x) - r, Math.round(s.y) - r, r * 2, r * 2)
      ctx.strokeRect(Math.round(s.x) - r + 0.5, Math.round(s.y) - r + 0.5, r * 2 - 1, r * 2 - 1)
    })
  }
}

// ---- magic wand ----------------------------------------------------------------------------------

export const wandTool: Tool = {
  id: 'wand',
  cursor: () => 'crosshair',
  down(ed, p) {
    const d = ed.d!
    const mode = ed.selectModeFor(p)
    const miss = (): void => {
      if (mode === 'replace') ed.setSelection(null)
    }
    if (p.px.x < 0 || p.px.y < 0 || p.px.x >= d.width || p.px.y >= d.height) return miss()
    const o = ed.opts
    const l = ed.activeLayer()
    let img: ImageData
    let off: Vec = { x: 0, y: 0 }
    if (o.wandSampleMerged || l?.kind !== 'raster') {
      if (d.compDirty) {
        renderDoc(d, d.comp, true)
        d.compDirty = false
      }
      img = ctx2d(d.comp).getImageData(0, 0, d.width, d.height)
    } else {
      img = ctx2d(l.canvas).getImageData(0, 0, l.canvas.width, l.canvas.height)
      off = { x: l.x, y: l.y }
    }
    const fm = floodMask(img, p.px.x - off.x, p.px.y - off.y, o.wandTolerance, o.wandContiguous, {
      x: -off.x,
      y: -off.y,
      w: d.width,
      h: d.height
    })
    if (!fm) return miss()
    ed.applySelection(floodSel(fm, img.width, off.x, off.y), mode)
  }
}
