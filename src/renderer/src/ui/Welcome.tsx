import { Camera, ClipboardPaste, FilePlus, FolderOpen } from 'lucide-react'
import { useEffect, useState } from 'react'
import { decodeImage } from '../core/io'
import { api, readClipboardImage } from '../core/platform'
import { startCapture } from './App'
import { useEditor } from './state'

export function Welcome(): React.JSX.Element {
  const ed = useEditor()
  const [hotkey, setHotkey] = useState<string | null>(null)
  useEffect(() => {
    void api?.getSettings().then((s) => setHotkey(s.hotkey.replace('CommandOrControl', 'Ctrl').replace(/\+/g, ' + ')))
  }, [])

  const paste = async (): Promise<void> => {
    const blob = await readClipboardImage()
    if (!blob) return ed.notify('No image on the clipboard')
    ed.openCanvas(await decodeImage(blob), 'Pasted image')
  }

  return (
    <div className="welcome">
      <div className="welcome-card">
        <h1>Capture Markup Tool</h1>
        <p className="welcome-sub">Capture, annotate, paint. Every arrow and label stays editable.</p>
        <div className="welcome-actions">
          <button className="big-btn accent" onClick={() => void startCapture()}>
            <Camera size={22} />
            <span>New capture</span>
            {hotkey && <small>{hotkey}</small>}
          </button>
          <button className="big-btn" onClick={() => void ed.openFilesDialog()}>
            <FolderOpen size={22} />
            <span>Open image</span>
            <small>Ctrl + O</small>
          </button>
          <button className="big-btn" onClick={() => void paste()}>
            <ClipboardPaste size={22} />
            <span>From clipboard</span>
            <small>Ctrl + V</small>
          </button>
          <button className="big-btn" onClick={() => ed.showDialog('new')}>
            <FilePlus size={22} />
            <span>Blank canvas</span>
            <small>Ctrl + N</small>
          </button>
        </div>
        <p className="welcome-tip">You can also drop image files anywhere in this window.</p>
      </div>
    </div>
  )
}
