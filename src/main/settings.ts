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

/** Where captures are saved. MARKUP_CAPTURE_DIR overrides it in development (for tests). */
export function captureFolder(s: Settings): string {
  const override = process.env['MARKUP_CAPTURE_DIR']
  if (override && !app.isPackaged) return override
  return s.captureFolder || join(app.getPath('pictures'), 'Markup')
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
