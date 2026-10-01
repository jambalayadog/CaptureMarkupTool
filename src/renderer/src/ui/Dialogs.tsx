import { ExternalLink, X } from 'lucide-react'
import iconUrl from '../../../../resources/icon.png'
import { useEffect, useState } from 'react'
import type { LibraryListing, Settings } from '../../../shared/api'
import { applyFilter, resizeCanvas, resizeImage } from '../core/imageOps'
import { api } from '../core/platform'
import { Num } from './controls'
import { editor, useEditor } from './state'
import { TOOL_GROUPS } from './tools'

function Modal(props: {
  title: string
  onClose: () => void
  onSubmit?: () => void
  submitLabel?: string
  children: React.ReactNode
  wide?: boolean
}): React.JSX.Element {
  useEffect(() => {
    const key = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') props.onClose()
    }
    window.addEventListener('keydown', key)
    return () => window.removeEventListener('keydown', key)
  })
  return (
    <div className="modal-back" onMouseDown={(e) => e.target === e.currentTarget && props.onClose()}>
      <form
        className={props.wide ? 'modal wide' : 'modal'}
        onSubmit={(e) => {
          e.preventDefault()
          props.onSubmit?.()
        }}
      >
        <div className="modal-head">
          <span>{props.title}</span>
          <button type="button" className="icon-btn" onClick={props.onClose}>
            <X size={15} />
          </button>
        </div>
        <div className="modal-body">{props.children}</div>
        {props.onSubmit && (
          <div className="modal-foot">
            <button type="button" className="btn" onClick={props.onClose}>
              Cancel
            </button>
            <button type="submit" className="btn primary">
              {props.submitLabel ?? 'OK'}
            </button>
          </div>
        )}
      </form>
    </div>
  )
}

const close = (): void => editor.showDialog(null)

function NewDialog(): React.JSX.Element {
  const ed = useEditor()
  const [w, setW] = useState(1280)
  const [h, setH] = useState(720)
  const [bg, setBg] = useState<'white' | 'transparent' | 'secondary'>('white')
  const presets: [string, number, number][] = [
    ['HD', 1280, 720],
    ['Full HD', 1920, 1080],
    ['Square', 1080, 1080],
    ['Sprite 16', 16, 16],
    ['Sprite 32', 32, 32],
    ['Sprite 64', 64, 64]
  ]
  return (
    <Modal
      title="New image"
      submitLabel="Create"
      onClose={close}
      onSubmit={() => {
        close()
        ed.newDocument(w, h, bg === 'white' ? '#ffffff' : bg === 'secondary' ? ed.secondary : null)
      }}
    >
      <div className="preset-row">
        {presets.map(([name, pw, ph]) => (
          <button
            type="button"
            key={name}
            className={w === pw && h === ph ? 'chip on' : 'chip'}
            onClick={() => {
              setW(pw)
              setH(ph)
              if (pw <= 64) setBg('transparent')
            }}
          >
            {name}
            <small>
              {pw}×{ph}
            </small>
          </button>
        ))}
      </div>
      <div className="form-row">
        <Num label="Width" value={w} min={1} max={16384} slider={false} suffix="px" onChange={setW} />
        <Num label="Height" value={h} min={1} max={16384} slider={false} suffix="px" onChange={setH} />
      </div>
      <div className="form-row">
        <span className="form-label">Background</span>
        {(['white', 'transparent', 'secondary'] as const).map((k) => (
          <label className="radio" key={k}>
            <input type="radio" checked={bg === k} onChange={() => setBg(k)} />
            {k === 'white' ? 'White' : k === 'transparent' ? 'Transparent' : (
              <>
                <span className="mini-swatch" style={{ background: ed.secondary }} /> Secondary colour
              </>
            )}
          </label>
        ))}
      </div>
    </Modal>
  )
}

function ResizeDialog(): React.JSX.Element {
  const ed = useEditor()
  const d = ed.d!
  const [w, setW] = useState(d.width)
  const [h, setH] = useState(d.height)
  const [lock, setLock] = useState(true)
  const [smooth, setSmooth] = useState(!(d.width <= 256 && d.height <= 256))
  const aspect = d.width / d.height
  const setWidth = (v: number): void => {
    setW(v)
    if (lock) setH(Math.max(1, Math.round(v / aspect)))
  }
  const setHeight = (v: number): void => {
    setH(v)
    if (lock) setW(Math.max(1, Math.round(v * aspect)))
  }
  return (
    <Modal title="Resize image" onClose={close} submitLabel="Resize" onSubmit={() => (close(), resizeImage(ed, w, h, smooth))}>
      <div className="form-row">
        <Num label="Width" value={w} min={1} max={16384} slider={false} suffix="px" onChange={setWidth} />
        <Num label="Height" value={h} min={1} max={16384} slider={false} suffix="px" onChange={setHeight} />
      </div>
      <div className="form-row">
        <Num label="Scale" value={Math.round((w / d.width) * 1000) / 10} min={1} max={3200} slider={false} suffix="%" onChange={(p) => setWidth(Math.max(1, Math.round((d.width * p) / 100)))} />
        <div className="preset-row">
          {[25, 50, 200, 400].map((p) => (
            <button type="button" className="chip" key={p} onClick={() => (setW(Math.round((d.width * p) / 100)), setH(Math.round((d.height * p) / 100)))}>
              {p}%
            </button>
          ))}
        </div>
      </div>
      <label className="check">
        <input type="checkbox" checked={lock} onChange={(e) => setLock(e.target.checked)} /> Keep proportions
      </label>
      <div className="form-row">
        <span className="form-label">Resampling</span>
        <label className="radio">
          <input type="radio" checked={smooth} onChange={() => setSmooth(true)} /> Smooth (photos, screenshots)
        </label>
        <label className="radio">
          <input type="radio" checked={!smooth} onChange={() => setSmooth(false)} /> Nearest neighbour (pixel art)
        </label>
      </div>
    </Modal>
  )
}

function CanvasSizeDialog(): React.JSX.Element {
  const ed = useEditor()
  const d = ed.d!
  const [w, setW] = useState(d.width)
  const [h, setH] = useState(d.height)
  const [anchor, setAnchor] = useState({ x: 0.5, y: 0.5 })
  const [fill, setFill] = useState(false)
  const [pad, setPad] = useState(20)
  return (
    <Modal
      title="Canvas size"
      onClose={close}
      submitLabel="Apply"
      onSubmit={() => (close(), resizeCanvas(ed, w, h, anchor, fill ? ed.secondary : null))}
    >
      <div className="form-row">
        <Num label="Width" value={w} min={1} max={16384} slider={false} suffix="px" onChange={setW} />
        <Num label="Height" value={h} min={1} max={16384} slider={false} suffix="px" onChange={setH} />
      </div>
      <div className="form-row">
        <Num label="Padding" value={pad} min={0} max={2000} slider={false} suffix="px" onChange={setPad} />
        <button
          type="button"
          className="btn"
          onClick={() => {
            setW(d.width + pad * 2)
            setH(d.height + pad * 2)
            setAnchor({ x: 0.5, y: 0.5 })
          }}
        >
          Add on all sides
        </button>
      </div>
      <div className="form-row">
        <span className="form-label">Anchor</span>
        <div className="anchor-grid">
          {[0, 0.5, 1].map((y) =>
            [0, 0.5, 1].map((x) => (
              <button
                type="button"
                key={`${x}-${y}`}
                className={anchor.x === x && anchor.y === y ? 'on' : ''}
                onClick={() => setAnchor({ x, y })}
              />
            ))
          )}
        </div>
      </div>
      <label className="check">
        <input type="checkbox" checked={fill} onChange={(e) => setFill(e.target.checked)} /> Fill new area with
        <span className="mini-swatch" style={{ background: ed.secondary }} /> secondary colour
      </label>
    </Modal>
  )
}

function AdjustDialog(): React.JSX.Element {
  const ed = useEditor()
  const [v, setV] = useState({ brightness: 0, contrast: 0, saturation: 0, hue: 0, blur: 0 })
  const filter =
    `brightness(${1 + v.brightness / 100}) contrast(${1 + v.contrast / 100}) ` +
    `saturate(${1 + v.saturation / 100}) hue-rotate(${v.hue}deg)` +
    (v.blur ? ` blur(${v.blur}px)` : '')
  useEffect(() => {
    const d = ed.d
    const l = ed.activeLayer()
    if (!d || !l) return
    d.live.previewFilter = { layerId: l.id, filter }
    ed.invalidate()
  }, [ed, filter])
  useEffect(
    () => () => {
      if (ed.d) ed.d.live.previewFilter = null
      ed.invalidate()
    },
    [ed]
  )
  const row = (k: keyof typeof v, label: string, min: number, max: number, suffix = ''): React.JSX.Element => (
    <Num label={label} value={v[k]} min={min} max={max} suffix={suffix} onChange={(n) => setV({ ...v, [k]: n })} />
  )
  return (
    <Modal
      title={`Adjust colours: ${ed.activeLayer()?.name ?? ''}${ed.d?.selection ? ' (selection)' : ''}`}
      onClose={close}
      submitLabel="Apply"
      onSubmit={() => {
        if (ed.d) ed.d.live.previewFilter = null
        close()
        applyFilter(ed, filter, 'Adjust colours')
      }}
    >
      <div className="adjust-rows">
        {row('brightness', 'Brightness', -100, 100)}
        {row('contrast', 'Contrast', -100, 100)}
        {row('saturation', 'Saturation', -100, 100)}
        {row('hue', 'Hue', -180, 180, '°')}
        {row('blur', 'Blur', 0, 40, 'px')}
      </div>
      <button type="button" className="btn" onClick={() => setV({ brightness: 0, contrast: 0, saturation: 0, hue: 0, blur: 0 })}>
        Reset
      </button>
    </Modal>
  )
}

function acceleratorFrom(e: KeyboardEvent): string | null {
  const mods: string[] = []
  if (e.ctrlKey) mods.push('CommandOrControl')
  if (e.altKey) mods.push('Alt')
  if (e.shiftKey) mods.push('Shift')
  if (e.metaKey) mods.push('Super')
  const k = e.key
  if (['Control', 'Alt', 'Shift', 'Meta'].includes(k)) return null
  let key: string
  if (k === 'PrintScreen') key = 'PrintScreen'
  else if (/^F\d{1,2}$/.test(k)) key = k
  else if (k.length === 1) key = k === ' ' ? 'Space' : k.toUpperCase()
  else if (['Insert', 'Delete', 'Home', 'End', 'PageUp', 'PageDown', 'Pause', 'ScrollLock'].includes(k)) key = k
  else return null
  if (!mods.length && key.length === 1) return null
  return [...mods, key].join('+')
}

const pretty = (a: string): string => a.replace('CommandOrControl', 'Ctrl').replace(/\+/g, ' + ')

function SettingsDialog(): React.JSX.Element {
  const ed = useEditor()
  const [s, setS] = useState<Settings | null>(null)
  const [recording, setRecording] = useState(false)
  const [error, setError] = useState('')
  const [lib, setLib] = useState<LibraryListing | null>(null)
  useEffect(() => {
    void api?.getSettings().then(setS)
    void api?.listLibrary().then(setLib)
  }, [])
  useEffect(() => {
    if (!recording) return
    const handler = (e: KeyboardEvent): void => {
      e.preventDefault()
      e.stopPropagation()
      if (e.key === 'Escape') return setRecording(false)
      // PrintScreen only arrives as keyup on Windows
      if (e.type === 'keydown' && e.key === 'PrintScreen') return
      if (e.type === 'keyup' && e.key !== 'PrintScreen') return
      const acc = acceleratorFrom(e)
      if (acc) {
        setS((prev) => (prev ? { ...prev, hotkey: acc } : prev))
        setRecording(false)
      }
    }
    window.addEventListener('keydown', handler, true)
    window.addEventListener('keyup', handler, true)
    return () => {
      window.removeEventListener('keydown', handler, true)
      window.removeEventListener('keyup', handler, true)
    }
  }, [recording])
  if (!api) {
    return (
      <Modal title="Settings" onClose={close}>
        <p>Settings are available in the desktop app.</p>
      </Modal>
    )
  }
  return (
    <Modal
      title="Settings"
      onClose={close}
      submitLabel="Save"
      onSubmit={async () => {
        if (!s) return
        const r = await api!.setSettings(s)
        if (!r.ok) return setError(r.error ?? 'Could not save settings')
        ed.wheelZooms = s.wheelZoom
        close()
        ed.notify('Settings saved')
      }}
    >
      {s && (
        <>
          <div className="form-row">
            <span className="form-label">Capture hotkey</span>
            <button type="button" className={recording ? 'hotkey recording' : 'hotkey'} onClick={() => setRecording(true)}>
              {recording ? 'Press a key combination…' : s.hotkey ? pretty(s.hotkey) : 'None'}
            </button>
            <button type="button" className="btn" onClick={() => setS({ ...s, hotkey: '' })}>
              Clear
            </button>
          </div>
          <p className="form-note">Works from anywhere while the app is running (it lives in the system tray).</p>
          <label className="check">
            <input type="checkbox" checked={s.captureAdjust} onChange={(e) => setS({ ...s, captureAdjust: e.target.checked })} />
            Adjust a dragged region before capturing it
          </label>
          <p className="form-note">
            Arrow keys move the bottom-right corner and Shift+arrows the top-left (hold Ctrl for 10 px). Drag the edges or the
            middle to adjust, then press Enter or double-click to capture. Turn this off to capture as soon as you let go.
          </p>
          <label className="check">
            <input type="checkbox" checked={s.autoSaveCaptures} onChange={(e) => setS({ ...s, autoSaveCaptures: e.target.checked })} />
            Save every capture to the library automatically
          </label>
          <div className="form-row">
            <span className="form-label">Library folder</span>
            <span className="folder-path" title={s.captureFolder || lib?.folder}>
              {s.captureFolder || (lib ? `${lib.folder} (default)` : 'Default')}
            </span>
            <button
              type="button"
              className="btn"
              onClick={async () => {
                const dir = await api!.chooseFolder(s.captureFolder)
                if (dir) setS({ ...s, captureFolder: dir })
              }}
            >
              Change…
            </button>
            {s.captureFolder && (
              <button type="button" className="btn" onClick={() => setS({ ...s, captureFolder: '' })}>
                Default
              </button>
            )}
          </div>
          {lib?.blocked && (
            <div className="form-warning">
              <p>
                Windows is blocking the app from saving to <b>{lib.blocked}</b> (Controlled folder access), so captures are
                going to <b>{lib.folder}</b>.
              </p>
              <p>
                To use it, open Windows Security → Virus &amp; threat protection → Ransomware protection → Allow an app
                through Controlled folder access, add <code>{lib.exePath}</code>, then click Try again.
              </p>
              <button
                type="button"
                className="btn"
                onClick={async () => {
                  const r = await api!.retryLibraryFolder()
                  if (r.ok) ed.notify(`Captures will be saved to ${r.folder}`, 6000)
                  else ed.warn('Still blocked by Windows')
                  setLib(await api!.listLibrary())
                }}
              >
                Try again
              </button>
            </div>
          )}
          <label className="check">
            <input type="checkbox" checked={s.wheelZoom} onChange={(e) => setS({ ...s, wheelZoom: e.target.checked })} />
            Mouse wheel zooms the canvas
          </label>
          <p className="form-note">
            Hold Alt to scroll with the wheel instead, or Shift to scroll sideways. Turn this off if you use a trackpad: the
            wheel then scrolls, and Ctrl+wheel or pinching zooms.
          </p>
          <label className="check">
            <input type="checkbox" checked={s.copyOnCapture} onChange={(e) => setS({ ...s, copyOnCapture: e.target.checked })} />
            Also copy every capture to the clipboard
          </label>
          <label className="check">
            <input type="checkbox" checked={s.closeToTray} onChange={(e) => setS({ ...s, closeToTray: e.target.checked })} />
            Closing the window keeps the app running in the tray
          </label>
          <label className="check">
            <input type="checkbox" checked={s.openAtLogin} onChange={(e) => setS({ ...s, openAtLogin: e.target.checked })} />
            Start with Windows (in the tray, ready for the capture hotkey)
          </label>
          {error && <p className="form-error">{error}</p>}
        </>
      )}
    </Modal>
  )
}

const SHORTCUTS: [string, string][] = [
  ['Undo / Redo', 'Ctrl+Z / Ctrl+Y'],
  ['Copy / Cut / Paste', 'Ctrl+C / Ctrl+X / Ctrl+V'],
  ['Copy finished image', 'Ctrl+Shift+C'],
  ['Save / Save as', 'Ctrl+S / Ctrl+Shift+S'],
  ['Duplicate', 'Ctrl+J, or Alt-drag'],
  ['Delete', 'Del'],
  ['Select all / Deselect', 'Ctrl+A / Ctrl+D'],
  ['Invert selection', 'Ctrl+Shift+I'],
  ['Add to / subtract from selection', 'Hold Shift / Alt'],
  ['Free transform', 'Ctrl+T (Enter applies, Esc cancels)'],
  ['Nudge', 'Arrow keys (Shift ×10)'],
  ['Brush / stroke size', '[ and ]'],
  ['Swap colours / Reset colours', 'X / D'],
  ['Pick colour while painting', 'Hold Alt'],
  ['Pan', 'Space-drag or middle-drag; Alt+wheel, Shift+wheel sideways'],
  ['Zoom', 'Mouse wheel (see Settings), Ctrl+= / Ctrl+-'],
  ['Fit / Actual size', 'Ctrl+0 / Ctrl+1'],
  ['Pixel grid', "Ctrl+'"],
  ['Merge layer down', 'Ctrl+E'],
  ['New pixel layer', 'Ctrl+Shift+N'],
  ['Adjust colours / Invert', 'Ctrl+U / Ctrl+I'],
  ['Resize image / Canvas size', 'Ctrl+Alt+I / Ctrl+Alt+C']
]

function ShortcutsDialog(): React.JSX.Element {
  return (
    <Modal title="Keyboard shortcuts" onClose={close} wide>
      <div className="shortcuts">
        <div>
          <h4>Tools</h4>
          {TOOL_GROUPS.flat()
            .filter((t) => t.key)
            .map((t) => (
              <div className="sc-row" key={t.id}>
                <span>{t.label}</span>
                <kbd>{t.key}</kbd>
              </div>
            ))}
        </div>
        <div>
          <h4>Editing</h4>
          {SHORTCUTS.map(([a, b]) => (
            <div className="sc-row" key={a}>
              <span>{a}</span>
              <kbd>{b}</kbd>
            </div>
          ))}
        </div>
      </div>
    </Modal>
  )
}

const PROJECT_URL = 'https://github.com/jambalayadog/CaptureMarkupTool'

/** "Electron 44.5.1 · Chromium 140.0.1" from the user agent (useful in bug reports). */
function runtimeVersions(): string {
  const ua = navigator.userAgent
  const electron = /Electron\/([\d.]+)/.exec(ua)?.[1]
  const chrome = /Chrome\/([\d.]+)/.exec(ua)?.[1]
  return [electron && `Electron ${electron}`, chrome && `Chromium ${chrome}`].filter(Boolean).join(' · ') || ua
}

function AboutDialog(): React.JSX.Element {
  return (
    <Modal title="About" onClose={close}>
      <div className="about">
        <img src={iconUrl} alt="" width={64} height={64} />
        <h2>Capture Markup Tool</h2>
        <div className="about-version">Version {__APP_VERSION__}</div>
        <p>Capture, annotate, paint. Every arrow and label stays editable.</p>
        <button
          type="button"
          className="btn"
          onClick={() => (api ? api.openProjectPage() : window.open(PROJECT_URL, '_blank', 'noopener'))}
        >
          <ExternalLink size={14} /> Project page on GitHub
        </button>
        <div className="about-meta">
          <div>MIT License · © 2026 jw</div>
          <div>{runtimeVersions()}</div>
        </div>
      </div>
    </Modal>
  )
}

export function Dialogs(): React.JSX.Element | null {
  const ed = useEditor()
  switch (ed.dialog) {
    case 'new':
      return <NewDialog />
    case 'resize':
      return ed.d ? <ResizeDialog /> : null
    case 'canvasSize':
      return ed.d ? <CanvasSizeDialog /> : null
    case 'adjust':
      return ed.d ? <AdjustDialog /> : null
    case 'settings':
      return <SettingsDialog />
    case 'shortcuts':
      return <ShortcutsDialog />
    case 'about':
      return <AboutDialog />
    default:
      return null
  }
}
