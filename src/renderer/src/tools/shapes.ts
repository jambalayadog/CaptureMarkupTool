import { restore, type Snapshot } from '../core/doc'
import type { Editor } from '../core/editor'
import { isDegenerate } from '../core/objects'
import type { ToolId, VObj, Vec, VectorLayer } from '../core/types'
import { snap45, uid } from '../core/util'
import { HandleDrag } from './common'
import type { PointerInfo, Tool } from './types'

type ShapeTool = 'arrow' | 'line' | 'rect' | 'ellipse' | 'redact' | 'highlight'

interface Draft {
  obj: VObj
  layer: VectorLayer
  start: Vec
  before: Snapshot
  /** Existing object under the pointer at mouse-down (selected on a plain click). */
  clicked: string | null
}

const round = (p: Vec): Vec => ({ x: Math.round(p.x), y: Math.round(p.y) })

function create(ed: Editor, tool: ShapeTool, p: Vec): VObj {
  const o = ed.opts
  const id = uid()
  switch (tool) {
    case 'arrow':
    case 'line':
      return {
        id,
        type: 'line',
        x1: p.x,
        y1: p.y,
        x2: p.x,
        y2: p.y,
        color: ed.primary,
        width: o.strokeWidth,
        start: tool === 'arrow' ? o.arrowStart : 'none',
        end: tool === 'arrow' ? o.arrowEnd : 'none',
        dashed: o.dashed,
        shadow: o.shadow
      }
    case 'rect':
    case 'ellipse':
      return {
        id,
        type: tool,
        x: p.x,
        y: p.y,
        w: 0,
        h: 0,
        stroke: ed.primary,
        strokeWidth: o.strokeWidth,
        fill: o.shapeFill ? ed.secondary : null,
        radius: o.cornerRadius,
        dashed: o.dashed,
        shadow: o.shadow
      }
    case 'redact':
      return { id, type: 'redact', x: p.x, y: p.y, w: 0, h: 0, mode: o.redactMode, strength: o.redactStrength, color: '#000000' }
    case 'highlight':
      return { id, type: 'path', points: [p], color: ed.highlightColor, width: o.highlightWidth, opacity: o.highlightOpacity, blend: 'multiply' }
  }
}

function update(o: VObj, start: Vec, p: PointerInfo): void {
  const q = round(p.doc)
  switch (o.type) {
    case 'line': {
      const e = p.shift ? snap45(start, q) : q
      o.x2 = e.x
      o.y2 = e.y
      break
    }
    case 'rect':
    case 'ellipse':
    case 'redact': {
      let w = q.x - start.x
      let h = q.y - start.y
      if (p.shift) {
        const s = Math.max(Math.abs(w), Math.abs(h))
        w = Math.sign(w || 1) * s
        h = Math.sign(h || 1) * s
      }
      if (p.alt) {
        // draw out from the centre
        o.x = start.x - Math.abs(w)
        o.y = start.y - Math.abs(h)
        o.w = Math.abs(w) * 2
        o.h = Math.abs(h) * 2
      } else {
        o.x = Math.min(start.x, start.x + w)
        o.y = Math.min(start.y, start.y + h)
        o.w = Math.abs(w)
        o.h = Math.abs(h)
      }
      break
    }
    case 'path': {
      if (p.shift) {
        o.points = [o.points[0], snap45(o.points[0], p.doc)]
        break
      }
      const last = o.points[o.points.length - 1]
      if (Math.hypot(p.doc.x - last.x, p.doc.y - last.y) >= 1) o.points.push({ x: p.doc.x, y: p.doc.y })
      break
    }
  }
}

const LABELS: Record<ShapeTool, string> = {
  arrow: 'Add arrow',
  line: 'Add line',
  rect: 'Add rectangle',
  ellipse: 'Add ellipse',
  redact: 'Add redaction',
  highlight: 'Highlight'
}

function makeShapeTool(id: ShapeTool): Tool {
  let draft: Draft | null = null
  const handles = new HandleDrag()
  return {
    id: id as ToolId,
    cursor: (ed, p) => (p && ed.handleCursor(p.screen)) || 'crosshair',
    down(ed, p) {
      if (handles.tryStart(ed, p)) return
      const clicked = ed.hitTest(p.doc)?.obj.id ?? null
      const before = ed.snapshot()
      const layer = ed.ensureVectorLayer()
      const start = id === 'highlight' ? p.doc : round(p.doc)
      const obj = create(ed, id, start)
      layer.objects.push(obj)
      ed.d!.selectedIds = []
      draft = { obj, layer, start, before, clicked }
      ed.invalidate()
    },
    move(ed, p, dragging) {
      if (!dragging) return
      if (handles.active) return handles.move(ed, p)
      if (!draft) return
      update(draft.obj, draft.start, p)
      ed.invalidate()
    },
    up(ed) {
      if (handles.active) return handles.up(ed)
      const dr = draft
      draft = null
      if (!dr || !ed.d) return
      if (isDegenerate(dr.obj)) {
        restore(ed.d, dr.before)
        ed.select(dr.clicked ? [dr.clicked] : [])
        ed.invalidate()
        return
      }
      ed.d.selectedIds = [dr.obj.id]
      ed.pushRecent(id === 'highlight' ? ed.highlightColor : ed.primary)
      ed.commit(LABELS[id], dr.before)
    },
    cancel(ed) {
      handles.cancel(ed)
      if (draft && ed.d) restore(ed.d, draft.before)
      draft = null
      ed.invalidate()
    }
  }
}

export const arrowTool = makeShapeTool('arrow')
export const lineTool = makeShapeTool('line')
export const rectTool = makeShapeTool('rect')
export const ellipseTool = makeShapeTool('ellipse')
export const redactTool = makeShapeTool('redact')
export const highlightTool = makeShapeTool('highlight')
