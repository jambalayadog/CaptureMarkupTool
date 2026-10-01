import { app } from 'electron'
import { autoUpdater } from 'electron-updater'
import type { UpdateStatus } from '../shared/api'

const FIRST_CHECK = 20_000
const CHECK_EVERY = 4 * 60 * 60 * 1000

/**
 * Keeps the installed app up to date from the project's GitHub Releases: checks
 * shortly after startup and every few hours, downloads in the background, and
 * installs when the app quits (or straight away if the user asks). Development
 * builds never update themselves.
 */
export class Updater {
  /** A downloaded version waiting to be installed. */
  ready: string | null = null
  private downloading: string | null = null

  constructor(private onReady: (version: string) => void) {
    if (!app.isPackaged) return
    autoUpdater.autoDownload = true
    autoUpdater.autoInstallOnAppQuit = true
    autoUpdater.on('update-available', (info) => {
      this.downloading = info.version
    })
    autoUpdater.on('update-downloaded', (info) => {
      this.downloading = null
      this.ready = info.version
      this.onReady(info.version)
    })
    autoUpdater.on('error', (err) => {
      this.downloading = null
      console.warn('[update]', err)
    })
  }

  start(): void {
    if (!app.isPackaged) return
    setTimeout(() => void this.check(), FIRST_CHECK)
    setInterval(() => void this.check(), CHECK_EVERY)
  }

  async check(): Promise<UpdateStatus> {
    const current = app.getVersion()
    if (!app.isPackaged) return { state: 'dev', current }
    if (this.ready) return { state: 'ready', current, version: this.ready }
    if (this.downloading) return { state: 'downloading', current, version: this.downloading }
    try {
      const r = await autoUpdater.checkForUpdates()
      const latest = r?.updateInfo.version
      if (r?.isUpdateAvailable && latest) return { state: 'downloading', current, version: latest }
      return { state: 'latest', current }
    } catch (err) {
      return { state: 'error', current, error: (err as Error).message }
    }
  }

  /** Quit and install the downloaded update, then start the new version. */
  install(): void {
    if (this.ready) autoUpdater.quitAndInstall(true, true)
  }
}
