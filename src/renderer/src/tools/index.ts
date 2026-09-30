import type { ToolId } from '../core/types'
import { brushTool, eraserTool, eyedropperTool, fillTool, pencilTool } from './paint'
import { cropTool, handTool, marqueeTool, zoomTool } from './region'
import { selectTool } from './select'
import { arrowTool, ellipseTool, highlightTool, lineTool, rectTool, redactTool } from './shapes'
import { calloutTool, stepTool, textTool } from './text'
import type { Tool } from './types'

export const TOOLS: Record<ToolId, Tool> = {
  select: selectTool,
  marquee: marqueeTool,
  crop: cropTool,
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
