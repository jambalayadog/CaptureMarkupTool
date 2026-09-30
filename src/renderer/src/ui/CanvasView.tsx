import { useEffect, useRef, useState } from 'react'
import { decodeImage } from '../core/io'
import { useEditor } from './state'

export function CanvasView(): React.JSX.Element {
  const ed = useEditor()
  const wrap = useRef<HTMLDivElement>(null)
  const canvas = useRef<HTMLCanvasElement>(null)
  const [dropping, setDropping] = useState(false)

  useEffect(() => {
    const c = canvas.current!
    const w = wrap.current!
    ed.attach(c)
    let dprQuery: MediaQueryList | null = null
    const resize = (): void => {
      const r = w.getBoundingClientRect()
      ed.setViewport(r.width, r.height, window.devicePixelRatio || 1)
    }
    const watchDpr = (): void => {
      dprQuery?.removeEventListener('change', onDpr)
      dprQuery = window.matchMedia(`(resolution: ${window.devicePixelRatio}dppx)`)
      dprQuery.addEventListener('change', onDpr)
    }
    const onDpr = (): void => {
      resize()
      watchDpr()
    }
    watchDpr()
    const ro = new ResizeObserver(resize)
    ro.observe(w)
    resize()

    const down = (e: PointerEvent): void => ed.pointerDown(e)
    const move = (e: PointerEvent): void => ed.pointerMove(e)
    const up = (e: PointerEvent): void => ed.pointerUp(e)
    const leave = (): void => ed.pointerLeave()
    const wheel = (e: WheelEvent): void => ed.wheel(e)
    const dbl = (e: MouseEvent): void => ed.dblclick(e)
    const menu = (e: MouseEvent): void => e.preventDefault()
    // Stop the browser moving focus to <body> on mousedown: that would blur a text
    // box the text tool just opened. Blur other inputs so shortcuts work again.
    const mouseDown = (e: MouseEvent): void => {
      e.preventDefault()
      const a = document.activeElement
      if (a instanceof HTMLElement && a !== ed.textArea) a.blur()
    }
    c.addEventListener('mousedown', mouseDown)
    c.addEventListener('pointerdown', down)
    c.addEventListener('pointermove', move)
    c.addEventListener('pointerup', up)
    c.addEventListener('pointercancel', up)
    c.addEventListener('pointerleave', leave)
    c.addEventListener('wheel', wheel, { passive: false })
    c.addEventListener('dblclick', dbl)
    c.addEventListener('contextmenu', menu)
    return () => {
      ro.disconnect()
      dprQuery?.removeEventListener('change', onDpr)
      c.removeEventListener('mousedown', mouseDown)
      c.removeEventListener('pointerdown', down)
      c.removeEventListener('pointermove', move)
      c.removeEventListener('pointerup', up)
      c.removeEventListener('pointercancel', up)
      c.removeEventListener('pointerleave', leave)
      c.removeEventListener('wheel', wheel)
      c.removeEventListener('dblclick', dbl)
      c.removeEventListener('contextmenu', menu)
    }
  }, [ed])

  const onDrop = async (e: React.DragEvent): Promise<void> => {
    e.preventDefault()
    e.stopPropagation()
    setDropping(false)
    for (const f of Array.from(e.dataTransfer.files)) {
      const bytes = new Uint8Array(await f.arrayBuffer())
      if (f.name.toLowerCase().endsWith('.imk')) {
        await ed.openFiles([{ name: f.name, path: null, bytes }])
        continue
      }
      try {
        ed.pasteCanvas(await decodeImage(bytes), f.name.replace(/\.[a-z0-9]+$/i, ''))
      } catch {
        ed.warn(`Couldn't open ${f.name}`)
      }
    }
  }

  return (
    <div
      className="canvas-wrap"
      ref={wrap}
      onDragOver={(e) => {
        e.preventDefault()
        e.stopPropagation()
        if (!dropping) setDropping(true)
      }}
      onDragLeave={() => setDropping(false)}
      onDrop={onDrop}
    >
      <canvas ref={canvas} className="view" />
      {ed.textEdit && <TextEditor key={ed.textEdit.id} />}
      {dropping && (
        <div className="drop-hint">
          <div>Drop to add as a new layer</div>
          <small>Drop on the tab bar to open as a separate image</small>
        </div>
      )}
    </div>
  )
}

function TextEditor(): React.JSX.Element {
  const ed = useEditor()
  const ref = useRef<HTMLTextAreaElement>(null)
  const obj = ed.editingTextObj()

  useEffect(() => {
    const ta = ref.current!
    ed.textArea = ta
    ed.render()
    ta.focus()
    ta.setSelectionRange(ta.value.length, ta.value.length)
    return () => {
      if (ed.textArea === ta) ed.textArea = null
    }
  }, [ed])

  return (
    <textarea
      ref={ref}
      className="text-editor"
      defaultValue={obj?.text ?? ''}
      spellCheck={false}
      onInput={(e) => {
        const o = ed.editingTextObj()
        if (!o) return
        o.text = e.currentTarget.value
        ed.invalidate()
        ed.render()
      }}
      onKeyDown={(e) => {
        e.stopPropagation()
        if (e.key === 'Escape' || (e.key === 'Enter' && (e.ctrlKey || e.metaKey))) {
          e.preventDefault()
          ed.endTextEdit()
        }
      }}
      onBlur={() => ed.endTextEdit()}
    />
  )
}
