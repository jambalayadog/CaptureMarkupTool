export interface Vec {
  x: number
  y: number
}

export interface Rect {
  x: number
  y: number
  w: number
  h: number
}

import type { LayerEffects } from './effects'

export type BlendMode = GlobalCompositeOperation

interface LayerBase {
  id: string
  name: string
  visible: boolean
  /** 0..1 */
  opacity: number
  blend: BlendMode
  locked: boolean
  /** Drop shadow, glow and stroke (replace the object to change it). */
  effects?: LayerEffects
}

/** Pixel layer. Its canvas can be larger than the document and offset by (x, y). */
export interface RasterLayer extends LayerBase {
  kind: 'raster'
  canvas: HTMLCanvasElement
  x: number
  y: number
}

/** Editable annotation objects. */
export interface VectorLayer extends LayerBase {
  kind: 'vector'
  objects: VObj[]
}

export type Layer = RasterLayer | VectorLayer

// ---- vector objects -------------------------------------------------------

export type Head = 'none' | 'arrow' | 'dot'

export interface ShapeObj {
  id: string
  type: 'rect' | 'ellipse'
  x: number
  y: number
  w: number
  h: number
  stroke: string | null
  strokeWidth: number
  fill: string | null
  radius: number
  dashed: boolean
  shadow: boolean
}

export interface LineObj {
  id: string
  type: 'line'
  x1: number
  y1: number
  x2: number
  y2: number
  color: string
  width: number
  start: Head
  end: Head
  /** Arrowhead (or dot) size in px at each end, independent of the line width. */
  startSize: number
  endSize: number
  /** Points the line bends through, as a smooth curve; empty for a straight line. */
  via: Vec[]
  dashed: boolean
  shadow: boolean
}

export interface TextObj {
  id: string
  type: 'text'
  /** Top-left of the text box (including padding). */
  x: number
  y: number
  text: string
  fontSize: number
  fontFamily: string
  bold: boolean
  color: string
  /** Background box colour, or null for plain text. */
  bg: string | null
  /** Pointers from the box: bubble wedges, or arrows (always arrows when there's no background). */
  tails: Tail[]
  /** Draw the pointers as arrows rather than wedges of the bubble. */
  arrows: boolean
  /** Made by the callout tool: filled with the primary colour, the text in black or white. */
  callout: boolean
  shadow: boolean
  /** Fixed box width, which the text wraps to. null sizes the box to the text. */
  boxW: number | null
  /** Box height when it's taller than the text needs (it always grows to fit). */
  boxH: number | null
  align: TextAlign
  valign: TextVAlign
}

/** A callout pointer: its tip, and the spot in the box it comes from (fractions of the box; 0.5 is the middle). */
export interface Tail {
  x: number
  y: number
  ax: number
  ay: number
}

export type TextAlign = 'left' | 'center' | 'right'
export type TextVAlign = 'top' | 'middle' | 'bottom'

export interface StepObj {
  id: string
  type: 'step'
  /** Centre. */
  x: number
  y: number
  n: number
  size: number
  color: string
  /** Colour of the number; null picks black or white to stand out on the circle. */
  textColor: string | null
  shadow: boolean
}

export interface PathObj {
  id: string
  type: 'path'
  points: Vec[]
  color: string
  width: number
  opacity: number
  /** 'multiply' makes a highlighter that keeps dark text readable. */
  blend: 'source-over' | 'multiply'
}

export type RedactMode = 'pixelate' | 'blur' | 'solid'

export interface RedactObj {
  id: string
  type: 'redact'
  x: number
  y: number
  w: number
  h: number
  mode: RedactMode
  strength: number
  color: string
}

export type VObj = ShapeObj | LineObj | TextObj | StepObj | PathObj | RedactObj
export type VObjType = VObj['type']

// ---- editor ---------------------------------------------------------------

/**
 * A pixel selection. The rectangle is its bounds in document pixels; `mask`
 * (bounds-sized, alpha = selected) is null for plain rectangular selections.
 * Treat selections as immutable: replace, don't mutate.
 */
export interface Selection extends Rect {
  mask: HTMLCanvasElement | null
}

export type SelectMode = 'replace' | 'add' | 'subtract' | 'intersect'

/** An in-progress free transform of a raster layer (or of the selected pixels). */
export interface TransformState {
  layerId: string
  /** The pixels being transformed. */
  src: HTMLCanvasElement
  /** Layer pixels with the floating part cut out (selection transforms), aligned with the layer. */
  base: HTMLCanvasElement | null
  /** Centre, scale and rotation (radians) of `src` in document space. */
  cx: number
  cy: number
  sx: number
  sy: number
  angle: number
  /** Where `src` started (identity transform). */
  start: Rect
  /** Selection to carry along with the pixels. */
  selection: Selection | null
  smooth: boolean
}

export type ToolId =
  | 'select'
  | 'marquee'
  | 'lasso'
  | 'wand'
  | 'crop'
  | 'transform'
  | 'arrow'
  | 'line'
  | 'rect'
  | 'ellipse'
  | 'text'
  | 'callout'
  | 'step'
  | 'highlight'
  | 'redact'
  | 'brush'
  | 'pencil'
  | 'eraser'
  | 'fill'
  | 'eyedropper'
  | 'hand'
  | 'zoom'

export type FileKind = 'png' | 'jpg' | 'webp' | 'imk'

export interface ToolOptions {
  strokeWidth: number
  shapeFill: boolean
  cornerRadius: number
  dashed: boolean
  shadow: boolean
  arrowStart: Head
  arrowEnd: Head
  arrowStartSize: number
  arrowEndSize: number
  fontSize: number
  fontFamily: string
  bold: boolean
  textBg: boolean
  tailArrows: boolean
  textAlign: TextAlign
  textVAlign: TextVAlign
  stepSize: number
  stepSecondaryText: boolean
  highlightWidth: number
  highlightOpacity: number
  redactMode: RedactMode
  redactStrength: number
  brushSize: number
  brushOpacity: number
  brushPressure: boolean
  pencilSize: number
  pixelPerfect: boolean
  eraserSize: number
  eraserHard: boolean
  fillTolerance: number
  fillContiguous: boolean
  fillSampleMerged: boolean
  sampleMerged: boolean
  selectMode: SelectMode
  lassoAntiAlias: boolean
  wandTolerance: number
  wandContiguous: boolean
  wandSampleMerged: boolean
}

export interface ViewState {
  zoom: number
  panX: number
  panY: number
}

/** Transient render-only state (live strokes, previews). */
export interface LiveState {
  stroke: {
    layerId: string
    buffer: HTMLCanvasElement
    erase: boolean
    alpha: number
    /** Shaped selection the stroke is confined to. */
    mask: Selection | null
  } | null
  transform: TransformState | null
  editingTextId: string | null
  previewFilter: { layerId: string; filter: string } | null
  crop: Rect | null
  /** Rubber-band rectangle from the select tool. */
  band: Rect | null
  hoverId: string | null
}
