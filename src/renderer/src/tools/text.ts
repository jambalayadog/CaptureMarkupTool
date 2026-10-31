import { restore, type Snapshot } from '../core/doc'
import { moveObject, textLayout } from '../core/objects'
import type { Rect, StepObj, TextObj, Vec } from '../core/types'
import { normRect, uid } from '../core/util'
import { HandleDrag } from './common'
import type { Tool } from './types'

// ---- text and callouts --------------------------------------------------------------------

/**
 * Text in the primary colour, on an optional box in the secondary; a callout is text
 * with pointers (dragged out of its "+" knob). Click to type (the box fits the text),
 * or drag to draw a box the text wraps in. Pressing existing text edits it on release,
 * or moves it if you drag.
 */
type TextPress =
  | { kind: 'new'; start: Vec; before: Snapshot; box: Rect | null }
  | { kind: 'existing'; obj: TextObj; orig: TextObj; start: Vec; before: Snapshot; moved: boolean }

let textPress: TextPress | null = null
const textHandles = new HandleDrag()

export const textTool: Tool = {
  id: 'text',
  cursor(ed, p) {
    if (!p) return 'text'
    const h = ed.handleCursor(p.screen)
    if (h) return h
    const hit = ed.hitTest(p.doc)
    return hit?.obj.type === 'text' && ed.d!.selectedIds.includes(hit.obj.id) ? 'move' : 'text'
  },
  down(ed, p) {
    if (textHandles.tryStart(ed, p)) return
    const before = ed.snapshot()
    const hit = ed.hitTest(p.doc)
    textPress =
      hit?.obj.type === 'text'
        ? { kind: 'existing', obj: hit.obj, orig: structuredClone(hit.obj), start: p.doc, before, moved: false }
        : { kind: 'new', start: p.doc, before, box: null }
  },
  move(ed, p, dragging) {
    if (!dragging) return
    if (textHandles.active) return textHandles.move(ed, p)
    if (!textPress) return
    // a small wobble is still a click
    const far = Math.hypot(p.doc.x - textPress.start.x, p.doc.y - textPress.start.y) * ed.d!.view.zoom >= 6
    if (textPress.kind === 'existing') {
      if (!textPress.moved && !far) return
      if (!textPress.moved) ed.select([textPress.obj.id])
      textPress.moved = true
      moveObject(textPress.obj, textPress.orig, Math.round(p.doc.x - textPress.start.x), Math.round(p.doc.y - textPress.start.y))
      ed.invalidate()
      return
    }
    if (!textPress.box && !far) return
    const r = normRect(textPress.start, p.doc)
    textPress.box = { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.w), h: Math.round(r.h) }
    ed.d!.live.band = textPress.box
    ed.invalidate()
  },
  up(ed) {
    if (textHandles.active) return textHandles.up(ed)
    const t = textPress
    textPress = null
    if (!t) return
    if (t.kind === 'existing') {
      if (t.moved) ed.commit('Move', t.before)
      else ed.startTextEdit(t.obj.id, t.before, false)
      return
    }
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
      tails: [],
      arrows: o.tailArrows,
      tailWidth: o.tailWidth,
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
    if (textPress && ed.d) {
      if (textPress.kind === 'existing' && textPress.moved) restore(ed.d, textPress.before)
      ed.d.live.band = null
    }
    textPress = null
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
      textColor: ed.opts.stepSecondaryText ? ed.secondary : null,
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
