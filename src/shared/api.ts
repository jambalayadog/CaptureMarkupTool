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
  /** Always null on arrival; the library file follows in a CaptureSaved message. */
  path: string | null
  /** Matches the capture to its later CaptureSaved message. */
  id: number
}

/** A capture finished saving to the library. */
export interface CaptureSaved {
  id: number
  path: string
}

export interface Settings {
  /** Electron accelerator string, e.g. "CommandOrControl+PrintScreen". */
  hotkey: string
  /** Also put every capture on the clipboard. */
  copyOnCapture: boolean
  /** Closing the editor window hides it to the tray instead of quitting. */
  closeToTray: boolean
  /** After dragging a capture region, adjust it (arrow keys, handles) and press Enter to capture. */
  captureAdjust: boolean
  /** The mouse wheel zooms the canvas (off: it scrolls, and Ctrl+wheel zooms). */
  wheelZoom: boolean
  /** Start in the tray when Windows starts (read from and written to the registry, not settings.json). */
  openAtLogin: boolean
  /** Save every capture to the library folder automatically. */
  autoSaveCaptures: boolean
  /** Library folder; empty means the default (%USERPROFILE%\CaptureMarkupTool\Images). */
  captureFolder: string
  /** Library folder Windows refused to let the app write to (managed by the app). */
  blockedFolder: string
}

/** An image in the capture library folder. */
export interface LibraryItem {
  path: string
  name: string
  mtime: number
  /** Small JPEG data URL (empty if no thumbnail could be made). */
  thumb: string
}

export interface LibraryListing {
  /** Where new captures are being saved. */
  folder: string
  items: LibraryItem[]
  /** The chosen folder, if Windows is blocking it (captures then go to `folder`). */
  blocked: string | null
  /** This app's executable, which is what needs allowing in Windows Security. */
  exePath: string
}

export interface EditorApi {
  openFiles(): Promise<OpenedFile[]>
  saveDialog(defaultName: string, kind: FileKind): Promise<string | null>
  writeFile(path: string, bytes: Uint8Array): Promise<void>
  copyImage(png: Uint8Array): Promise<void>
  readClipboardImage(): Promise<Uint8Array | null>
  startCapture(): void
  onCapture(cb: (r: CaptureResult) => void): () => void
  onCaptureSaved(cb: (r: CaptureSaved) => void): () => void
  /** Messages from the main process to show the user. */
  onNotify(cb: (text: string) => void): () => void
  onOpenFiles(cb: (files: OpenedFile[]) => void): () => void
  ready(): void
  setDirty(dirty: boolean): void
  getSettings(): Promise<Settings>
  setSettings(s: Settings): Promise<{ ok: boolean; error?: string }>
  pathForFile(f: File): string
  quit(): void
  // capture library
  listLibrary(): Promise<LibraryListing>
  readFile(path: string): Promise<OpenedFile | null>
  copyFile(path: string): Promise<boolean>
  revealFile(path: string): void
  trashFile(path: string): Promise<boolean>
  startDrag(path: string): void
  openLibraryFolder(): void
  /** Open the project's GitHub page in the default browser. */
  openProjectPage(): void
  // updates (installed app only)
  checkForUpdates(): Promise<UpdateStatus>
  installUpdate(): void
  /** A new version finished downloading and installs on restart. */
  onUpdateReady(cb: (version: string) => void): () => void
  /** Test the chosen library folder again (after allowing the app in Windows Security). */
  retryLibraryFolder(): Promise<{ ok: boolean; folder: string }>
  onLibraryChanged(cb: () => void): () => void
  chooseFolder(current: string): Promise<string | null>
}

/** A window rectangle, in the overlay's screenshot pixel space. */
export interface CaptureWindowRect {
  x: number
  y: number
  w: number
  h: number
  title: string
}

export type UpdateStatus =
  | { state: 'dev'; current: string }
  | { state: 'latest'; current: string }
  | { state: 'downloading'; current: string; version: string }
  | { state: 'ready'; current: string; version: string }
  | { state: 'error'; current: string; error: string }

export interface CaptureShowPayload {
  /** Raw BGRA pixels of the frozen display. */
  bitmap: Uint8Array
  width: number
  height: number
  windows: CaptureWindowRect[]
  /** Cursor position in screenshot pixels, if the cursor is on this display. */
  cursor: { x: number; y: number } | null
  /** A dragged region stays up for adjusting until Enter (otherwise it's captured on release). */
  adjust: boolean
}

export interface CaptureApi {
  onShow(cb: (p: CaptureShowPayload) => void): void
  onHide(cb: () => void): void
  ready(): void
  finish(rect: { x: number; y: number; w: number; h: number } | null): void
  /** This display started a new region: the others drop theirs. */
  claim(): void
  onClear(cb: () => void): void
}
