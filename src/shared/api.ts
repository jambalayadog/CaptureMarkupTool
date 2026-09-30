// Contract between the Electron main process and the renderer pages.

export type FileKind = 'png' | 'jpg' | 'webp' | 'imk'

export interface OpenedFile {
  name: string
  path: string | null
  bytes: Uint8Array
}

export interface CaptureResult {
  png: Uint8Array
  name: string
}

export interface Settings {
  /** Electron accelerator string, e.g. "CommandOrControl+PrintScreen". */
  hotkey: string
  /** Also put every capture on the clipboard. */
  copyOnCapture: boolean
  /** Closing the editor window hides it to the tray instead of quitting. */
  closeToTray: boolean
}

export interface EditorApi {
  openFiles(): Promise<OpenedFile[]>
  saveDialog(defaultName: string, kind: FileKind): Promise<string | null>
  writeFile(path: string, bytes: Uint8Array): Promise<void>
  copyImage(png: Uint8Array): Promise<void>
  readClipboardImage(): Promise<Uint8Array | null>
  startCapture(): void
  onCapture(cb: (r: CaptureResult) => void): () => void
  onOpenFiles(cb: (files: OpenedFile[]) => void): () => void
  ready(): void
  setDirty(dirty: boolean): void
  getSettings(): Promise<Settings>
  setSettings(s: Settings): Promise<{ ok: boolean; error?: string }>
  pathForFile(f: File): string
  quit(): void
}

/** A window rectangle, in the overlay's screenshot pixel space. */
export interface CaptureWindowRect {
  x: number
  y: number
  w: number
  h: number
  title: string
}

export interface CaptureShowPayload {
  /** Raw BGRA pixels of the frozen display. */
  bitmap: Uint8Array
  width: number
  height: number
  windows: CaptureWindowRect[]
  /** Cursor position in screenshot pixels, if the cursor is on this display. */
  cursor: { x: number; y: number } | null
}

export interface CaptureApi {
  onShow(cb: (p: CaptureShowPayload) => void): void
  onHide(cb: () => void): void
  ready(): void
  finish(rect: { x: number; y: number; w: number; h: number } | null): void
}
