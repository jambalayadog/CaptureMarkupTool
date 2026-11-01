import {
  AlignVerticalJustifyCenter,
  AlignVerticalJustifyEnd,
  AlignVerticalJustifyStart,
  ArrowLeftRight,
  ArrowUpDown,
  Bold,
  ChevronsLeft,
  ChevronsRight,
  ListRestart,
  RotateCw,
  Square,
  SquaresIntersect,
  SquaresSubtract,
  SquaresUnite,
  TextAlignCenter,
  TextAlignEnd,
  TextAlignStart
} from 'lucide-react'
import { useState } from 'react'
import { FONTS, HIGHLIGHT_COLORS } from '../core/constants'
import type { Editor } from '../core/editor'
import { cropToSelection } from '../core/imageOps'
import { describeObject } from '../core/objects'
import type { Head, SelectMode, StepObj, TextAlign, TextVAlign, ToolOptions, VObj } from '../core/types'
import { applyCrop, resetCrop } from '../tools/region'
import { adjustTransform, finishTransform } from '../tools/transform'
import { IconBtn, Num, Seg, Sel, Toggle } from './controls'
import { useEditor } from './state'
import { TOOL_META } from './tools'

const COLLAPSED_KEY = 'cmt.toolPanelCollapsed'

function loadCollapsed(): boolean {
  try {
    return localStorage.getItem(COLLAPSED_KEY) === '1'
  } catch {
    return false
  }
}

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
    case 'path':
      return 'highlight'
    default:
      return o.type
  }
}

const ALIGNS: { value: TextAlign; label: React.ReactNode; title: string }[] = [
  { value: 'left', label: <TextAlignStart size={14} />, title: 'Align left' },
  { value: 'center', label: <TextAlignCenter size={14} />, title: 'Centre' },
  { value: 'right', label: <TextAlignEnd size={14} />, title: 'Align right' }
]

const VALIGNS: { value: TextVAlign; label: React.ReactNode; title: string }[] = [
  { value: 'top', label: <AlignVerticalJustifyStart size={14} />, title: 'Top (when the box is taller than the text)' },
  { value: 'middle', label: <AlignVerticalJustifyCenter size={14} />, title: 'Middle (when the box is taller than the text)' },
  { value: 'bottom', label: <AlignVerticalJustifyEnd size={14} />, title: 'Bottom (when the box is taller than the text)' }
]

const SELECT_MODES: { value: SelectMode; label: React.ReactNode; title: string }[] = [
  { value: 'replace', label: <Square size={13} />, title: 'New selection' },
  { value: 'add', label: <SquaresUnite size={14} />, title: 'Add to selection (hold Shift)' },
  { value: 'subtract', label: <SquaresSubtract size={14} />, title: 'Subtract from selection (hold Alt)' },
  { value: 'intersect', label: <SquaresIntersect size={14} />, title: 'Intersect with selection (hold Shift+Alt)' }
]

// ---- layout ------------------------------------------------------------------------------

/** A group of options under a small heading. */
function Section({ title, children }: { title?: string; children: React.ReactNode }): React.JSX.Element {
  return (
    <section className="tp-section">
      {title && <h3 className="tp-title">{title}</h3>}
      {children}
    </section>
  )
}

/** Controls side by side, wrapping when they don't fit. */
const Row = ({ children }: { children: React.ReactNode }): React.JSX.Element => <div className="tp-row">{children}</div>

const Hint = ({ children }: { children: React.ReactNode }): React.JSX.Element => <p className="tp-hint">{children}</p>

function Swatch({ color }: { color: string }): React.JSX.Element {
  return <span className="mini-swatch" style={{ background: color }} />
}

// ---- option sets ---------------------------------------------------------------------------

function ToolOptionsFor({ ed, set }: { ed: Editor; set: string }): React.JSX.Element | null {
  const o = ed.opts
  const set_ = <K extends keyof ToolOptions>(k: K) => (v: ToolOptions[K]) => ed.setOpt(k, v)
  const shadow = <Toggle active={o.shadow} title="Drop shadow" onClick={() => ed.setOpt('shadow', !o.shadow)}>Shadow</Toggle>
  const dashed = <Toggle active={o.dashed} title="Dashed outline" onClick={() => ed.setOpt('dashed', !o.dashed)}>Dashed</Toggle>
  const width = <Num label="Width" value={o.strokeWidth} min={1} max={60} onChange={set_('strokeWidth')} />
  const headSize = (k: 'arrowStartSize' | 'arrowEndSize', end: string): React.JSX.Element => (
    <Num label="Head size" value={o[k]} min={4} max={200} title={`${end} head size in px (separate from the line width)`} onChange={set_(k)} />
  )
  const bent = ed.selectedObjects().some((s) => s.type === 'line' && s.via?.length)
  const straighten = bent ? (
    <Row>
      <button
        className="btn"
        title="Remove every bend (or double-click one bend point to remove it)"
        onClick={() => ed.updateSelected((s) => s.type === 'line' && (s.via = []), 'Straighten')}
      >
        Straighten
      </button>
    </Row>
  ) : (
    <Hint>Drag a + beside the line to bend it; double-click a bend to remove it.</Hint>
  )
  switch (set) {
    case 'arrow':
      return (
        <>
          <Section title="Line">
            {width}
            <Row>
              {dashed}
              {shadow}
            </Row>
          </Section>
          <Section title="Start">
            <Seg value={o.arrowStart} options={HEADS_START} onChange={set_('arrowStart')} />
            {o.arrowStart !== 'none' && headSize('arrowStartSize', 'Start')}
          </Section>
          <Section title="End">
            <Seg value={o.arrowEnd} options={HEADS_END} onChange={set_('arrowEnd')} />
            {o.arrowEnd !== 'none' && headSize('arrowEndSize', 'End')}
          </Section>
          {straighten}
        </>
      )
    case 'line':
      return (
        <>
          <Section title="Line">
            {width}
            <Row>
              {dashed}
              {shadow}
            </Row>
          </Section>
          {straighten}
        </>
      )
    case 'rect':
    case 'ellipse':
      return (
        <Section title="Shape">
          {width}
          {set === 'rect' && <Num label="Corner radius" value={o.cornerRadius} min={0} max={100} onChange={set_('cornerRadius')} />}
          <Row>
            <Toggle active={o.shapeFill} title="Fill with the secondary colour" onClick={() => ed.setOpt('shapeFill', !o.shapeFill)}>
              <Swatch color={ed.secondary} /> Fill
            </Toggle>
            {dashed}
            {shadow}
          </Row>
        </Section>
      )
    case 'text':
      return <TextOptions ed={ed} />
    case 'step':
      return <StepOptions ed={ed} />
    case 'highlight':
      return (
        <Section title="Highlighter">
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
        </Section>
      )
    case 'redact':
      return (
        <>
          <Section title="Redaction">
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
              <Num label={o.redactMode === 'pixelate' ? 'Block size' : 'Radius'} value={o.redactStrength} min={2} max={48} onChange={set_('redactStrength')} />
            )}
          </Section>
          <Hint>{o.redactMode === 'solid' ? 'Solid fully removes the content.' : 'Solid is safest for secrets: pixelation and blur can sometimes be reversed.'}</Hint>
        </>
      )
    case 'brush':
      return (
        <Section title="Brush">
          <Num label="Size" value={o.brushSize} min={1} max={300} onChange={set_('brushSize')} />
          <Num label="Opacity" value={Math.round(o.brushOpacity * 100)} min={1} max={100} suffix="%" onChange={(v) => ed.setOpt('brushOpacity', v / 100)} />
          <Row>
            <Toggle active={o.brushPressure} title="Pen pressure controls size" onClick={() => ed.setOpt('brushPressure', !o.brushPressure)}>
              Pressure
            </Toggle>
          </Row>
        </Section>
      )
    case 'pencil':
      return (
        <Section title="Pencil">
          <Num label="Size" value={o.pencilSize} min={1} max={64} onChange={set_('pencilSize')} />
          <Row>
            <Toggle active={o.pixelPerfect} title="Remove doubled corner pixels (size 1)" onClick={() => ed.setOpt('pixelPerfect', !o.pixelPerfect)}>
              Pixel-perfect
            </Toggle>
          </Row>
        </Section>
      )
    case 'eraser':
      return (
        <Section title="Eraser">
          <Num label="Size" value={o.eraserSize} min={1} max={300} onChange={set_('eraserSize')} />
          <Row>
            <Toggle active={o.eraserHard} title="Hard pixel edges" onClick={() => ed.setOpt('eraserHard', !o.eraserHard)}>
              Hard edge
            </Toggle>
          </Row>
        </Section>
      )
    case 'fill':
      return (
        <Section title="Fill">
          <Num label="Tolerance" value={o.fillTolerance} min={0} max={255} onChange={set_('fillTolerance')} />
          <Row>
            <Toggle active={o.fillContiguous} title="Only fill connected pixels" onClick={() => ed.setOpt('fillContiguous', !o.fillContiguous)}>
              Contiguous
            </Toggle>
            <Toggle active={o.fillSampleMerged} title="Use all visible layers to find the area" onClick={() => ed.setOpt('fillSampleMerged', !o.fillSampleMerged)}>
              All layers
            </Toggle>
          </Row>
        </Section>
      )
    case 'eyedropper':
      return (
        <Section title="Sample">
          <Row>
            <Toggle active={o.sampleMerged} title="Sample all visible layers" onClick={() => ed.setOpt('sampleMerged', !o.sampleMerged)}>
              All layers
            </Toggle>
          </Row>
        </Section>
      )
    case 'marquee':
    case 'lasso':
    case 'wand':
      return <SelectionOptions ed={ed} tool={set} />
    case 'transform':
      return <TransformOptions ed={ed} />
    case 'crop': {
      const d = ed.d!
      const r = d.live.crop ?? { x: 0, y: 0, w: d.width, h: d.height }
      return (
        <>
          <Section title="Crop">
            <span className="tp-value">
              {r.w} × {r.h}
            </span>
            <Row>
              <button className="btn primary" onClick={() => applyCrop(ed)}>
                Apply
              </button>
              <button className="btn" onClick={() => resetCrop(ed)}>
                Reset
              </button>
            </Row>
          </Section>
          <Hint>Drag outside the image to add space.</Hint>
        </>
      )
    }
    case 'multi':
      return <Hint>Drag to move them together. The arrange and delete buttons above the canvas act on all of them.</Hint>
    default:
      return <Hint>{TOOL_META[ed.tool].hint}</Hint>
  }
}

function TextOptions({ ed }: { ed: Editor }): React.JSX.Element {
  const o = ed.opts
  const sized = ed.selectedObjects().some((t) => t.type === 'text' && (t.boxW != null || t.boxH != null))
  return (
    <>
      <Section title="Font">
        <Sel value={o.fontFamily} options={FONTS} onChange={(v) => ed.setOpt('fontFamily', v)} title="Font" />
        <Num label="Size" value={o.fontSize} min={6} max={300} onChange={(v) => ed.setOpt('fontSize', v)} />
        <Row>
          <Toggle active={o.bold} title="Bold" onClick={() => ed.setOpt('bold', !o.bold)}>
            <Bold size={14} /> Bold
          </Toggle>
          <Toggle active={o.shadow} title="Drop shadow" onClick={() => ed.setOpt('shadow', !o.shadow)}>
            Shadow
          </Toggle>
        </Row>
      </Section>
      <Section title="Box">
        <Row>
          <Toggle active={o.textBg} title="Box behind the text in the secondary colour (off: transparent)" onClick={() => ed.setOpt('textBg', !o.textBg)}>
            <Swatch color={ed.secondary} /> Background
          </Toggle>
        </Row>
        <Seg value={o.textAlign} options={ALIGNS} onChange={(v) => ed.setOpt('textAlign', v)} />
        <Seg value={o.textVAlign} options={VALIGNS} onChange={(v) => ed.setOpt('textVAlign', v)} />
        {sized && (
          <Row>
            <button
              className="btn"
              title="Size the box to fit the text again"
              onClick={() => ed.updateSelected((t) => t.type === 'text' && Object.assign(t, { boxW: null, boxH: null }), 'Fit text box')}
            >
              Fit to text
            </button>
          </Row>
        )}
      </Section>
      <Section title="Pointers">
        {/* without a background, pointers are always arrows */}
        {o.textBg && (
          <Row>
            <Toggle active={o.tailArrows} title="Draw pointers as arrows instead of wedges of the bubble" onClick={() => ed.setOpt('tailArrows', !o.tailArrows)}>
              Arrows
            </Toggle>
          </Row>
        )}
        <Num label="Width" value={o.tailWidth} min={1} max={40} title="Pointer width: an arrow's line, or the base of a wedge" onChange={(v) => ed.setOpt('tailWidth', v)} />
      </Section>
      <Hint>Drag a box&apos;s + to add a pointer; drag a tip back into the box to remove it. Drag a box to move it.</Hint>
    </>
  )
}

function StepOptions({ ed }: { ed: Editor }): React.JSX.Element {
  const o = ed.opts
  const steps = ed.selectedObjects().filter((s): s is StepObj => s.type === 'step')
  return (
    <>
      <Section title="Step">
        <Num label="Size" value={o.stepSize} min={12} max={160} onChange={(v) => ed.setOpt('stepSize', v)} />
        <Row>
          <Toggle
            active={o.stepSecondaryText}
            title="Draw the number in the secondary colour instead of black or white"
            onClick={() => ed.setOpt('stepSecondaryText', !o.stepSecondaryText)}
          >
            <Swatch color={ed.secondary} /> Use secondary for #
          </Toggle>
          <Toggle active={o.shadow} title="Drop shadow" onClick={() => ed.setOpt('shadow', !o.shadow)}>
            Shadow
          </Toggle>
        </Row>
      </Section>
      {(steps.length === 1 || ed.tool === 'step') && (
        <Section title="Numbering">
          {steps.length === 1 && (
            <Num
              label="This step"
              value={steps[0].n}
              min={0}
              max={999}
              slider={false}
              title="Number on the selected step"
              onChange={(v) => ed.updateSelected((s) => s.type === 'step' && (s.n = Math.round(v)), 'Renumber step', 'step-n')}
            />
          )}
          {ed.tool === 'step' && (
            <div className="tp-inline">
              <Num label="Next" value={ed.nextStepNumber()} min={0} max={999} slider={false} title="Number the next step you place gets" onChange={(v) => ed.setStepNext(v)} />
              <IconBtn title="Restart numbering at 1" onClick={() => ed.setStepNext(1)}>
                <ListRestart size={15} />
              </IconBtn>
            </div>
          )}
        </Section>
      )}
    </>
  )
}

function SelectionOptions({ ed, tool }: { ed: Editor; tool: string }): React.JSX.Element {
  const o = ed.opts
  const s = ed.d?.selection
  return (
    <>
      <Section title="Mode">
        <Seg value={o.selectMode} options={SELECT_MODES} onChange={(v) => ed.setOpt('selectMode', v)} />
        {tool === 'lasso' && (
          <Row>
            <Toggle active={o.lassoAntiAlias} title="Smooth selection edges (off for hard pixel edges)" onClick={() => ed.setOpt('lassoAntiAlias', !o.lassoAntiAlias)}>
              Anti-alias
            </Toggle>
          </Row>
        )}
        {tool === 'wand' && (
          <>
            <Num label="Tolerance" value={o.wandTolerance} min={0} max={255} onChange={(v) => ed.setOpt('wandTolerance', v)} />
            <Row>
              <Toggle active={o.wandContiguous} title="Only connected pixels" onClick={() => ed.setOpt('wandContiguous', !o.wandContiguous)}>
                Contiguous
              </Toggle>
              <Toggle active={o.wandSampleMerged} title="Use all visible layers" onClick={() => ed.setOpt('wandSampleMerged', !o.wandSampleMerged)}>
                All layers
              </Toggle>
            </Row>
          </>
        )}
      </Section>
      {s ? (
        <Section title="Selection">
          <span className="tp-value">
            {s.w} × {s.h}
          </span>
          <Row>
            <button className="btn" onClick={() => ed.setTool('transform')} title="Free transform the selected pixels (Ctrl+T)">
              Transform
            </button>
            <button className="btn" onClick={() => cropToSelection(ed)}>
              Crop
            </button>
            <button className="btn" onClick={() => ed.fillSelection()}>
              Fill
            </button>
            <button className="btn" onClick={() => ed.clearSelectionPixels()}>
              Clear
            </button>
            <button className="btn" onClick={() => ed.invertSelection()} title="Invert selection (Ctrl+Shift+I)">
              Invert
            </button>
            <button className="btn" onClick={() => ed.deselect()} title="Deselect (Ctrl+D)">
              Deselect
            </button>
          </Row>
        </Section>
      ) : (
        <Hint>{TOOL_META[tool as keyof typeof TOOL_META].hint}</Hint>
      )}
    </>
  )
}

function TransformOptions({ ed }: { ed: Editor }): React.JSX.Element {
  const t = ed.d?.live.transform
  if (!t) return <Hint>Pick a pixel layer (or select some pixels), then press Ctrl+T.</Hint>
  const pct = (s: number): number => Math.round(Math.abs(s) * 1000) / 10
  let deg = ((t.angle * 180) / Math.PI) % 360
  if (deg > 180) deg -= 360
  if (deg <= -180) deg += 360
  return (
    <>
      <Section title="Size & angle">
        <Num label="Width" value={pct(t.sx)} min={1} max={10000} slider={false} suffix="%" onChange={(v) => adjustTransform(ed, { sx: (Math.sign(t.sx) || 1) * (v / 100) })} />
        <Num label="Height" value={pct(t.sy)} min={1} max={10000} slider={false} suffix="%" onChange={(v) => adjustTransform(ed, { sy: (Math.sign(t.sy) || 1) * (v / 100) })} />
        <Num label="Angle" value={Math.round(deg * 10) / 10} min={-180} max={180} slider={false} suffix="°" onChange={(v) => adjustTransform(ed, { angle: (v * Math.PI) / 180 })} />
        <Row>
          <IconBtn title="Flip horizontally" onClick={() => adjustTransform(ed, { sx: -t.sx })}>
            <ArrowLeftRight size={15} />
          </IconBtn>
          <IconBtn title="Flip vertically" onClick={() => adjustTransform(ed, { sy: -t.sy })}>
            <ArrowUpDown size={15} />
          </IconBtn>
          <IconBtn title="Rotate 90° clockwise" onClick={() => adjustTransform(ed, { angle: t.angle + Math.PI / 2 })}>
            <RotateCw size={15} />
          </IconBtn>
          <Toggle active={t.smooth} title="Smooth resampling (turn off to keep hard pixels)" onClick={() => adjustTransform(ed, { smooth: !t.smooth })}>
            Smooth
          </Toggle>
        </Row>
      </Section>
      <Row>
        <button className="btn primary" onClick={() => finishTransform(ed, true)}>
          Apply
        </button>
        <button className="btn" onClick={() => finishTransform(ed, false)}>
          Cancel
        </button>
      </Row>
    </>
  )
}

// ---- the panel -------------------------------------------------------------------------------

/** The current tool's options, in a column beside the tool rail. It folds away to a thin strip. */
export function ToolPanel(): React.JSX.Element {
  const ed = useEditor()
  const [collapsed, setCollapsed] = useState(loadCollapsed)
  const toggle = (): void => {
    setCollapsed(!collapsed)
    try {
      localStorage.setItem(COLLAPSED_KEY, collapsed ? '0' : '1')
    } catch {
      // storage unavailable: it just won't be remembered
    }
  }
  const meta = TOOL_META[ed.tool]
  const Icon = meta.icon
  if (collapsed) {
    return (
      <aside className="tool-panel collapsed">
        <button className="tp-expand" title="Show tool options" onClick={toggle}>
          <ChevronsRight size={14} />
          <Icon size={16} />
        </button>
      </aside>
    )
  }
  const sel = ed.selectedObjects()
  let set: string = ed.tool
  if (ed.tool === 'select' && sel.length) {
    const kinds = new Set(sel.map(styleOf))
    set = kinds.size === 1 ? [...kinds][0] : 'multi'
  }
  return (
    <aside className="tool-panel">
      <div className="tp-head">
        <Icon size={15} />
        <span className="tp-name">{meta.label}</span>
        <IconBtn className="small" title="Hide tool options" onClick={toggle}>
          <ChevronsLeft size={14} />
        </IconBtn>
      </div>
      {ed.tool === 'select' && sel.length > 0 && <div className="tp-subject">{sel.length === 1 ? describeObject(sel[0]) : `${sel.length} objects`}</div>}
      <div className="tp-body">
        <ToolOptionsFor ed={ed} set={set} />
      </div>
    </aside>
  )
}
