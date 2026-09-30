import type { DocState } from './doc'
import { rasterLayer, vectorLayer } from './doc'
import { flattenDoc } from './render'
import type { FileKind, Layer } from './types'
import { ctx2d, makeCanvas } from './util'

export async function decodeImage(src: Uint8Array | Blob): Promise<HTMLCanvasElement> {
  const blob = src instanceof Blob ? src : new Blob([src as BlobPart])
  const bmp = await createImageBitmap(blob, { colorSpaceConversion: 'none', premultiplyAlpha: 'default' })
  const c = makeCanvas(bmp.width, bmp.height)
  ctx2d(c).drawImage(bmp, 0, 0)
  bmp.close()
  return c
}

export function canvasToBlob(c: HTMLCanvasElement, type = 'image/png', quality?: number): Promise<Blob> {
  return new Promise((resolve, reject) => c.toBlob((b) => (b ? resolve(b) : reject(new Error('encode failed'))), type, quality))
}

export async function encodeDoc(d: DocState, kind: FileKind): Promise<Uint8Array> {
  let blob: Blob
  if (kind === 'imk') return encodeProject(d)
  if (kind === 'jpg') blob = await canvasToBlob(flattenDoc(d, '#ffffff'), 'image/jpeg', 0.92)
  else if (kind === 'webp') blob = await canvasToBlob(flattenDoc(d), 'image/webp', 0.95)
  else blob = await canvasToBlob(flattenDoc(d), 'image/png')
  return new Uint8Array(await blob.arrayBuffer())
}

// ---- .imk project format: JSON with PNG data URLs for raster layers ----------

interface ProjectFile {
  app: 'markup'
  format: 1
  width: number
  height: number
  active: number
  layers: Array<
    | { kind: 'raster'; name: string; visible: boolean; opacity: number; blend: string; locked: boolean; x: number; y: number; png: string }
    | { kind: 'vector'; name: string; visible: boolean; opacity: number; blend: string; locked: boolean; objects: unknown[] }
  >
}

export function encodeProject(d: DocState): Uint8Array {
  const file: ProjectFile = {
    app: 'markup',
    format: 1,
    width: d.width,
    height: d.height,
    active: d.layers.findIndex((l) => l.id === d.activeLayerId),
    layers: d.layers.map((l) => {
      const base = { name: l.name, visible: l.visible, opacity: l.opacity, blend: l.blend, locked: l.locked }
      return l.kind === 'raster'
        ? { kind: 'raster' as const, ...base, x: l.x, y: l.y, png: l.canvas.toDataURL('image/png') }
        : { kind: 'vector' as const, ...base, objects: l.objects }
    })
  }
  return new TextEncoder().encode(JSON.stringify(file))
}

export interface DecodedProject {
  width: number
  height: number
  layers: Layer[]
  activeIndex: number
}

export async function decodeProject(bytes: Uint8Array): Promise<DecodedProject> {
  const file = JSON.parse(new TextDecoder().decode(bytes)) as ProjectFile
  if (file.app !== 'markup' || !Array.isArray(file.layers)) throw new Error('Not a Capture Markup Tool project file')
  const layers: Layer[] = []
  for (const l of file.layers) {
    const blend = l.blend as GlobalCompositeOperation
    if (l.kind === 'raster') {
      const blob = await (await fetch(l.png)).blob()
      const layer = rasterLayer(l.name, await decodeImage(blob), l.x, l.y)
      Object.assign(layer, { visible: l.visible, opacity: l.opacity, blend, locked: l.locked })
      layers.push(layer)
    } else {
      const layer = vectorLayer(l.name)
      Object.assign(layer, { visible: l.visible, opacity: l.opacity, blend, locked: l.locked, objects: l.objects })
      layers.push(layer)
    }
  }
  return { width: file.width, height: file.height, layers, activeIndex: file.active }
}

export const isProjectBytes = (bytes: Uint8Array): boolean => bytes[0] === 0x7b // '{'
