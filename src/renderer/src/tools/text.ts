import { restore, type Snapshot } from '../core/doc'
import { moveObject, textLayout } from '../core/objects'
import type { Rect, StepObj, TextObj, Vec } from '../core/types'
import { contrastText, normRect, uid } from '../core/util'
import { HandleDrag } from './common'
import type { Tool } from './types'

// ---- text and callouts --------------------------------------------------------------------

/**
 * Text and callouts are the same object in different colours: text in the primary
 * colour (on an optional box in the secondary), or a callout filled with the primary
 * colour. Click to type (the box fits the text), or drag to draw a box the text wraps
 * in. Pressing existing text edits it on release, or moves it if you drag.
 */
type TextPress =
  | { kind: 'new'; start: Vec; before: Snapshot; box: Rect | null }
  | { kind: 'existing'; obj: TextObj; orig: TextObj; start: Vec; before: Snapshot; moved: boolean }

function makeTextTool(id: 'text' | 'callout', idleCursor: string): Tool {
  let press: TextPress | null = null
  const handles = new HandleDrag()
  return {
    id,
    cursor(ed, p) {
      if (!p) return idleCursor
      const h = ed.handleCursor(p.screen)
      if (h) return h
      const hit = ed.hitTest(p.doc)
      if (hit?.obj.type === 'text') return ed.d!.selectedIds.includes(hit.obj.id) ? 'move' : 'text'
      return idleCursor
    },
    down(ed, p) {
      if (handles.tryStart(ed, p)) return
      const before = ed.snapshot()
      const hit = ed.hitTest(p.doc)
      press =
        hit?.obj.type === 'text'
          ? { kind: 'existing', obj: hit.obj, orig: structuredClone(hit.obj), start: p.doc, before, moved: false }
          : { kind: 'new', start: p.doc, before, box: null }
    },
    move(ed, p, dragging) {
      if (!dragging) return
      if (handles.active) return handles.move(ed, p)
      if (!press) return
      // a small wobble is still a click
      const far = Math.hypot(p.doc.x - press.start.x, p.doc.y - press.start.y) * ed.d!.view.zoom >= 6
      if (press.kind === 'existing') {
        if (!press.moved && !far) return
        if (!press.moved) ed.select([press.obj.id])
        press.moved = true
        moveObject(press.obj, press.orig, Math.round(p.doc.x - press.start.x), Math.round(p.doc.y - press.start.y))
        ed.invalidate()
        return
      }
      if (!press.box && !far) return
      const r = normRect(press.start, p.doc)
      press.box = { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.w), h: Math.round(r.h) }
      ed.d!.live.band = press.box
      ed.invalidate()
    },
    up(ed) {
      if (handles.active) return handles.up(ed)
      const t = press
      press = null
      if (!t) return
      if (t.kind === 'existing') {
        if (t.moved) ed.commit('Move', t.before)
        else ed.startTextEdit(t.obj.id, t.before, false)
        return
      }
      ed.d!.live.band = null
      const layer = ed.ensureVectorLayer()
      const o = ed.opts
      const callout = id === 'callout'
      const obj: TextObj = {
        id: uid(),
        type: 'text',
        x: 0,
        y: 0,
        text: '',
        fontSize: o.fontSize,
        fontFamily: o.fontFamily,
        bold: o.bold,
        color: callout ? contrastText(ed.primary) : ed.primary,
        bg: callout ? ed.primary : o.textBg ? ed.secondary : null,
        tails: [],
        arrows: o.tailArrows,
        callout,
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
      handles.cancel(ed)
      if (press && ed.d) {
        if (press.kind === 'existing' && press.moved) restore(ed.d, press.before)
        ed.d.live.band = null
      }
      press = null
    }
  }
}

export const textTool = makeTextTool('text', 'text')
export const calloutTool = makeTextTool('callout', 'crosshair')

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
