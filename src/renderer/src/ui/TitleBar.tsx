import { Camera, Check, X } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import type { Editor } from '../core/editor'
import { applyFilter, cropToSelection, flattenImage, mergeDown, rasterizeLayer, transformImage, trim } from '../core/imageOps'
import { api, isElectron, readClipboardImage } from '../core/platform'
import { decodeImage } from '../core/io'
import { startCapture } from './App'
import { useEditor } from './state'
import iconUrl from '../../../../resources/icon.png'

type Item = { label: string; shortcut?: string; action: () => void; disabled?: boolean; checked?: boolean } | 'sep'

async function pasteAsNew(ed: Editor): Promise<void> {
  const blob = await readClipboardImage()
  if (!blob) return ed.warn('No image on the clipboard')
  ed.openCanvas(await decodeImage(blob), 'Pasted image')
}

function buildMenus(ed: Editor): { name: string; items: Item[] }[] {
  const d = ed.d
  const none = !d
  const l = ed.activeLayer()
  const idx = d && l ? d.layers.indexOf(l) : -1
  const h = d?.history
  const undoLabel = h?.canUndo ? h.entries[h.index - 1].label : ''
  const redoLabel = h?.canRedo ? h.entries[h.index].label : ''
  const hasSel = !!d?.selectedIds.length
  return [
    {
      name: 'File',
      items: [
        { label: 'New capture', action: () => void startCapture() },
        { label: 'New image…', shortcut: 'Ctrl+N', action: () => ed.showDialog('new') },
        { label: 'Open…', shortcut: 'Ctrl+O', action: () => void ed.openFilesDialog() },
        { label: 'New image from clipboard', action: () => void pasteAsNew(ed) },
        'sep',
        { label: 'Save', shortcut: 'Ctrl+S', action: () => void ed.save(), disabled: none },
        { label: 'Save as…', shortcut: 'Ctrl+Shift+S', action: () => void ed.save(true), disabled: none },
        { label: 'Copy image to clipboard', shortcut: 'Ctrl+Shift+C', action: () => void ed.copyMerged(), disabled: none },
        'sep',
        { label: 'Close image', shortcut: 'Ctrl+W', action: () => d && ed.closeDoc(d.id), disabled: none },
        ...(isElectron
          ? (['sep', { label: 'Settings…', action: () => ed.showDialog('settings') }, { label: 'Quit', action: () => api?.quit() }] as Item[])
          : [])
      ]
    },
    {
      name: 'Edit',
      items: [
        { label: undoLabel ? `Undo ${undoLabel.toLowerCase()}` : 'Undo', shortcut: 'Ctrl+Z', action: () => ed.undo(), disabled: !h?.canUndo },
        { label: redoLabel ? `Redo ${redoLabel.toLowerCase()}` : 'Redo', shortcut: 'Ctrl+Y', action: () => ed.redo(), disabled: !h?.canRedo },
        'sep',
        { label: 'Cut', shortcut: 'Ctrl+X', action: () => void ed.copy(true), disabled: none },
        { label: 'Copy', shortcut: 'Ctrl+C', action: () => void ed.copy(), disabled: none },
        { label: 'Paste', shortcut: 'Ctrl+V', action: () => void ed.pasteFromClipboard() },
        { label: 'Duplicate', shortcut: 'Ctrl+J', action: () => (hasSel ? ed.duplicateSelected() : d && ed.duplicateLayer(d.activeLayerId)), disabled: none },
        { label: 'Delete', shortcut: 'Del', action: () => ed.deleteSelection(), disabled: none },
        'sep',
        { label: 'Free transform', shortcut: 'Ctrl+T', action: () => ed.setTool('transform'), disabled: l?.kind !== 'raster' },
        { label: 'Fill with primary color', action: () => ed.fillSelection(), disabled: none },
        'sep',
        { label: 'Bring to front', shortcut: 'Ctrl+Shift+]', action: () => ed.arrange('front'), disabled: !hasSel },
        { label: 'Bring forward', shortcut: 'Ctrl+]', action: () => ed.arrange('forward'), disabled: !hasSel },
        { label: 'Send backward', shortcut: 'Ctrl+[', action: () => ed.arrange('backward'), disabled: !hasSel },
        { label: 'Send to back', shortcut: 'Ctrl+Shift+[', action: () => ed.arrange('back'), disabled: !hasSel }
      ]
    },
    {
      name: 'Image',
      items: [
        { label: 'Resize image…', shortcut: 'Ctrl+Alt+I', action: () => ed.showDialog('resize'), disabled: none },
        { label: 'Canvas size…', shortcut: 'Ctrl+Alt+C', action: () => ed.showDialog('canvasSize'), disabled: none },
        { label: 'Crop to selection', action: () => cropToSelection(ed), disabled: !d?.selection },
        { label: 'Trim transparent edges', action: () => trim(ed), disabled: none },
        'sep',
        { label: 'Rotate 90° clockwise', action: () => transformImage(ed, 'cw'), disabled: none },
        { label: 'Rotate 90° counter-clockwise', action: () => transformImage(ed, 'ccw'), disabled: none },
        { label: 'Rotate 180°', action: () => transformImage(ed, '180'), disabled: none },
        { label: 'Flip horizontal', action: () => transformImage(ed, 'flipH'), disabled: none },
        { label: 'Flip vertical', action: () => transformImage(ed, 'flipV'), disabled: none },
        'sep',
        { label: 'Adjustments…', shortcut: 'Ctrl+U', action: () => ed.showDialog('adjust'), disabled: l?.kind !== 'raster' },
        { label: 'Grayscale', action: () => applyFilter(ed, 'grayscale(1)', 'Grayscale'), disabled: l?.kind !== 'raster' },
        { label: 'Invert colors', shortcut: 'Ctrl+I', action: () => applyFilter(ed, 'invert(1)', 'Invert'), disabled: l?.kind !== 'raster' },
        'sep',
        { label: 'Flatten image', action: () => flattenImage(ed), disabled: none || d.layers.length < 2 }
      ]
    },
    {
      name: 'Select',
      items: [
        { label: 'All', shortcut: 'Ctrl+A', action: () => ed.selectAll(), disabled: none },
        { label: 'Deselect', shortcut: 'Ctrl+D', action: () => ed.deselect(), disabled: none },
        { label: 'Invert selection', shortcut: 'Ctrl+Shift+I', action: () => ed.invertSelection(), disabled: none },
        'sep',
        { label: 'Rectangle select', shortcut: 'M', action: () => ed.setTool('marquee'), disabled: none },
        { label: 'Lasso', shortcut: 'Q', action: () => ed.setTool('lasso'), disabled: none },
        { label: 'Magic wand', shortcut: 'W', action: () => ed.setTool('wand'), disabled: none },
        'sep',
        { label: 'Crop to selection', action: () => cropToSelection(ed), disabled: !d?.selection }
      ]
    },
    {
      name: 'Layer',
      items: [
        { label: 'New pixel layer', shortcut: 'Ctrl+Shift+N', action: () => ed.addRasterLayer(), disabled: none },
        { label: 'New annotation layer', action: () => ed.addVectorLayer(), disabled: none },
        { label: 'Duplicate layer', action: () => d && ed.duplicateLayer(d.activeLayerId), disabled: none },
        { label: 'Delete layer', action: () => d && ed.deleteLayer(d.activeLayerId), disabled: none || d.layers.length < 2 },
        'sep',
        { label: 'Merge down', shortcut: 'Ctrl+E', action: () => d && mergeDown(ed, d.activeLayerId), disabled: idx < 1 },
        { label: 'Rasterize layer', action: () => d && rasterizeLayer(ed, d.activeLayerId), disabled: l?.kind !== 'vector' },
        'sep',
        { label: 'Move layer up', action: () => d && l && ed.moveLayer(l.id, idx + 1), disabled: none || idx >= d.layers.length - 1 },
        { label: 'Move layer down', action: () => d && l && ed.moveLayer(l.id, idx - 1), disabled: idx < 1 }
      ]
    },
    {
      name: 'View',
      items: [
        { label: 'Zoom in', shortcut: 'Ctrl+=', action: () => ed.zoomStep(1), disabled: none },
        { label: 'Zoom out', shortcut: 'Ctrl+-', action: () => ed.zoomStep(-1), disabled: none },
        { label: 'Fit to window', shortcut: 'Ctrl+0', action: () => ed.fit(), disabled: none },
        { label: 'Actual size', shortcut: 'Ctrl+1', action: () => ed.setZoom(1), disabled: none },
        'sep',
        {
          label: 'Pixel grid (800% and up)',
          shortcut: "Ctrl+'",
          checked: ed.showGrid,
          action: () => {
            ed.showGrid = !ed.showGrid
            ed.requestRender()
            ed.emit()
          }
        }
      ]
    },
    {
      name: 'Help',
      items: [
        { label: 'Keyboard shortcuts', shortcut: 'F1', action: () => ed.showDialog('shortcuts') },
        'sep',
        { label: 'About Capture Markup Tool', action: () => ed.showDialog('about') }
      ]
    }
  ]
}

function MenuBar(): React.JSX.Element {
  const ed = useEditor()
  const [open, setOpen] = useState<string | null>(null)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const close = (e: MouseEvent): void => {
      if (!ref.current?.contains(e.target as Node)) setOpen(null)
    }
    const key = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') setOpen(null)
    }
    window.addEventListener('mousedown', close)
    window.addEventListener('keydown', key)
    return () => {
      window.removeEventListener('mousedown', close)
      window.removeEventListener('keydown', key)
    }
  }, [open])

  return (
    <div className="menubar" ref={ref}>
      {buildMenus(ed).map((m) => (
        <div className="menu-root" key={m.name}>
          <button
            className={open === m.name ? 'menu-btn open' : 'menu-btn'}
            onMouseDown={() => setOpen(open === m.name ? null : m.name)}
            onMouseEnter={() => open && setOpen(m.name)}
          >
            {m.name}
          </button>
          {open === m.name && (
            <div className="menu-drop">
              {m.items.map((it, i) =>
                it === 'sep' ? (
                  <div className="menu-sep" key={i} />
                ) : (
                  <button
                    key={i}
                    className="menu-item"
                    disabled={it.disabled}
                    onClick={() => {
                      setOpen(null)
                      it.action()
                    }}
                  >
                    <span className="menu-check">{it.checked && <Check size={13} />}</span>
                    <span className="menu-label">{it.label}</span>
                    {it.shortcut && <span className="menu-shortcut">{it.shortcut}</span>}
                  </button>
                )
              )}
            </div>
          )}
        </div>
      ))}
    </div>
  )
}

export function TitleBar(): React.JSX.Element {
  const ed = useEditor()
  return (
    <header className="titlebar">
      <img className="logo" src={iconUrl} alt="" />
      <MenuBar />
      <div className="tabs">
        {ed.docs.map((d) => (
          <div
            key={d.id}
            className={d === ed.d ? 'tab active' : 'tab'}
            title={d.filePath ?? d.name}
            onMouseDown={(e) => {
              if (e.button === 1) {
                e.preventDefault()
                ed.closeDoc(d.id)
              } else if (e.button === 0) ed.activate(d.id)
            }}
          >
            <span className="tab-name">{d.name}</span>
            {d.history.dirty && <span className="tab-dirty" />}
            <button
              className="tab-close"
              title="Close (Ctrl+W)"
              onMouseDown={(e) => e.stopPropagation()}
              onClick={() => ed.closeDoc(d.id)}
            >
              <X size={12} />
            </button>
          </div>
        ))}
      </div>
      <button className="capture-btn" onClick={() => void startCapture()} title="New capture">
        <Camera size={15} />
        <span>Capture</span>
      </button>
    </header>
  )
}
