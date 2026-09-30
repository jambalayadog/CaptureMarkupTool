import type { ToolId } from '../core/types'
import { brushTool, eraserTool, eyedropperTool, fillTool, pencilTool } from './paint'
import { cropTool, handTool, zoomTool } from './region'
import { selectTool } from './select'
import { lassoTool, marqueeTool, wandTool } from './selection'
import { transformTool } from './transform'
import { arrowTool, ellipseTool, highlightTool, lineTool, rectTool, redactTool } from './shapes'
import { calloutTool, stepTool, textTool } from './text'
import type { Tool } from './types'

export const TOOLS: Record<ToolId, Tool> = {
  select: selectTool,
  marquee: marqueeTool,
  lasso: lassoTool,
  wand: wandTool,
  crop: cropTool,
  transform: transformTool,
  arrow: arrowTool,
  line: lineTool,
  rect: rectTool,
  ellipse: ellipseTool,
  text: textTool,
  callout: calloutTool,
  step: stepTool,
  highlight: highlightTool,
  redact: redactTool,
  brush: brushTool,
  pencil: pencilTool,
  eraser: eraserTool,
  fill: fillTool,
  eyedropper: eyedropperTool,
  hand: handTool,
  zoom: zoomTool
}
