import { useSyncExternalStore } from 'react'
import { Editor } from '../core/editor'

export const editor = new Editor()

// Handy for debugging from devtools.
;(window as unknown as { editor: Editor }).editor = editor

/** Re-render whenever the editor emits a change. */
export function useEditor(): Editor {
  useSyncExternalStore(editor.subscribe, editor.getVersion)
  return editor
}

let cursorVersion = 0
const bumpCursor = (): number => ++cursorVersion
editor.subscribeCursor(bumpCursor)

/** Re-render on pointer movement over the canvas (status bar only). */
export function useCursor(): Editor['cursor'] {
  useSyncExternalStore(editor.subscribeCursor, () => cursorVersion)
  return editor.cursor
}
