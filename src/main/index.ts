import { app, BrowserWindow, clipboard, ClipboardItem, dialog, globalShortcut, ipcMain, Menu, nativeImage, shell, Tray } from 'electron'
import { basename, extname, isAbsolute, join } from 'path'
import { readFile, writeFile } from 'fs/promises'
import { existsSync } from 'fs'
import { CaptureManager } from './capture'
import { explainWriteError } from './fsutil'
import { Library } from './library'
import { captureFolder, defaultCaptureFolder, loadSettings, saveSettings } from './settings'
import type { FileKind, OpenedFile, Settings } from '../shared/api'

const ICON = join(__dirname, '../../resources/icon.png')
const PRELOAD = join(__dirname, '../preload/index.js')
const OPENABLE = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp', '.imk'])
const TITLEBAR = '#18191c'
const APP_NAME = 'Capture Markup Tool'

// Name the app and its data folder before anything uses them (the single-instance
// lock lives in userData). %APPDATA%\CaptureMarkupTool holds settings and caches.
app.setName(APP_NAME)
app.setPath('userData', join(app.getPath('appData'), 'CaptureMarkupTool'))
if (process.platform === 'win32') app.setAppUserModelId('com.jwatt.capturemarkuptool')

let editor: BrowserWindow | null = null
let editorReady = false
let tray: Tray | null = null
let dirty = false
let quitting = false
let settings: Settings
let capture: CaptureManager
let captureSeq = 0
let library: Library
/** Messages for the editor page that arrived before it finished loading. */
const outbox: Array<[string, unknown]> = []

function loadPage(win: BrowserWindow, page: 'index' | 'capture'): void {
  const devUrl = process.env['ELECTRON_RENDERER_URL']
  if (!app.isPackaged && devUrl) void win.loadURL(`${devUrl}/${page}.html`)
  else void win.loadFile(join(__dirname, `../renderer/${page}.html`))
}

function createEditor(): void {
  editorReady = false
  editor = new BrowserWindow({
    width: 1480,
    height: 920,
    minWidth: 900,
    minHeight: 560,
    show: false,
    backgroundColor: TITLEBAR,
    title: APP_NAME,
    icon: ICON,
    titleBarStyle: 'hidden',
    titleBarOverlay: { color: TITLEBAR, symbolColor: '#c9ccd1', height: 36 },
    webPreferences: { preload: PRELOAD, contextIsolation: true, sandbox: true }
  })
  editor.once('ready-to-show', () => editor?.show())
  if (!app.isPackaged) {
    // The app menu is hidden, so wire up dev tools and reload by hand in development.
    editor.webContents.on('before-input-event', (_e, input) => {
      if (input.type !== 'keyDown') return
      if (input.key === 'F12') editor?.webContents.toggleDevTools()
      if (input.key === 'F5') editor?.webContents.reload()
    })
  }
  editor.on('close', (e) => {
    if (quitting) return
    if (settings.closeToTray) {
      e.preventDefault()
      editor?.hide()
      return
    }
    if (dirty && !confirmDiscard()) {
      e.preventDefault()
      return
    }
    quitting = true
  })
  editor.on('closed', () => {
    editor = null
    editorReady = false
    if (quitting) app.quit()
  })
  loadPage(editor, 'index')
}

function showEditor(): void {
  if (!editor) return createEditor()
  if (editor.isMinimized()) editor.restore()
  editor.show()
  editor.focus()
}

/** Show a message in the editor (queued until it's ready). */
function notify(text: string): void {
  if (editor && editorReady) editor.webContents.send('editor:notify', text)
  else outbox.push(['editor:notify', text])
}

function sendToEditor(channel: string, payload: unknown): void {
  showEditor()
  if (editor && editorReady) editor.webContents.send(channel, payload)
  else outbox.push([channel, payload])
}

function confirmDiscard(): boolean {
  const opts = {
    type: 'warning' as const,
    buttons: ['Quit without saving', 'Cancel'],
    defaultId: 1,
    cancelId: 1,
    message: 'You have unsaved changes.',
    detail: 'If you quit now, unsaved changes will be lost.'
  }
  return (editor ? dialog.showMessageBoxSync(editor, opts) : dialog.showMessageBoxSync(opts)) === 0
}

function requestQuit(): void {
  if (dirty) {
    showEditor()
    if (!confirmDiscard()) return
  }
  quitting = true
  app.quit()
}

function captureName(): string {
  const d = new Date()
  const p = (n: number): string => String(n).padStart(2, '0')
  return `Capture ${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}.${p(d.getMinutes())}.${p(d.getSeconds())}`
}

async function readFiles(paths: string[]): Promise<OpenedFile[]> {
  const out: OpenedFile[] = []
  for (const p of paths) {
    try {
      out.push({ name: basename(p), path: p, bytes: new Uint8Array(await readFile(p)) })
    } catch (err) {
      console.error('[open] failed to read', p, err)
    }
  }
  return out
}

function handleArgv(argv: string[]): void {
  const files = argv.slice(1).filter((a) => !a.startsWith('-') && OPENABLE.has(extname(a).toLowerCase()) && existsSync(a))
  if (files.length) void readFiles(files).then((list) => sendToEditor('editor:openFiles', list))
  if (argv.includes('--capture')) void capture.start(false)
  // Dev-only: run the whole capture pipeline without showing overlays.
  if (argv.includes('--capture-test') && !app.isPackaged) void capture.start(false, { x: 0, y: 0, w: 64, h: 64 })
  // Dev-only: save a PNG of the editor window's own contents (for automated checks).
  const shot = argv.find((a) => a.startsWith('--debug-shot='))
  if (shot && !app.isPackaged && editor) {
    void editor.webContents.capturePage().then((img) => writeFile(shot.slice('--debug-shot='.length), img.toPNG()))
  }
}

function prettyAccelerator(accel: string): string {
  return accel.replace('CommandOrControl', 'Ctrl').replace(/\+/g, ' + ')
}

function registerHotkey(accel: string): boolean {
  globalShortcut.unregisterAll()
  if (!accel) return true
  try {
    return globalShortcut.register(accel, () => void capture.start(false))
  } catch {
    return false
  }
}

function trayIcon(): Electron.NativeImage {
  const base = nativeImage.createFromPath(ICON)
  if (base.isEmpty()) return base
  const img = nativeImage.createEmpty()
  for (const scale of [1, 1.5, 2]) {
    const px = Math.round(16 * scale)
    img.addRepresentation({ scaleFactor: scale, buffer: base.resize({ width: px, height: px, quality: 'best' }).toPNG() })
  }
  return img
}

function updateTrayMenu(): void {
  if (!tray) return
  const hotkey = settings.hotkey ? `\t${prettyAccelerator(settings.hotkey)}` : ''
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: `New capture${hotkey}`, click: () => void capture.start(false) },
      { label: 'Open editor', click: showEditor },
      { type: 'separator' },
      { label: `Quit ${APP_NAME}`, click: requestQuit }
    ])
  )
  tray.setToolTip(settings.hotkey ? `${APP_NAME}: ${prettyAccelerator(settings.hotkey)} to capture` : APP_NAME)
}

function copyPngToClipboard(png: Uint8Array): Promise<void> {
  return clipboard.write([new ClipboardItem({ 'image/png': new Blob([Buffer.from(png)], { type: 'image/png' }) })])
}

function registerIpc(): void {
  ipcMain.handle('files:open', async () => {
    const opts: Electron.OpenDialogOptions = {
      properties: ['openFile', 'multiSelections'],
      filters: [
        { name: 'Images and projects', extensions: ['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'imk'] },
        { name: 'All files', extensions: ['*'] }
      ]
    }
    const r = editor ? await dialog.showOpenDialog(editor, opts) : await dialog.showOpenDialog(opts)
    return r.canceled ? [] : readFiles(r.filePaths)
  })

  ipcMain.handle('files:saveDialog', async (_e, name: string, kind: FileKind) => {
    const all = [
      { name: 'PNG image', extensions: ['png'] },
      { name: 'JPEG image', extensions: ['jpg', 'jpeg'] },
      { name: 'WebP image', extensions: ['webp'] },
      { name: `${APP_NAME} project (keeps layers)`, extensions: ['imk'] }
    ]
    const first = all.find((f) => f.extensions[0] === kind) ?? all[0]
    const opts: Electron.SaveDialogOptions = {
      // Start in the capture library: a folder the app is known to be able to write to.
      defaultPath: isAbsolute(name) ? name : join(library.folder(), name),
      filters: [first, ...all.filter((f) => f !== first)]
    }
    const r = editor ? await dialog.showSaveDialog(editor, opts) : await dialog.showSaveDialog(opts)
    return r.canceled || !r.filePath ? null : r.filePath
  })

  ipcMain.handle('files:write', async (_e, path: string, bytes: Uint8Array) => {
    try {
      await writeFile(path, bytes)
    } catch (err) {
      throw new Error(explainWriteError(err, path))
    }
  })

  ipcMain.handle('clipboard:writeImage', (_e, png: Uint8Array) => copyPngToClipboard(png))

  ipcMain.handle('clipboard:readImage', async () => {
    for (const item of await clipboard.read()) {
      const type = item.types.find((t) => t.startsWith('image/'))
      if (!type) continue
      const blob = (await item.getType(type)) as Blob
      return new Uint8Array(await blob.arrayBuffer())
    }
    return null
  })

  ipcMain.on('capture:start', () => void capture.start(true))

  ipcMain.on('editor:ready', () => {
    editorReady = true
    for (const [channel, payload] of outbox.splice(0)) editor?.webContents.send(channel, payload)
  })

  ipcMain.on('app:setDirty', (_e, v: boolean) => {
    dirty = v
  })

  ipcMain.handle('settings:get', () => settings)

  ipcMain.handle('settings:set', (_e, next: Settings) => {
    if (next.hotkey !== settings.hotkey && !registerHotkey(next.hotkey)) {
      registerHotkey(settings.hotkey)
      return { ok: false, error: `Couldn't register ${prettyAccelerator(next.hotkey)}. Another app may already be using it.` }
    }
    const folderChanged = next.captureFolder !== settings.captureFolder
    // blockedFolder is the app's own bookkeeping; don't let a stale copy from the page overwrite it
    settings = { ...next, blockedFolder: settings.blockedFolder }
    saveSettings(settings)
    updateTrayMenu()
    if (folderChanged) {
      library.reset()
      editor?.webContents.send('library:changed')
    }
    return { ok: true }
  })

  ipcMain.on('app:quit', requestQuit)

  // ---- capture library ----
  ipcMain.handle('library:list', async () => ({
    folder: library.folder(),
    items: await library.list(),
    blocked: library.blockedFolder(),
    exePath: process.execPath
  }))

  ipcMain.handle('library:retry', async () => {
    const ok = await library.retry()
    editor?.webContents.send('library:changed')
    return { ok, folder: library.folder() }
  })

  ipcMain.handle('library:read', async (_e, p: string) => (await readFiles([p]))[0] ?? null)

  ipcMain.handle('library:copy', async (_e, p: string) => {
    const img = nativeImage.createFromPath(p)
    if (img.isEmpty()) return false
    await copyPngToClipboard(img.toPNG())
    return true
  })

  ipcMain.on('library:reveal', (_e, p: string) => shell.showItemInFolder(p))

  ipcMain.handle('library:trash', async (_e, p: string) => {
    if (!library.contains(p)) return false
    await shell.trashItem(p)
    return true
  })

  ipcMain.on('library:startDrag', (e, p: string) => {
    const icon = library.dragIcon(p) ?? nativeImage.createFromPath(ICON).resize({ width: 64 })
    e.sender.startDrag({ file: p, icon })
  })

  ipcMain.on('library:openFolder', async () => {
    try {
      void shell.openPath(await library.openable())
    } catch (err) {
      notify((err as Error).message)
    }
  })

  ipcMain.handle('settings:chooseFolder', async (_e, current: string) => {
    const opts: Electron.OpenDialogOptions = {
      title: 'Choose where captures are saved',
      defaultPath: current || library.folder(),
      properties: ['openDirectory', 'createDirectory']
    }
    const r = editor ? await dialog.showOpenDialog(editor, opts) : await dialog.showOpenDialog(opts)
    return r.canceled ? null : r.filePaths[0]
  })
}

if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  app.on('second-instance', (_e, argv) => {
    handleArgv(argv)
    if (!argv.some((a) => a.startsWith('--capture') || a.startsWith('--debug-shot='))) showEditor()
  })

  app.whenReady().then(() => {
    Menu.setApplicationMenu(null)
    settings = loadSettings()
    capture = new CaptureManager({
      preload: PRELOAD,
      loadPage,
      hideEditor: async () => {
        if (!editor || !editor.isVisible() || editor.isMinimized()) return false
        editor.hide()
        await new Promise((r) => setTimeout(r, 250)) // let the hide animation finish
        return true
      },
      restoreEditor: showEditor,
      onCaptured: async (png) => {
        if (settings.copyOnCapture) void copyPngToClipboard(png)
        // Open the editor first; saving to the library happens in the background
        // and must never be able to hold up editing.
        const id = ++captureSeq
        const name = captureName()
        sendToEditor('editor:capture', { png: new Uint8Array(png), name, path: null, id })
        if (!settings.autoSaveCaptures) return
        try {
          const saved = await library.save(png, name)
          sendToEditor('editor:captureSaved', { id, path: saved.path })
          if (saved.blockedFolder) {
            notify(
              `Windows blocked saving captures to ${saved.blockedFolder} (Controlled folder access), so they're going to ${library.folder()}. ` +
                'Pick another folder in File > Settings, or allow the app in Windows Security > Ransomware protection.'
            )
          }
        } catch (err) {
          console.error('[library] could not save capture:', err)
          notify(`Couldn't save the capture to the library: ${(err as Error).message}`)
        }
      }
    })
    library = new Library(
      () => captureFolder(settings),
      // If Windows blocks a folder picked in Settings, fall back to the default
      // (in the user's own folder, which Controlled Folder Access doesn't guard).
      () => defaultCaptureFolder(),
      () => settings.blockedFolder,
      (dir) => {
        if (settings.blockedFolder === dir) return
        settings = { ...settings, blockedFolder: dir }
        saveSettings(settings)
      },
      () => editor?.webContents.send('library:changed')
    )
    registerIpc()
    tray = new Tray(trayIcon())
    tray.on('click', showEditor)
    updateTrayMenu()
    if (!registerHotkey(settings.hotkey)) console.warn(`[hotkey] could not register ${settings.hotkey}`)
    createEditor()
    handleArgv(process.argv)
    capture.prewarm()
  })

  app.on('before-quit', () => {
    quitting = true
  })
  app.on('will-quit', () => globalShortcut.unregisterAll())
}
