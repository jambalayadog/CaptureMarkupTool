import { ArrowDownToLine, ArrowUpToLine, Copy, Maximize, Minus, Plus, Redo2, Save, Trash, Undo2 } from 'lucide-react'
import { Divider, IconBtn } from './controls'
import { useEditor } from './state'

/** Above the canvas: zoom, arrange/delete for selected objects, undo/redo, copy and save. Tool options live in the ToolPanel. */
export function ActionBar(): React.JSX.Element {
  const ed = useEditor()
  const sel = ed.selectedObjects()
  const h = ed.d?.history
  return (
    <div className="actionbar">
      <IconBtn title="Zoom out (Ctrl+-)" onClick={() => ed.zoomStep(-1)}>
        <Minus size={14} />
      </IconBtn>
      <span className="opt-value zoom-value">{Math.round((ed.d?.view.zoom ?? 1) * 100)}%</span>
      <IconBtn title="Zoom in (Ctrl+=)" onClick={() => ed.zoomStep(1)}>
        <Plus size={14} />
      </IconBtn>
      <IconBtn title="Fit to window (Ctrl+0)" onClick={() => ed.fit()}>
        <Maximize size={14} />
      </IconBtn>
      <button className="btn" onClick={() => ed.setZoom(1)} title="Actual size (Ctrl+1)">
        1:1
      </button>
      <div className="spacer" />
      {sel.length > 0 && (
        <>
          <IconBtn title="Bring to front (Ctrl+Shift+])" onClick={() => ed.arrange('front')}>
            <ArrowUpToLine size={15} />
          </IconBtn>
          <IconBtn title="Send to back (Ctrl+Shift+[)" onClick={() => ed.arrange('back')}>
            <ArrowDownToLine size={15} />
          </IconBtn>
          <IconBtn title="Delete (Del)" onClick={() => ed.deleteSelection()}>
            <Trash size={15} />
          </IconBtn>
          <Divider />
        </>
      )}
      <IconBtn title={h?.canUndo ? `Undo ${h.entries[h.index - 1].label} (Ctrl+Z)` : 'Undo (Ctrl+Z)'} onClick={() => ed.undo()} disabled={!h?.canUndo}>
        <Undo2 size={15} />
      </IconBtn>
      <IconBtn title="Redo (Ctrl+Y)" onClick={() => ed.redo()} disabled={!h?.canRedo}>
        <Redo2 size={15} />
      </IconBtn>
      <Divider />
      <button className="btn" onClick={() => void ed.copyMerged()} title="Copy the finished image (Ctrl+Shift+C)">
        <Copy size={14} /> Copy
      </button>
      <button className="btn primary" onClick={() => void ed.save()} title="Save (Ctrl+S)">
        <Save size={14} /> Save
      </button>
    </div>
  )
}
