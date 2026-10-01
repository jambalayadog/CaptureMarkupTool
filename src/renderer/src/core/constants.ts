import type { BlendMode, ToolId, ToolOptions } from './types'

export const FONTS = [
  { label: 'Segoe UI', value: '"Segoe UI", system-ui, sans-serif' },
  { label: 'Arial', value: 'Arial, Helvetica, sans-serif' },
  { label: 'Georgia', value: 'Georgia, "Times New Roman", serif' },
  { label: 'Consolas', value: 'Consolas, "Courier New", monospace' },
  { label: 'Comic Sans', value: '"Comic Sans MS", "Comic Neue", cursive' },
  { label: 'Impact', value: 'Impact, "Arial Black", sans-serif' },
  { label: 'Segoe Print', value: '"Segoe Print", "Bradley Hand", cursive' }
]

export const DEFAULT_OPTIONS: ToolOptions = {
  strokeWidth: 4,
  shapeFill: false,
  cornerRadius: 4,
  dashed: false,
  shadow: true,
  arrowStart: 'none',
  arrowEnd: 'arrow',
  arrowHeadScale: 1,
  fontSize: 28,
  fontFamily: FONTS[0].value,
  bold: true,
  textBg: false,
  textAlign: 'left',
  textVAlign: 'top',
  stepSize: 30,
  highlightWidth: 22,
  highlightOpacity: 1,
  redactMode: 'pixelate',
  redactStrength: 10,
  brushSize: 8,
  brushOpacity: 1,
  brushPressure: true,
  pencilSize: 1,
  pixelPerfect: true,
  eraserSize: 24,
  eraserHard: false,
  fillTolerance: 24,
  fillContiguous: true,
  fillSampleMerged: false,
  sampleMerged: true,
  selectMode: 'replace',
  lassoAntiAlias: true,
  wandTolerance: 32,
  wandContiguous: true,
  wandSampleMerged: true
}

export const HIGHLIGHT_COLORS = ['#ffe14d', '#8cf27a', '#ff8fd8', '#7fd8ff', '#ffb34d']

export const BLEND_MODES: { value: BlendMode; label: string }[] = [
  { value: 'source-over', label: 'Normal' },
  { value: 'multiply', label: 'Multiply' },
  { value: 'screen', label: 'Screen' },
  { value: 'overlay', label: 'Overlay' },
  { value: 'darken', label: 'Darken' },
  { value: 'lighten', label: 'Lighten' },
  { value: 'color-dodge', label: 'Color dodge' },
  { value: 'color-burn', label: 'Color burn' },
  { value: 'hard-light', label: 'Hard light' },
  { value: 'soft-light', label: 'Soft light' },
  { value: 'difference', label: 'Difference' },
  { value: 'exclusion', label: 'Exclusion' },
  { value: 'hue', label: 'Hue' },
  { value: 'saturation', label: 'Saturation' },
  { value: 'color', label: 'Color' },
  { value: 'luminosity', label: 'Luminosity' }
]

export const PALETTES: Record<string, string[]> = {
  Default: [
    '#ff3b30', '#ff9500', '#ffcc00', '#34c759', '#00c7be', '#007aff', '#5856d6', '#af52de',
    '#ff2d55', '#a2845e', '#ffffff', '#c7c7cc', '#8e8e93', '#48484a', '#1c1c1e', '#000000'
  ],
  'PICO-8': [
    '#000000', '#1d2b53', '#7e2553', '#008751', '#ab5236', '#5f574f', '#c2c3c7', '#fff1e8',
    '#ff004d', '#ffa300', '#ffec27', '#00e436', '#29adff', '#83769c', '#ff77a8', '#ffccaa'
  ],
  'Endesga 32': [
    '#be4a2f', '#d77643', '#ead4aa', '#e4a672', '#b86f50', '#733e39', '#3e2731', '#a22633',
    '#e43b44', '#f77622', '#feae34', '#fee761', '#63c74d', '#3e8948', '#265c42', '#193c3e',
    '#124e89', '#0099db', '#2ce8f5', '#ffffff', '#c0cbdc', '#8b9bb4', '#5a6988', '#3a4466',
    '#262b44', '#181425', '#ff0044', '#68386c', '#b55088', '#f6757a', '#e8b796', '#c28569'
  ],
  Grayscale: [
    '#000000', '#111111', '#222222', '#333333', '#444444', '#555555', '#666666', '#777777',
    '#888888', '#999999', '#aaaaaa', '#bbbbbb', '#cccccc', '#dddddd', '#eeeeee', '#ffffff'
  ]
}

export const TOOL_KEYS: Partial<Record<string, ToolId>> = {
  v: 'select',
  m: 'marquee',
  q: 'lasso',
  w: 'wand',
  c: 'crop',
  a: 'arrow',
  l: 'line',
  r: 'rect',
  o: 'ellipse',
  t: 'text',
  k: 'callout',
  n: 'step',
  h: 'highlight',
  u: 'redact',
  b: 'brush',
  p: 'pencil',
  e: 'eraser',
  g: 'fill',
  i: 'eyedropper',
  z: 'zoom'
}

export const ZOOM_STEPS = [
  0.05, 0.0833, 0.125, 0.1667, 0.25, 0.3333, 0.5, 0.6667, 0.75, 1, 1.5, 2, 3, 4, 6, 8, 12, 16, 24, 32, 48, 64
]

export const VECTOR_TOOLS: ToolId[] = ['arrow', 'line', 'rect', 'ellipse', 'text', 'callout', 'step', 'highlight', 'redact']
export const PAINT_TOOLS: ToolId[] = ['brush', 'pencil', 'eraser', 'fill']
export const SELECT_TOOLS: ToolId[] = ['marquee', 'lasso', 'wand']

export const ACCENT = '#5b8cff'
