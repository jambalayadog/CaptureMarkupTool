import { contextBridge, ipcRenderer, webUtils } from 'electron'
import type { CaptureApi, EditorApi } from '../shared/api'

function listen<T>(channel: string, cb: (v: T) => void): () => void {
  const handler = (_e: unknown, v: T): void => cb(v)
  ipcRenderer.on(channel, handler)
  return () => ipcRenderer.removeListener(channel, handler)
}

const api: EditorApi = {
  openFiles: () => ipcRenderer.invoke('files:open'),
  saveDialog: (name, kind) => ipcRenderer.invoke('files:saveDialog', name, kind),
  writeFile: (path, bytes) => ipcRenderer.invoke('files:write', path, bytes),
  copyImage: (png) => ipcRenderer.invoke('clipboard:writeImage', png),
  readClipboardImage: () => ipcRenderer.invoke('clipboard:readImage'),
  startCapture: () => ipcRenderer.send('capture:start'),
  onCapture: (cb) => listen('editor:capture', cb),
  onCaptureSaved: (cb) => listen('editor:captureSaved', cb),
  onNotify: (cb) => listen('editor:notify', cb),
  onOpenFiles: (cb) => listen('editor:openFiles', cb),
  ready: () => ipcRenderer.send('editor:ready'),
  setDirty: (dirty) => ipcRenderer.send('app:setDirty', dirty),
  getSettings: () => ipcRenderer.invoke('settings:get'),
  setSettings: (s) => ipcRenderer.invoke('settings:set', s),
  pathForFile: (f) => webUtils.getPathForFile(f),
  quit: () => ipcRenderer.send('app:quit'),
  listLibrary: () => ipcRenderer.invoke('library:list'),
  readFile: (path) => ipcRenderer.invoke('library:read', path),
  copyFile: (path) => ipcRenderer.invoke('library:copy', path),
  revealFile: (path) => ipcRenderer.send('library:reveal', path),
  trashFile: (path) => ipcRenderer.invoke('library:trash', path),
  startDrag: (path) => ipcRenderer.send('library:startDrag', path),
  openLibraryFolder: () => ipcRenderer.send('library:openFolder'),
  openProjectPage: () => ipcRenderer.send('app:openProjectPage'),
  checkForUpdates: () => ipcRenderer.invoke('update:check'),
  installUpdate: () => ipcRenderer.send('update:install'),
  onUpdateReady: (cb) => listen('update:ready', cb),
  retryLibraryFolder: () => ipcRenderer.invoke('library:retry'),
  onLibraryChanged: (cb) => listen('library:changed', () => cb()),
  chooseFolder: (current) => ipcRenderer.invoke('settings:chooseFolder', current)
}

const captureApi: CaptureApi = {
  onShow: (cb) => void listen('capture:show', cb),
  onHide: (cb) => void listen('capture:hide', cb),
  ready: () => ipcRenderer.send('capture:ready'),
  finish: (rect) => ipcRenderer.send('capture:finish', rect),
  claim: () => ipcRenderer.send('capture:claim'),
  onClear: (cb) => void listen('capture:clear', cb)
}

contextBridge.exposeInMainWorld('api', api)
contextBridge.exposeInMainWorld('captureApi', captureApi)
