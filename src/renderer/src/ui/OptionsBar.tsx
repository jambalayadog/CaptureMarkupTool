import {
  ArrowDownToLine,
  ArrowUpToLine,
  Bold,
  Copy,
  Maximize,
  Minus,
  Plus,
  Redo2,
  Save,
  Trash,
  Undo2
} from 'lucide-react'
import { FONTS, HIGHLIGHT_COLORS } from '../core/constants'
import type { Editor } from '../core/editor'
import { cropToSelection } from '../core/imageOps'
import type { Head, ToolOptions, VObj } from '../core/types'
import { applyCrop, resetCrop } from '../tools/region'
import { Divider, IconBtn, Num, Seg, Sel, Toggle } from './controls'
import { useEditor } from './state'
import { TOOL_META } from './tools'

const HEADS_START: { value: Head; label: string; title: string }[] = [
  { value: 'none', label: '—', title: 'No start cap' },
  { value: 'arrow', label: '◀', title: 'Arrow at start' },
  { value: 'dot', label: '●', title: 'Dot at start' }
]
const HEADS_END: { value: Head; label: string; title: string }[] = [
  { value: 'none', label: '—', title: 'No end cap' },
  { value: 'arrow', label: '▶', title: 'Arrow at end' },
  { value: 'dot', label: '●', title: 'Dot at end' }
]

/** Which option set describes an object (for editing a selection). */
function styleOf(o: VObj): string {
  switch (o.type) {
    case 'line':
      return o.start !== 'none' || o.end !== 'none' ? 'arrow' : 'line'
    case 'text':
      return o.tail ? 'callout' : 'text'
    case 'path':
      return 'highlight'
    default:
      return o.type
  }
}

function Swatch({ color }: { color: string }): React.JSX.Element {
  return <span className="mini-swatch" style={{ background: color }} />
}

function ToolOptionsFor({ ed, set }: { ed: Editor; set: string }): React.JSX.Element | null {
  const o = ed.opts
  const set_ = <K extends keyof ToolOptions>(k: K) => (v: ToolOptions[K]) => ed.setOpt(k, v)
  const shadow = <Toggle active={o.shadow} title="Drop shadow" onClick={() => ed.setOpt('shadow', !o.shadow)}>Shadow</Toggle>
  const dashed = <Toggle active={o.dashed} title="Dashed outline" onClick={() => ed.setOpt('dashed', !o.dashed)}>Dashed</Toggle>
  const width = <Num label="Width" value={o.strokeWidth} min={1} max={60} onChange={set_('strokeWidth')} />
  const font = (
    <>
      <Sel value={o.fontFamily} options={FONTS} onChange={set_('fontFamily')} title="Font" />
      <Num label="Size" value={o.fontSize} min={6} max={300} onChange={set_('fontSize')} />
      <Toggle active={o.bold} title="Bold" onClick={() => ed.setOpt('bold', !o.bold)}>
        <Bold size={14} />
      </Toggle>
    </>
  )
  switch (set) {
    case 'arrow':
      return (
        <>
          {width}
          <span className="opt-label">Start</span>
          <Seg value={o.arrowStart} options={HEADS_START} onChange={set_('arrowStart')} />
          <span className="opt-label">End</span>
          <Seg value={o.arrowEnd} options={HEADS_END} onChange={set_('arrowEnd')} />
          {dashed}
          {shadow}
        </>
      )
    case 'line':
      return (
        <>
          {width}
          {dashed}
          {shadow}
        </>
      )
    case 'rect':
    case 'ellipse':
      return (
        <>
          {width}
          <Toggle active={o.shapeFill} title="Fill with the secondary colour" onClick={() => ed.setOpt('shapeFill', !o.shapeFill)}>
            <Swatch color={ed.secondary} /> Fill
          </Toggle>
          {set === 'rect' && <Num label="Radius" value={o.cornerRadius} min={0} max={100} onChange={set_('cornerRadius')} />}
          {dashed}
          {shadow}
        </>
      )
    case 'text':
      return (
        <>
          {font}
          <Toggle active={o.textBg} title="Background box in the secondary colour" onClick={() => ed.setOpt('textBg', !o.textBg)}>
            <Swatch color={ed.secondary} /> Background
          </Toggle>
          {shadow}
        </>
      )
    case 'callout':
      return (
        <>
          {font}
          {shadow}
          <span className="opt-hint">Bubble uses the primary colour</span>
        </>
      )
    case 'step':
      return (
        <>
          <Num label="Size" value={o.stepSize} min={12} max={160} onChange={set_('stepSize')} />
          {shadow}
          <span className="opt-hint">Next number: {ed.nextStepNumber()}</span>
        </>
      )
    case 'highlight':
      return (
        <>
          <div className="swatch-row">
            {HIGHLIGHT_COLORS.map((c) => (
              <button
                key={c}
                className={ed.highlightColor === c ? 'hl-swatch on' : 'hl-swatch'}
                style={{ background: c }}
                title={c}
                onClick={() => {
                  ed.highlightColor = c
                  ed.updateSelected((obj) => obj.type === 'path' && (obj.color = c), 'Change colour', 'colour')
                  ed.emit()
                }}
              />
            ))}
          </div>
          <Num label="Width" value={o.highlightWidth} min={2} max={120} onChange={set_('highlightWidth')} />
        </>
      )
    case 'redact':
      return (
        <>
          <Seg
            value={o.redactMode}
            options={[
              { value: 'pixelate', label: 'Pixelate' },
              { value: 'blur', label: 'Blur' },
              { value: 'solid', label: 'Solid' }
            ]}
            onChange={set_('redactMode')}
          />
          {o.redactMode !== 'solid' && (
            <Num label={o.redactMode === 'pixelate' ? 'Block' : 'Radius'} value={o.redactStrength} min={2} max={48} onChange={set_('redactStrength')} />
          )}
          <span className="opt-hint">{o.redactMode === 'solid' ? 'Solid fully removes the content' : 'Solid is safest for secrets'}</span>
        </>
      )
    case 'brush':
      return (
        <>
          <Num label="Size" value={o.brushSize} min={1} max={300} onChange={set_('brushSize')} />
          <Num label="Opacity" value={Math.round(o.brushOpacity * 100)} min={1} max={100} suffix="%" onChange={(v) => ed.setOpt('brushOpacity', v / 100)} />
          <Toggle active={o.brushPressure} title="Pen pressure controls size" onClick={() => ed.setOpt('brushPressure', !o.brushPressure)}>
            Pressure
          </Toggle>
        </>
      )
    case 'pencil':
      return (
        <>
          <Num label="Size" value={o.pencilSize} min={1} max={64} onChange={set_('pencilSize')} />
          <Toggle active={o.pixelPerfect} title="Remove doubled corner pixels (size 1)" onClick={() => ed.setOpt('pixelPerfect', !o.pixelPerfect)}>
            Pixel-perfect
          </Toggle>
        </>
      )
    case 'eraser':
      return (
        <>
          <Num label="Size" value={o.eraserSize} min={1} max={300} onChange={set_('eraserSize')} />
          <Toggle active={o.eraserHard} title="Hard pixel edges" onClick={() => ed.setOpt('eraserHard', !o.eraserHard)}>
            Hard edge
          </Toggle>
        </>
      )
    case 'fill':
      return (
        <>
          <Num label="Tolerance" value={o.fillTolerance} min={0} max={255} onChange={set_('fillTolerance')} />
          <Toggle active={o.fillContiguous} title="Only fill connected pixels" onClick={() => ed.setOpt('fillContiguous', !o.fillContiguous)}>
            Contiguous
          </Toggle>
          <Toggle active={o.fillSampleMerged} title="Use all visible layers to find the area" onClick={() => ed.setOpt('fillSampleMerged', !o.fillSampleMerged)}>
            All layers
          </Toggle>
        </>
      )
    case 'eyedropper':
      return (
        <Toggle active={o.sampleMerged} title="Sample all visible layers" onClick={() => ed.setOpt('sampleMerged', !o.sampleMerged)}>
          All layers
        </Toggle>
      )
    case 'marquee': {
      const s = ed.d?.selection
      if (!s) return <span className="opt-hint">Drag to select an area of pixels</span>
      return (
        <>
          <span className="opt-value">
            {s.w} × {s.h} at {s.x}, {s.y}
          </span>
          <button className="btn" onClick={() => cropToSelection(ed)}>Crop to selection</button>
          <button className="btn" onClick={() => void ed.copy()}>Copy</button>
          <button className="btn" onClick={() => ed.fillSelection()}>Fill</button>
          <button className="btn" onClick={() => ed.clearSelectionPixels()}>Clear</button>
          <button className="btn" onClick={() => ed.deselect()}>Deselect</button>
        </>
      )
    }
    case 'crop': {
      const d = ed.d!
      const r = d.live.crop ?? { x: 0, y: 0, w: d.width, h: d.height }
      return (
        <>
          <span className="opt-value">
            {r.w} × {r.h}
          </span>
          <button className="btn primary" onClick={() => applyCrop(ed)}>
            Apply
          </button>
          <button className="btn" onClick={() => resetCrop(ed)}>Reset</button>
          <span className="opt-hint">Drag outside the image to add space</span>
        </>
      )
    }
    case 'hand':
    case 'zoom':
      return <ZoomControls ed={ed} />
    case 'multi':
      return <span className="opt-hint">{ed.d?.selectedIds.length} objects selected</span>
    case 'select':
      return <span className="opt-hint">{TOOL_META.select.hint}</span>
    default:
      return null
  }
}

export function ZoomControls({ ed }: { ed: Editor }): React.JSX.Element {
  return (
    <>
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
    </>
  )
}

export function OptionsBar(): React.JSX.Element {
  const ed = useEditor()
  const meta = TOOL_META[ed.tool]
  const sel = ed.selectedObjects()
  let set: string = ed.tool
  if (ed.tool === 'select' && sel.length) {
    const kinds = new Set(sel.map(styleOf))
    set = kinds.size === 1 ? [...kinds][0] : 'multi'
  }
  const h = ed.d?.history
  const Icon = meta.icon
  return (
    <div className="optionsbar">
      <div className="opt-tool">
        <Icon size={15} />
        <span>{meta.label}</span>
      </div>
      <Divider />
      <div className="opt-body">
        <ToolOptionsFor ed={ed} set={set} />
      </div>
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
