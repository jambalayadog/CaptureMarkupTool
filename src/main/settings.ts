import { app } from 'electron'
import { join } from 'path'
import { readFileSync, writeFileSync } from 'fs'
import type { Settings } from '../shared/api'

export const DEFAULT_SETTINGS: Settings = {
  hotkey: 'CommandOrControl+PrintScreen',
  copyOnCapture: false,
  closeToTray: true,
  autoSaveCaptures: true,
  captureFolder: '',
  blockedFolder: ''
}

/**
 * Default capture folder: %USERPROFILE%\CaptureMarkupTool\Images. It's in the
 * user's own folder, so Windows' Controlled Folder Access (which guards
 * Pictures, Videos, Documents and Desktop) never blocks it. Videos can live
 * alongside it in CaptureMarkupTool\Videos later.
 * CMT_CAPTURE_DIR overrides it in development (for tests).
 */
export function defaultCaptureFolder(): string {
  const override = process.env['CMT_CAPTURE_DIR']
  if (override && !app.isPackaged) return override
  return join(app.getPath('home'), 'CaptureMarkupTool', 'Images')
}

/** Where captures are saved: the folder picked in Settings, or the default. */
export function captureFolder(s: Settings): string {
  return s.captureFolder || defaultCaptureFolder()
}

const file = (): string => join(app.getPath('userData'), 'settings.json')

export function loadSettings(): Settings {
  try {
    return { ...DEFAULT_SETTINGS, ...JSON.parse(readFileSync(file(), 'utf8')) }
  } catch {
    return { ...DEFAULT_SETTINGS }
  }
}

export function saveSettings(s: Settings): void {
  writeFileSync(file(), JSON.stringify(s, null, 2))
}
