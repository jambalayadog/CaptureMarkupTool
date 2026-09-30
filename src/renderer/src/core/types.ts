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
}

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

export type ToolId =
  | 'select'
  | 'marquee'
  | 'crop'
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
  fontSize: number
  fontFamily: string
  bold: boolean
  textBg: boolean
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
  } | null
  editingTextId: string | null
  previewFilter: { layerId: string; filter: string } | null
  crop: Rect | null
  /** Rubber-band rectangle from the select tool. */
  band: Rect | null
  hoverId: string | null
}
