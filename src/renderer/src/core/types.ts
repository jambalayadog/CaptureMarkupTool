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

export type BlendMode = GlobalCompositeOperation

interface LayerBase {
  id: string
  name: string
  visible: boolean
  /** 0..1 */
  opacity: number
  blend: BlendMode
  locked: boolean
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
  /** Arrowhead and dot size relative to the default for this width (1 = 100%). */
  headScale: number
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
  /** Speech-bubble pointer target (only drawn when bg is set). */
  tail: Vec | null
  shadow: boolean
  /** Fixed box width, which the text wraps to. null sizes the box to the text. */
  boxW: number | null
  /** Box height when it's taller than the text needs (it always grows to fit). */
  boxH: number | null
  align: TextAlign
  valign: TextVAlign
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
  arrowHeadScale: number
  fontSize: number
  fontFamily: string
  bold: boolean
  textBg: boolean
  textAlign: TextAlign
  textVAlign: TextVAlign
  stepSize: number
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
