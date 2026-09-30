import {
  Brush,
  Circle,
  Crop,
  Eraser,
  EyeOff,
  Hand,
  Highlighter,
  LassoSelect,
  ListOrdered,
  MessageSquare,
  MousePointer2,
  MoveUpRight,
  PaintBucket,
  Pencil,
  Pipette,
  Scaling,
  Slash,
  Square,
  SquareDashed,
  Type,
  WandSparkles,
  ZoomIn,
  type LucideIcon
} from 'lucide-react'
import type { ToolId } from '../core/types'

export interface ToolMeta {
  id: ToolId
  label: string
  key?: string
  icon: LucideIcon
  hint: string
}

export const TOOL_GROUPS: ToolMeta[][] = [
  [
    { id: 'select', label: 'Select & move', key: 'V', icon: MousePointer2, hint: 'Click to select · drag to move · Shift-click to add · Alt-drag to duplicate · double-click text to edit' },
    { id: 'marquee', label: 'Rectangle select', key: 'M', icon: SquareDashed, hint: 'Drag to select · Shift adds, Alt subtracts · Shift during the drag for a square · drag inside to move the selection' },
    { id: 'lasso', label: 'Lasso select', key: 'Q', icon: LassoSelect, hint: 'Drag a freehand shape, or click point by point (Enter or click the first point to close) · Shift adds, Alt subtracts' },
    { id: 'wand', label: 'Magic wand', key: 'W', icon: WandSparkles, hint: 'Click to select similar colours · Shift adds, Alt subtracts · set tolerance in the options bar' },
    { id: 'crop', label: 'Crop', key: 'C', icon: Crop, hint: 'Drag handles or draw a new area · drag outside the image to expand the canvas · Enter to apply' },
    { id: 'transform', label: 'Free transform (Ctrl+T)', icon: Scaling, hint: 'Drag handles to scale (Shift keeps proportions, Alt from centre) · drag outside to rotate (Shift snaps) · Enter applies, Esc cancels' }
  ],
  [
    { id: 'arrow', label: 'Arrow', key: 'A', icon: MoveUpRight, hint: 'Drag to draw · Shift snaps to 45°' },
    { id: 'line', label: 'Line', key: 'L', icon: Slash, hint: 'Drag to draw · Shift snaps to 45°' },
    { id: 'rect', label: 'Rectangle', key: 'R', icon: Square, hint: 'Drag to draw · Shift for a square · Alt draws from the centre' },
    { id: 'ellipse', label: 'Ellipse', key: 'O', icon: Circle, hint: 'Drag to draw · Shift for a circle · Alt draws from the centre' },
    { id: 'text', label: 'Text', key: 'T', icon: Type, hint: 'Click to type · click existing text to edit · Esc or click away to finish' },
    { id: 'callout', label: 'Callout', key: 'K', icon: MessageSquare, hint: 'Press where the bubble points, drag to place it, then type' },
    { id: 'step', label: 'Numbered step', key: 'N', icon: ListOrdered, hint: 'Click to drop the next number · drag a step to move it' },
    { id: 'highlight', label: 'Highlighter', key: 'H', icon: Highlighter, hint: 'Drag to highlight · Shift for a straight stroke' },
    { id: 'redact', label: 'Blur / redact', key: 'U', icon: EyeOff, hint: 'Drag over sensitive info · Solid is safest (pixelation can sometimes be reversed)' }
  ],
  [
    { id: 'brush', label: 'Brush', key: 'B', icon: Brush, hint: 'Paint · Shift-click draws a straight line · right-click paints the secondary colour · Alt picks a colour' },
    { id: 'pencil', label: 'Pencil (pixel)', key: 'P', icon: Pencil, hint: 'Hard pixel pencil · Shift-click for straight lines · right-click paints the secondary colour' },
    { id: 'eraser', label: 'Eraser', key: 'E', icon: Eraser, hint: 'Erase pixels on the active layer · Shift-click for straight lines' },
    { id: 'fill', label: 'Fill', key: 'G', icon: PaintBucket, hint: 'Flood-fill an area · click an annotation to recolour its fill' },
    { id: 'eyedropper', label: 'Eyedropper', key: 'I', icon: Pipette, hint: 'Click to pick the primary colour · right-click for secondary' }
  ],
  [
    { id: 'hand', label: 'Hand (hold Space)', icon: Hand, hint: 'Drag to pan · or hold Space with any tool' },
    { id: 'zoom', label: 'Zoom', key: 'Z', icon: ZoomIn, hint: 'Click to zoom in · Alt-click to zoom out · the mouse wheel zooms anywhere' }
  ]
]

export const TOOL_META: Record<ToolId, ToolMeta> = Object.fromEntries(TOOL_GROUPS.flat().map((t) => [t.id, t])) as Record<ToolId, ToolMeta>
