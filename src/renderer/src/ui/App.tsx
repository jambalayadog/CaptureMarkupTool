import { X } from 'lucide-react'
import { useEffect } from 'react'
import { decodeImage } from '../core/io'
import { api, browserCapture, fileToOpened } from '../core/platform'
import { CanvasView } from './CanvasView'
import { CaptureStrip } from './CaptureStrip'
import { ColorPanel } from './ColorPanel'
import { Dialogs } from './Dialogs'
import { LayersPanel } from './LayersPanel'
import { OptionsBar } from './OptionsBar'
import { editor, useEditor } from './state'
import { StatusBar } from './StatusBar'
import { TitleBar } from './TitleBar'
import { ToolRail } from './ToolRail'
import { Welcome } from './Welcome'

export async function startCapture(): Promise<void> {
  if (api) return api.startCapture()
  const c = await browserCapture()
  if (c) editor.openCanvas(c, 'Capture', { layerName: 'Screenshot' })
}

const NON_TEXT_INPUTS = new Set(['range', 'checkbox', 'radio', 'button', 'submit', 'color'])

/** True when keystrokes belong to a text field rather than to the editor. */
const isTyping = (t: EventTarget | null): boolean =>
  t instanceof HTMLElement &&
  ((t instanceof HTMLInputElement && !NON_TEXT_INPUTS.has(t.type)) || t.tagName === 'TEXTAREA' || t.isContentEditable)

export function App(): React.JSX.Element {
  const ed = useEditor()

  useEffect(() => {
    const down = (e: KeyboardEvent): void => {
      if (isTyping(e.target)) return
      // Sliders keep focus after dragging; don't let them eat arrow keys meant for nudging.
      if (e.target instanceof HTMLInputElement && e.target.type === 'range' && e.key.startsWith('Arrow')) e.target.blur()
      if (ed.keyDown(e)) e.preventDefault()
    }
    const up = (e: KeyboardEvent): void => ed.keyUp(e)
    const paste = (e: ClipboardEvent): void => {
      if (isTyping(e.target) || ed.dialog) return
      void ed.handlePaste(e)
    }
    const blur = (): void => {
      ed.spaceHeld = false
    }
    // Mouse-clicked buttons shouldn't keep focus: Space (pan) or Enter would re-press them.
    const click = (e: MouseEvent): void => {
      const b = (e.target as Element | null)?.closest?.('button')
      if (b && e.detail > 0) b.blur()
    }
    window.addEventListener('click', click, true)
    // In a plain browser tab, warn before losing unsaved work (Electron handles this in main).
    const unload = (e: BeforeUnloadEvent): void => {
      if (!api && ed.docs.some((d) => d.history.dirty)) e.preventDefault()
    }
    window.addEventListener('keydown', down)
    window.addEventListener('keyup', up)
    window.addEventListener('paste', paste)
    window.addEventListener('blur', blur)
    window.addEventListener('beforeunload', unload)
    // Auto-saved captures get linked to their library file (so Ctrl+S updates it).
    // The saved path can arrive before or after the image is decoded, so pair them by id.
    const captureDocs = new Map<number, string>()
    const savedPaths = new Map<number, string>()
    const link = (id: number): void => {
      const docId = captureDocs.get(id)
      const path = savedPaths.get(id)
      if (!docId || !path) return
      captureDocs.delete(id)
      savedPaths.delete(id)
      const doc = editor.docs.find((d) => d.id === docId)
      if (!doc || doc.filePath || doc.fileHandle) return
      doc.filePath = path
      doc.fileKind = 'png'
      editor.emit()
    }
    const offCapture = api?.onCapture(async ({ png, name, id }) => {
      editor.openCanvas(await decodeImage(png), name, { layerName: 'Screenshot' })
      if (editor.d) captureDocs.set(id, editor.d.id)
      link(id)
    })
    const offSaved = api?.onCaptureSaved(({ id, path }) => {
      savedPaths.set(id, path)
      link(id)
    })
    // Messages from the main process are warnings/errors: keep them up until dismissed.
    const offNotify = api?.onNotify((text) => editor.warn(text))
    const offOpen = api?.onOpenFiles((files) => void editor.openFiles(files))
    void api?.getSettings().then((s) => {
      editor.wheelZooms = s.wheelZoom
    })
    api?.ready()
    return () => {
      window.removeEventListener('keydown', down)
      window.removeEventListener('keyup', up)
      window.removeEventListener('paste', paste)
      window.removeEventListener('blur', blur)
      window.removeEventListener('beforeunload', unload)
      window.removeEventListener('click', click, true)
      offCapture?.()
      offSaved?.()
      offNotify?.()
      offOpen?.()
    }
  }, [ed])

  const onDrop = async (e: React.DragEvent): Promise<void> => {
    e.preventDefault()
    const files = Array.from(e.dataTransfer.files)
    if (files.length) await ed.openFiles(await Promise.all(files.map(fileToOpened)))
  }

  return (
    <div className="app" onDragOver={(e) => e.preventDefault()} onDrop={onDrop}>
      <TitleBar />
      {ed.d && <OptionsBar />}
      <div className="main">
        {ed.d && <ToolRail />}
        <div className="center">
          <div className="stage">{ed.d ? <CanvasView /> : <Welcome />}</div>
          <CaptureStrip />
        </div>
        {ed.d && (
          <aside className="side">
            <ColorPanel />
            <LayersPanel />
          </aside>
        )}
      </div>
      {ed.d && <StatusBar />}
      <Dialogs />
      {ed.toast && (
        <div className={ed.toast.sticky ? 'toast sticky' : 'toast'} key={ed.toast.id} role="status">
          <span className="toast-text">{ed.toast.text}</span>
          <button className="toast-close" title="Dismiss" onClick={() => ed.dismissToast()}>
            <X size={14} />
          </button>
        </div>
      )}
    </div>
  )
}
