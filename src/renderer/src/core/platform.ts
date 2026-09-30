// Thin layer over Electron IPC with browser fallbacks, so the editor also
// runs in a normal browser tab during development.
import type { EditorApi, FileKind, OpenedFile } from '../../../shared/api'
import { ctx2d, makeCanvas } from './util'

declare global {
  interface Window {
    api?: EditorApi
    showSaveFilePicker?: (opts: {
      suggestedName?: string
      types?: { description: string; accept: Record<string, string[]> }[]
    }) => Promise<FileSystemFileHandle>
  }
}

export const api: EditorApi | null = window.api ?? null
export const isElectron = !!api

export function kindFromName(name: string): FileKind | null {
  const ext = name.toLowerCase().split('.').pop() ?? ''
  if (ext === 'png') return 'png'
  if (ext === 'jpg' || ext === 'jpeg') return 'jpg'
  if (ext === 'webp') return 'webp'
  if (ext === 'imk') return 'imk'
  return null
}

export const basename = (p: string): string => p.split(/[\\/]/).pop() ?? p

export async function fileToOpened(f: File): Promise<OpenedFile> {
  let path: string | null = null
  try {
    path = api?.pathForFile(f) || null
  } catch {
    path = null
  }
  return { name: f.name, path, bytes: new Uint8Array(await f.arrayBuffer()) }
}

export async function pickFiles(): Promise<OpenedFile[]> {
  if (api) return api.openFiles()
  return new Promise((resolve) => {
    const input = document.createElement('input')
    input.type = 'file'
    input.multiple = true
    input.accept = 'image/*,.imk'
    input.onchange = async () => resolve(await Promise.all(Array.from(input.files ?? []).map(fileToOpened)))
    input.addEventListener('cancel', () => resolve([]))
    input.click()
  })
}

export interface SaveTarget {
  path: string | null
  handle: FileSystemFileHandle | null
  name: string
  kind: FileKind
}

const PICKER_TYPES: Record<FileKind, { description: string; accept: Record<string, string[]> }> = {
  png: { description: 'PNG image', accept: { 'image/png': ['.png'] } },
  jpg: { description: 'JPEG image', accept: { 'image/jpeg': ['.jpg', '.jpeg'] } },
  webp: { description: 'WebP image', accept: { 'image/webp': ['.webp'] } },
  imk: { description: 'Capture Markup Tool project (keeps layers)', accept: { 'application/x-markup': ['.imk'] } }
}

/** Ask where to save. Returns null if the user cancelled. */
export async function chooseSaveTarget(defaultName: string, kind: FileKind): Promise<SaveTarget | null> {
  if (api) {
    const path = await api.saveDialog(defaultName, kind)
    if (!path) return null
    return { path, handle: null, name: basename(path), kind: kindFromName(path) ?? kind }
  }
  if (window.showSaveFilePicker) {
    try {
      const order: FileKind[] = [kind, ...(['png', 'jpg', 'webp', 'imk'] as FileKind[]).filter((k) => k !== kind)]
      const handle = await window.showSaveFilePicker({ suggestedName: defaultName, types: order.map((k) => PICKER_TYPES[k]) })
      return { path: null, handle, name: handle.name, kind: kindFromName(handle.name) ?? kind }
    } catch (err) {
      if ((err as Error).name === 'AbortError') return null
    }
  }
  return { path: null, handle: null, name: defaultName, kind }
}

export async function writeTarget(t: Pick<SaveTarget, 'path' | 'handle' | 'name'>, bytes: Uint8Array): Promise<void> {
  if (t.path && api) return api.writeFile(t.path, bytes)
  if (t.handle) {
    const w = await t.handle.createWritable()
    await w.write(bytes as BlobPart)
    await w.close()
    return
  }
  const url = URL.createObjectURL(new Blob([bytes as BlobPart]))
  const a = document.createElement('a')
  a.href = url
  a.download = t.name
  a.click()
  setTimeout(() => URL.revokeObjectURL(url), 5000)
}

export async function copyPng(blob: Blob): Promise<void> {
  if (api) return api.copyImage(new Uint8Array(await blob.arrayBuffer()))
  await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })])
}

export async function readClipboardImage(): Promise<Blob | null> {
  if (api) {
    const bytes = await api.readClipboardImage()
    return bytes ? new Blob([bytes as BlobPart], { type: 'image/png' }) : null
  }
  try {
    for (const item of await navigator.clipboard.read()) {
      const type = item.types.find((t) => t.startsWith('image/'))
      if (type) return await item.getType(type)
    }
  } catch {
    // permission denied or empty
  }
  return null
}

/** Browser-only capture via the screen-share picker. */
export async function browserCapture(): Promise<HTMLCanvasElement | null> {
  let stream: MediaStream
  try {
    stream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: false })
  } catch {
    return null
  }
  try {
    const video = document.createElement('video')
    video.srcObject = stream
    video.muted = true
    await video.play()
    await new Promise((r) => setTimeout(r, 150))
    const c = makeCanvas(video.videoWidth, video.videoHeight)
    ctx2d(c).drawImage(video, 0, 0)
    return c
  } finally {
    stream.getTracks().forEach((t) => t.stop())
  }
}
