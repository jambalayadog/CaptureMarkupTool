import { layerBounds, restore, type Snapshot } from '../core/doc'
import { moveObject, objBounds } from '../core/objects'
import type { RasterLayer, VObj, Vec } from '../core/types'
import { normRect, overlaps, uid } from '../core/util'
import { HandleDrag } from './common'
import type { Tool } from './types'

type Mode =
  | { kind: 'move'; start: Vec; before: Snapshot; origs: Map<string, VObj>; moved: boolean; alt: boolean }
  | { kind: 'layer'; layer: RasterLayer; ox: number; oy: number; start: Vec; before: Snapshot; moved: boolean }
  | { kind: 'band'; start: Vec; initial: string[] }

let mode: Mode | null = null
const handles = new HandleDrag()

export const selectTool: Tool = {
  id: 'select',

  cursor(ed, p) {
    if (!p) return 'default'
    return ed.handleCursor(p.screen) ?? (ed.hitTest(p.doc) ? 'move' : 'default')
  },

  down(ed, p) {
    const d = ed.d!
    if (handles.tryStart(ed, p)) return
    const hit = ed.hitTest(p.doc)
    if (hit) {
      let ids = d.selectedIds
      if (p.shift) {
        ids = ids.includes(hit.obj.id) ? ids.filter((i) => i !== hit.obj.id) : [...ids, hit.obj.id]
        ed.select(ids)
        if (!ids.includes(hit.obj.id)) return
      } else if (!ids.includes(hit.obj.id)) ed.select([hit.obj.id])
      d.activeLayerId = hit.layer.id
      mode = { kind: 'move', start: p.doc, before: ed.snapshot(), origs: new Map(), moved: false, alt: p.alt }
      for (const o of ed.selectedObjects()) mode.origs.set(o.id, structuredClone(o))
      ed.emit()
      return
    }
    const layer = ed.hitRaster(p.doc)
    if (layer) {
      d.selectedIds = []
      d.activeLayerId = layer.id
      mode = { kind: 'layer', layer, ox: layer.x, oy: layer.y, start: p.doc, before: ed.snapshot(), moved: false }
      ed.emit()
      return
    }
    mode = { kind: 'band', start: p.doc, initial: p.shift ? [...d.selectedIds] : [] }
    if (!p.shift) ed.select([])
  },

  move(ed, p, dragging) {
    const d = ed.d!
    if (!dragging) {
      const id = ed.hitTest(p.doc)?.obj.id ?? null
      if (id !== d.live.hoverId) {
        d.live.hoverId = id
        ed.requestRender()
      }
      return
    }
    if (handles.active) return handles.move(ed, p)
    if (!mode) return
    if (mode.kind === 'band') {
      d.live.band = normRect(mode.start, p.doc)
      const band = d.live.band
      const ids = new Set(mode.initial)
      for (const l of d.layers) {
        if (l.kind !== 'vector' || !l.visible || l.locked) continue
        for (const o of l.objects) if (overlaps(objBounds(o), band)) ids.add(o.id)
      }
      d.selectedIds = [...ids]
      return
    }
    let dx = p.doc.x - mode.start.x
    let dy = p.doc.y - mode.start.y
    if (p.shift) {
      if (Math.abs(dx) > Math.abs(dy)) dy = 0
      else dx = 0
    }
    dx = Math.round(dx)
    dy = Math.round(dy)
    if (!mode.moved && Math.hypot(dx, dy) * d.view.zoom < 3) return
    if (mode.kind === 'layer') {
      mode.moved = true
      mode.layer.x = mode.ox + dx
      mode.layer.y = mode.oy + dy
      ed.invalidate()
      return
    }
    if (!mode.moved && mode.alt) {
      // Alt-drag: leave copies behind and move the originals' clones.
      const ids: string[] = []
      for (const l of d.layers) {
        if (l.kind !== 'vector') continue
        const out: VObj[] = []
        for (const o of l.objects) {
          out.push(o)
          if (mode.origs.has(o.id)) {
            const c = { ...structuredClone(o), id: uid() }
            out.push(c)
            ids.push(c.id)
            mode.origs.set(c.id, structuredClone(o))
          }
        }
        l.objects = out
      }
      d.selectedIds = ids
    }
    mode.moved = true
    for (const o of ed.selectedObjects()) {
      const orig = mode.origs.get(o.id)
      if (orig) moveObject(o, orig, dx, dy)
    }
    ed.invalidate()
  },

  up(ed) {
    const d = ed.d!
    if (handles.active) return handles.up(ed)
    const m = mode
    mode = null
    if (!m) return
    if (m.kind === 'band') {
      d.live.band = null
      ed.select(d.selectedIds)
    } else if (m.moved) {
      ed.commit(m.kind === 'layer' ? 'Move layer' : m.alt ? 'Duplicate' : 'Move', m.before)
    }
  },

  dblclick(ed, p) {
    const hit = ed.hitTest(p.doc)
    if (hit?.obj.type === 'text') ed.startTextEdit(hit.obj.id, ed.snapshot(), false)
  },

  cancel(ed) {
    handles.cancel(ed)
    const d = ed.d
    if (d && mode && mode.kind !== 'band') restore(d, mode.before)
    if (d) d.live.band = null
    mode = null
    ed.invalidate()
  },

  overlay(ed, ctx) {
    const d = ed.d!
    const l = ed.activeLayer()
    if (l?.kind !== 'raster') return
    const b = layerBounds(l)
    if (b.x === 0 && b.y === 0 && b.w === d.width && b.h === d.height) return
    const r = ed.screenRect(b)
    ctx.strokeStyle = 'rgba(200, 205, 215, 0.7)'
    ctx.lineWidth = 1
    ctx.setLineDash([2, 3])
    ctx.strokeRect(Math.round(r.x) + 0.5, Math.round(r.y) + 0.5, Math.round(r.w), Math.round(r.h))
    ctx.setLineDash([])
  }
}
