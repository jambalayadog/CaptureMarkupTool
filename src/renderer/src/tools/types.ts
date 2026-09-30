import type { Editor } from '../core/editor'
import type { ToolId, Vec } from '../core/types'

export interface PointerInfo {
  /** Document coordinates (fractional). */
  doc: Vec
  /** Document pixel the pointer is over. */
  px: Vec
  /** CSS pixels relative to the canvas. */
  screen: Vec
  button: number
  shift: boolean
  alt: boolean
  ctrl: boolean
  pressure: number
  pointerType: string
}

export interface Tool {
  id: ToolId
  cursor(ed: Editor, p: PointerInfo | null): string
  down?(ed: Editor, p: PointerInfo): void
  /** Called while dragging (`dragging` true) and on hover. */
  move?(ed: Editor, p: PointerInfo, dragging: boolean): void
  up?(ed: Editor, p: PointerInfo): void
  dblclick?(ed: Editor, p: PointerInfo): void
  /** Escape pressed / tool switched mid-operation. */
  cancel?(ed: Editor): void
  /** Return true if the key was handled. */
  key?(ed: Editor, e: KeyboardEvent): boolean
  /** Draw on top of the canvas in CSS-pixel screen space. */
  overlay?(ed: Editor, ctx: CanvasRenderingContext2D): void
  activate?(ed: Editor): void
  deactivate?(ed: Editor): void
}
