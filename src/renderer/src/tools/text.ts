import { restore, type Snapshot } from '../core/doc'
import { moveObject, textLayout } from '../core/objects'
import type { Rect, StepObj, TextObj, Vec } from '../core/types'
import { contrastText, normRect, uid } from '../core/util'
import { HandleDrag } from './common'
import type { Tool } from './types'

// ---- text -----------------------------------------------------------------------------

/** Click to type (the box fits the text), or drag to draw a box the text wraps in. */
let textDraw: { start: Vec; before: Snapshot; box: Rect | null } | null = null
const textHandles = new HandleDrag()

export const textTool: Tool = {
  id: 'text',
  cursor: (ed, p) => (p && ed.handleCursor(p.screen)) || 'text',
  down(ed, p) {
    if (textHandles.tryStart(ed, p)) return
    const hit = ed.hitTest(p.doc)
    if (hit?.obj.type === 'text') {
      ed.startTextEdit(hit.obj.id, ed.snapshot(), false)
      return
    }
    textDraw = { start: p.doc, before: ed.snapshot(), box: null }
  },
  move(ed, p, dragging) {
    if (!dragging) return
    if (textHandles.active) return textHandles.move(ed, p)
    if (!textDraw) return
    const r = normRect(textDraw.start, p.doc)
    // a small wobble is still a click
    if (!textDraw.box && Math.max(r.w, r.h) * ed.d!.view.zoom < 6) return
    textDraw.box = { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.w), h: Math.round(r.h) }
    ed.d!.live.band = textDraw.box
    ed.invalidate()
  },
  up(ed) {
    if (textHandles.active) return textHandles.up(ed)
    const t = textDraw
    textDraw = null
    if (!t) return
    ed.d!.live.band = null
    const layer = ed.ensureVectorLayer()
    const o = ed.opts
    const obj: TextObj = {
      id: uid(),
      type: 'text',
      x: 0,
      y: 0,
      text: '',
      fontSize: o.fontSize,
      fontFamily: o.fontFamily,
      bold: o.bold,
      color: ed.primary,
      bg: o.textBg ? ed.secondary : null,
      tail: null,
      shadow: o.shadow,
      boxW: null,
      boxH: null,
      align: o.textAlign,
      valign: o.textVAlign
    }
    const L = textLayout(obj)
    if (t.box) {
      obj.x = t.box.x
      obj.y = t.box.y
      obj.boxW = Math.max(Math.ceil(obj.fontSize + L.pad * 2), t.box.w)
      obj.boxH = t.box.h > L.h ? t.box.h : null
    } else {
      obj.x = Math.round(t.start.x - L.pad)
      obj.y = Math.round(t.start.y - L.pad - L.lineH / 2)
    }
    layer.objects.push(obj)
    ed.pushRecent(ed.primary)
    ed.startTextEdit(obj.id, t.before, true)
  },
  cancel(ed) {
    textHandles.cancel(ed)
    if (textDraw && ed.d) ed.d.live.band = null
    textDraw = null
  }
}

// ---- callout (speech bubble) ----------------------------------------------------------------

let callout: { obj: TextObj; start: Vec; before: Snapshot; dragged: boolean } | null = null
const calloutHandles = new HandleDrag()

function placeBubble(obj: TextObj, center: Vec): void {
  const L = textLayout({ ...obj, text: obj.text || 'Text' })
  obj.x = Math.round(center.x - L.w / 2)
  obj.y = Math.round(center.y - L.h / 2)
}

export const calloutTool: Tool = {
  id: 'callout',
  cursor: (ed, p) => (p && ed.handleCursor(p.screen)) || 'crosshair',
  down(ed, p) {
    if (calloutHandles.tryStart(ed, p)) return
    const hit = ed.hitTest(p.doc)
    if (hit?.obj.type === 'text' && hit.obj.tail) {
      ed.startTextEdit(hit.obj.id, ed.snapshot(), false)
      return
    }
    const before = ed.snapshot()
    const layer = ed.ensureVectorLayer()
    const o = ed.opts
    const obj: TextObj = {
      id: uid(),
      type: 'text',
      x: 0,
      y: 0,
      text: '',
      fontSize: o.fontSize,
      fontFamily: o.fontFamily,
      bold: o.bold,
      color: contrastText(ed.primary),
      bg: ed.primary,
      tail: { x: p.doc.x, y: p.doc.y },
      shadow: o.shadow,
      boxW: null,
      boxH: null,
      align: o.textAlign,
      valign: o.textVAlign
    }
    placeBubble(obj, { x: p.doc.x + 90, y: p.doc.y - 70 })
    layer.objects.push(obj)
    ed.d!.selectedIds = [obj.id]
    callout = { obj, start: p.doc, before, dragged: false }
    ed.invalidate()
  },
  move(ed, p, dragging) {
    if (!dragging) return
    if (calloutHandles.active) return calloutHandles.move(ed, p)
    if (!callout) return
    if (Math.hypot(p.doc.x - callout.start.x, p.doc.y - callout.start.y) * ed.d!.view.zoom < 6 && !callout.dragged) return
    callout.dragged = true
    placeBubble(callout.obj, p.doc)
    ed.invalidate()
  },
  up(ed) {
    if (calloutHandles.active) return calloutHandles.up(ed)
    const c = callout
    callout = null
    if (!c) return
    ed.pushRecent(ed.primary)
    ed.startTextEdit(c.obj.id, c.before, true)
  },
  cancel(ed) {
    calloutHandles.cancel(ed)
    if (callout && ed.d) restore(ed.d, callout.before)
    callout = null
  }
}

// ---- numbered steps ---------------------------------------------------------------------------

let step: { obj: StepObj; orig: StepObj; start: Vec; before: Snapshot; isNew: boolean; moved: boolean } | null = null

export const stepTool: Tool = {
  id: 'step',
  cursor: (ed, p) => (p && ed.hitTest(p.doc)?.obj.type === 'step' ? 'move' : 'crosshair'),
  down(ed, p) {
    const before = ed.snapshot()
    const hit = ed.hitTest(p.doc)
    if (hit?.obj.type === 'step') {
      ed.select([hit.obj.id])
      step = { obj: hit.obj, orig: structuredClone(hit.obj), start: p.doc, before, isNew: false, moved: false }
      return
    }
    const layer = ed.ensureVectorLayer()
    const obj: StepObj = {
      id: uid(),
      type: 'step',
      x: Math.round(p.doc.x),
      y: Math.round(p.doc.y),
      n: ed.nextStepNumber(),
      size: ed.opts.stepSize,
      color: ed.primary,
      shadow: ed.opts.shadow
    }
    layer.objects.push(obj)
    // after a restart, keep counting from the restarted number
    if (ed.d!.stepNext != null) ed.d!.stepNext = obj.n + 1
    ed.d!.selectedIds = [obj.id]
    step = { obj, orig: structuredClone(obj), start: p.doc, before, isNew: true, moved: false }
    ed.invalidate()
  },
  move(ed, p, dragging) {
    if (!dragging || !step) return
    step.moved = true
    moveObject(step.obj, step.orig, Math.round(p.doc.x - step.start.x), Math.round(p.doc.y - step.start.y))
    ed.invalidate()
  },
  up(ed) {
    const s = step
    step = null
    if (!s) return
    if (s.isNew) {
      ed.pushRecent(ed.primary)
      ed.commit('Add step', s.before)
    } else if (s.moved) ed.commit('Move', s.before)
    else ed.emit()
  },
  cancel(ed) {
    if (step && ed.d) restore(ed.d, step.before)
    step = null
  }
}
