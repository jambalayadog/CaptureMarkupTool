import { BrowserWindow, type Rectangle } from 'electron'

const W = 220
const H = 52

let win: BrowserWindow | null = null
let timer: NodeJS.Timeout | undefined

/**
 * A brief "✓ Copied"-style bubble centred on part of the screen. It never takes
 * focus or clicks, so whatever app you're in keeps the keyboard.
 */
export function flash(text: string, around: Rectangle): void {
  if (!win || win.isDestroyed()) {
    win = new BrowserWindow({
      width: W,
      height: H,
      show: false,
      frame: false,
      transparent: true,
      resizable: false,
      movable: false,
      minimizable: false,
      maximizable: false,
      focusable: false,
      skipTaskbar: true,
      hasShadow: false,
      webPreferences: { sandbox: true, contextIsolation: true }
    })
    win.setIgnoreMouseEvents(true)
    win.setAlwaysOnTop(true, 'screen-saver')
  }
  const safe = text.replace(/[<>&]/g, '')
  const html =
    '<!doctype html><meta charset="utf-8"><body style="margin:0;height:100vh;display:flex;align-items:center;justify-content:center;' +
    'background:transparent;font:600 13px Segoe UI,system-ui,sans-serif;user-select:none">' +
    '<div style="padding:9px 18px;border-radius:999px;background:rgba(20,22,28,.94);color:#fff;' +
    `border:1px solid rgba(255,255,255,.16);box-shadow:0 4px 18px rgba(0,0,0,.45)">✓ ${safe}</div>`
  void win.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`)
  win.setBounds({
    x: Math.round(around.x + around.width / 2 - W / 2),
    y: Math.round(around.y + around.height / 2 - H / 2),
    width: W,
    height: H
  })
  win.showInactive()
  clearTimeout(timer)
  timer = setTimeout(() => win?.hide(), 1100)
}
