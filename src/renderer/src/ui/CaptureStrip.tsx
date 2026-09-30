import { ChevronDown, ChevronUp, FolderOpen } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import type { LibraryItem, LibraryListing } from '../../../shared/api'
import { api } from '../core/platform'
import { useEditor } from './state'

const KEY = 'markup.strip'

function loadCollapsed(): boolean {
  try {
    return localStorage.getItem(KEY) === 'collapsed'
  } catch {
    return false
  }
}

function saveCollapsed(v: boolean): void {
  try {
    localStorage.setItem(KEY, v ? 'collapsed' : 'open')
  } catch {
    // storage unavailable: the strip just forgets
  }
}

function ago(mtime: number): string {
  const s = (Date.now() - mtime) / 1000
  if (s < 60) return 'now'
  if (s < 3600) return `${Math.floor(s / 60)}m`
  if (s < 86400) return `${Math.floor(s / 3600)}h`
  if (s < 86400 * 7) return new Date(mtime).toLocaleDateString(undefined, { weekday: 'short' })
  return new Date(mtime).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}

/** Windows paths: case-insensitive, either slash. */
const normPath = (p: string): string => p.replace(/\//g, '\\').toLowerCase()
const samePath = (a: string, b: string): boolean => normPath(a) === normPath(b)

function ItemMenu(props: { x: number; y: number; onClose: () => void; items: [string, () => void][] }): React.JSX.Element {
  useEffect(() => {
    const close = (): void => props.onClose()
    const key = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') props.onClose()
    }
    window.addEventListener('mousedown', close)
    window.addEventListener('keydown', key)
    window.addEventListener('blur', close)
    return () => {
      window.removeEventListener('mousedown', close)
      window.removeEventListener('keydown', key)
      window.removeEventListener('blur', close)
    }
  })
  // keep the menu on screen
  const left = Math.min(props.x, window.innerWidth - 210)
  const top = Math.min(props.y, window.innerHeight - props.items.length * 30 - 16)
  return (
    <div className="menu-drop context-menu" style={{ left, top }} onMouseDown={(e) => e.stopPropagation()}>
      {props.items.map(([label, action]) => (
        <button
          key={label}
          className="menu-item"
          onClick={() => {
            props.onClose()
            action()
          }}
        >
          <span className="menu-check" />
          <span className="menu-label">{label}</span>
        </button>
      ))}
    </div>
  )
}

/** Snagit-style tray of recent captures (desktop app only). */
export function CaptureStrip(): React.JSX.Element | null {
  const ed = useEditor()
  const [listing, setListing] = useState<LibraryListing | null>(null)
  const [collapsed, setCollapsed] = useState(loadCollapsed)
  const [menu, setMenu] = useState<{ x: number; y: number; item: LibraryItem } | null>(null)

  const refresh = useCallback(() => {
    void api?.listLibrary().then(setListing)
  }, [])

  useEffect(() => {
    if (!api) return
    refresh()
    const off = api.onLibraryChanged(refresh)
    window.addEventListener('focus', refresh)
    return () => {
      off()
      window.removeEventListener('focus', refresh)
    }
  }, [refresh])

  if (!api || !listing) return null
  const lib = api
  const items = listing.items

  const openItem = async (item: LibraryItem): Promise<void> => {
    const doc = ed.docs.find((d) => d.filePath && samePath(d.filePath, item.path))
    if (doc) return ed.activate(doc.id)
    const f = await lib.readFile(item.path)
    if (f) await ed.openFiles([f])
    else ed.notify(`Couldn't open ${item.name}`)
  }

  const toggle = (): void => {
    setCollapsed(!collapsed)
    saveCollapsed(!collapsed)
  }

  return (
    <div className={collapsed ? 'strip collapsed' : 'strip'}>
      <div className="strip-head">
        <button className="strip-toggle" onClick={toggle} title={collapsed ? 'Show recent captures' : 'Hide recent captures'}>
          {collapsed ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
          <span>Recent captures</span>
          <span className="strip-count">{items.length}</span>
        </button>
        <div className="spacer" />
        <button className="icon-btn small" title={`Open the capture folder\n${listing.folder}`} onClick={() => lib.openLibraryFolder()}>
          <FolderOpen size={14} />
        </button>
      </div>
      {!collapsed && (
        <div
          className="strip-body"
          onWheel={(e) => {
            e.currentTarget.scrollLeft += e.deltaY + e.deltaX
          }}
        >
          {items.length === 0 && (
            <div className="strip-empty">Captures are saved to {listing.folder} and appear here. Drag one into another app to share it.</div>
          )}
          {items.map((item) => {
            const open = ed.docs.some((d) => d.filePath && samePath(d.filePath, item.path))
            return (
              <button
                key={item.path}
                className={open ? 'shot open' : 'shot'}
                title={`${item.name}\n${new Date(item.mtime).toLocaleString()}\nClick to open · drag into other apps · right-click for more`}
                onClick={() => void openItem(item)}
                onContextMenu={(e) => {
                  e.preventDefault()
                  setMenu({ x: e.clientX, y: e.clientY, item })
                }}
                draggable
                onDragStart={(e) => {
                  e.preventDefault()
                  lib.startDrag(item.path)
                }}
              >
                {item.thumb ? <img src={item.thumb} alt="" draggable={false} /> : <span className="shot-missing">?</span>}
                <span className="shot-time">{ago(item.mtime)}</span>
              </button>
            )
          })}
        </div>
      )}
      {menu && (
        <ItemMenu
          x={menu.x}
          y={menu.y}
          onClose={() => setMenu(null)}
          items={[
            ['Open', () => void openItem(menu.item)],
            [
              'Copy image',
              () =>
                void lib.copyFile(menu.item.path).then((ok) => ed.notify(ok ? 'Copied image to clipboard' : "Couldn't copy that image"))
            ],
            ['Show in folder', () => lib.revealFile(menu.item.path)],
            [
              'Move to Recycle Bin',
              () =>
                void lib.trashFile(menu.item.path).then((ok) => {
                  ed.notify(ok ? `Moved ${menu.item.name} to the Recycle Bin` : "Couldn't delete that file")
                  refresh()
                })
            ]
          ]}
        />
      )}
    </div>
  )
}
