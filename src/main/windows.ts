// Enumerates visible top-level windows (in z-order, topmost first) so the
// capture overlay can highlight and snap to the window under the cursor.
// Uses koffi to call Win32 directly; if anything fails we simply return [].

export interface NativeWindow {
  /** Physical screen pixels. */
  x: number
  y: number
  w: number
  h: number
  title: string
}

type Fn = (...args: unknown[]) => unknown

interface Win32 {
  EnumWindows: Fn
  GetForegroundWindow: Fn
  GetWindowThreadProcessId: Fn
  GetCurrentThreadId: Fn
  AttachThreadInput: Fn
  BringWindowToTop: Fn
  SetForegroundWindow: Fn
  SendInput: Fn
  IsWindowVisible: Fn
  IsIconic: Fn
  GetWindowTextW: Fn
  GetWindowLongW: Fn
  DwmGetRect: Fn
  DwmGetInt: Fn
  proto: unknown
  koffi: {
    register: (fn: unknown, type: unknown) => unknown
    unregister: (cb: unknown) => void
    pointer: (t: unknown) => unknown
    decode: (buf: Buffer, type: string) => unknown
    address: (ptr: unknown) => bigint
  }
}

let win32: Win32 | null | undefined

function load(): Win32 | null {
  if (win32 !== undefined) return win32
  win32 = null
  if (process.platform !== 'win32') return null
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const koffi = require('koffi')
    const user32 = koffi.load('user32.dll')
    const kernel32 = koffi.load('kernel32.dll')
    const dwm = koffi.load('dwmapi.dll')
    const RECT = koffi.struct('IMK_RECT', { left: 'int32', top: 'int32', right: 'int32', bottom: 'int32' })
    const HWND = koffi.pointer('IMK_HWND', koffi.opaque())
    const proto = koffi.proto('bool __stdcall IMK_EnumProc(IMK_HWND hwnd, intptr_t lParam)')
    win32 = {
      koffi,
      proto,
      EnumWindows: user32.func('bool __stdcall EnumWindows(IMK_EnumProc *proc, intptr_t lParam)'),
      GetForegroundWindow: user32.func('IMK_HWND __stdcall GetForegroundWindow()'),
      GetWindowThreadProcessId: user32.func('uint32 __stdcall GetWindowThreadProcessId(IMK_HWND hwnd, void *pid)'),
      GetCurrentThreadId: kernel32.func('uint32 __stdcall GetCurrentThreadId()'),
      AttachThreadInput: user32.func('bool __stdcall AttachThreadInput(uint32 from, uint32 to, bool attach)'),
      BringWindowToTop: user32.func('bool __stdcall BringWindowToTop(IMK_HWND hwnd)'),
      SetForegroundWindow: user32.func('bool __stdcall SetForegroundWindow(IMK_HWND hwnd)'),
      SendInput: user32.func('uint32 __stdcall SendInput(uint32 count, void *inputs, int size)'),
      IsWindowVisible: user32.func('bool __stdcall IsWindowVisible(IMK_HWND hwnd)'),
      IsIconic: user32.func('bool __stdcall IsIconic(IMK_HWND hwnd)'),
      GetWindowTextW: user32.func('int __stdcall GetWindowTextW(IMK_HWND hwnd, void *buf, int max)'),
      GetWindowLongW: user32.func('int32 __stdcall GetWindowLongW(IMK_HWND hwnd, int index)'),
      DwmGetRect: dwm.func('__stdcall', 'DwmGetWindowAttribute', 'int32', [HWND, 'uint32', koffi.out(koffi.pointer(RECT)), 'uint32']),
      DwmGetInt: dwm.func('__stdcall', 'DwmGetWindowAttribute', 'int32', [HWND, 'uint32', koffi.out(koffi.pointer('int32')), 'uint32'])
    }
  } catch (err) {
    console.warn('[windows] native window enumeration unavailable:', err)
    win32 = null
  }
  return win32
}

const GWL_EXSTYLE = -20
const WS_EX_TOOLWINDOW = 0x80
const WS_EX_NOACTIVATE = 0x08000000
const DWMWA_EXTENDED_FRAME_BOUNDS = 9
const DWMWA_CLOAKED = 14
const IGNORED_TITLES = new Set(['Program Manager', 'Windows Input Experience', 'Windows Shell Experience Host'])

/** sizeof(INPUT): a type field plus the largest member of its union, padded. */
const INPUT_SIZE = process.arch === 'ia32' ? 28 : 40

/**
 * Bring a window to the foreground with keyboard focus. Windows usually refuses
 * when another app is in front (and our app is in the background when the capture
 * hotkey fires), while Electron still reports the window as focused, so keystrokes
 * quietly go to the other app. Two standard workarounds, together: an empty mouse
 * input makes us the source of the last input event (as PowerToys does), and
 * briefly sharing input state with the foreground thread lets the call through.
 */
export function forceForeground(handle: Buffer): boolean {
  const w = load()
  if (!w) return false
  try {
    const hwnd = w.koffi.decode(handle, 'IMK_HWND')
    const target = w.koffi.address(hwnd)
    const fg = w.GetForegroundWindow()
    if (fg && w.koffi.address(fg) === target) return true
    w.SendInput(1, Buffer.alloc(INPUT_SIZE), INPUT_SIZE)
    const fgThread = fg ? (w.GetWindowThreadProcessId(fg, null) as number) : 0
    const me = w.GetCurrentThreadId() as number
    const attach = fgThread !== 0 && fgThread !== me && !!w.AttachThreadInput(me, fgThread, true)
    try {
      w.BringWindowToTop(hwnd)
      w.SetForegroundWindow(hwnd)
    } finally {
      if (attach) w.AttachThreadInput(me, fgThread, false)
    }
    const now = w.GetForegroundWindow()
    return !!now && w.koffi.address(now) === target
  } catch (err) {
    console.warn('[windows] could not bring the window forward:', err)
    return false
  }
}

export function listWindows(): NativeWindow[] {
  const w = load()
  if (!w) return []
  const out: NativeWindow[] = []
  const buf = Buffer.alloc(512)
  const visit = (hwnd: unknown): boolean => {
    try {
      if (!w.IsWindowVisible(hwnd) || w.IsIconic(hwnd)) return true
      const ex = w.GetWindowLongW(hwnd, GWL_EXSTYLE) as number
      if (ex & WS_EX_TOOLWINDOW || ex & WS_EX_NOACTIVATE) return true
      const cloaked = [0]
      if (w.DwmGetInt(hwnd, DWMWA_CLOAKED, cloaked, 4) === 0 && cloaked[0] !== 0) return true
      const len = w.GetWindowTextW(hwnd, buf, 255) as number
      const title = len > 0 ? buf.toString('utf16le', 0, len * 2) : ''
      if (!title || IGNORED_TITLES.has(title)) return true
      const r: { left?: number; top?: number; right?: number; bottom?: number } = {}
      if (w.DwmGetRect(hwnd, DWMWA_EXTENDED_FRAME_BOUNDS, r, 16) !== 0) return true
      const width = (r.right ?? 0) - (r.left ?? 0)
      const height = (r.bottom ?? 0) - (r.top ?? 0)
      if (width < 8 || height < 8) return true
      out.push({ x: r.left ?? 0, y: r.top ?? 0, w: width, h: height, title })
    } catch {
      // skip windows we can't inspect
    }
    return true
  }
  const cb = w.koffi.register(visit, w.koffi.pointer(w.proto))
  try {
    w.EnumWindows(cb, 0)
  } finally {
    w.koffi.unregister(cb)
  }
  return out
}
