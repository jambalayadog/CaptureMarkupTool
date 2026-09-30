import type { Snapshot } from '../core/doc'
import { restore } from '../core/doc'
import type { Editor } from '../core/editor'
import { dragHandle, type HandleId } from '../core/objects'
import type { VObj } from '../core/types'
import type { PointerInfo } from './types'

/** Dragging a resize/endpoint handle of the selected object; shared by all vector tools. */
export class HandleDrag {
  private s: { obj: VObj; orig: VObj; id: HandleId; before: Snapshot } | null = null

  get active(): boolean {
    return !!this.s
  }

  tryStart(ed: Editor, p: PointerInfo): boolean {
    const h = ed.hitHandle(p.screen)
    if (!h) return false
    this.s = { obj: h.obj, orig: structuredClone(h.obj), id: h.handle.id, before: ed.snapshot() }
    return true
  }

  move(ed: Editor, p: PointerInfo): void {
    if (!this.s) return
    const q = { x: Math.round(p.doc.x), y: Math.round(p.doc.y) }
    dragHandle(this.s.obj, this.s.orig, this.s.id, q, p.shift)
    ed.invalidate()
  }

  up(ed: Editor): void {
    if (!this.s) return
    const { before } = this.s
    this.s = null
    ed.commit('Resize', before)
  }

  cancel(ed: Editor): void {
    if (!this.s || !ed.d) return
    restore(ed.d, this.s.before)
    this.s = null
    ed.invalidate()
  }
}
