import { useCursor, useEditor } from './state'
import { TOOL_META } from './tools'

function CursorPos(): React.JSX.Element {
  const c = useCursor()
  return <span className="status-item mono">{c ? `${Math.floor(c.x)}, ${Math.floor(c.y)}` : '–'}</span>
}

export function StatusBar(): React.JSX.Element {
  const ed = useEditor()
  const d = ed.d!
  const sel = d.selection
  const layer = ed.activeLayer()
  return (
    <footer className="statusbar">
      <span className="status-hint">{TOOL_META[ed.tool].hint}</span>
      <div className="spacer" />
      {layer && <span className="status-item">{layer.name}</span>}
      {sel && (
        <span className="status-item mono">
          Selection {sel.w} × {sel.h}
        </span>
      )}
      <CursorPos />
      <span className="status-item mono">
        {d.width} × {d.height}
      </span>
      <button className="status-item zoom" title="Click to fit (Ctrl+0)" onClick={() => ed.fit()}>
        {Math.round(d.view.zoom * 1000) / 10}%
      </button>
    </footer>
  )
}
