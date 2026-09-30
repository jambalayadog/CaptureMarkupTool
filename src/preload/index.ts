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
  onOpenFiles: (cb) => listen('editor:openFiles', cb),
  ready: () => ipcRenderer.send('editor:ready'),
  setDirty: (dirty) => ipcRenderer.send('app:setDirty', dirty),
  getSettings: () => ipcRenderer.invoke('settings:get'),
  setSettings: (s) => ipcRenderer.invoke('settings:set', s),
  pathForFile: (f) => webUtils.getPathForFile(f),
  quit: () => ipcRenderer.send('app:quit')
}

const captureApi: CaptureApi = {
  onShow: (cb) => void listen('capture:show', cb),
  onHide: (cb) => void listen('capture:hide', cb),
  ready: () => ipcRenderer.send('capture:ready'),
  finish: (rect) => ipcRenderer.send('capture:finish', rect)
}

contextBridge.exposeInMainWorld('api', api)
contextBridge.exposeInMainWorld('captureApi', captureApi)
