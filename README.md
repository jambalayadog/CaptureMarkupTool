# Capture Markup Tool

A layered screenshot and image markup editor for Windows, somewhere between Snipping Tool, Snagit, Greenshot, Aseprite and a very small Photoshop.

- **Capture**: global hotkey (default **Ctrl+PrintScreen**) freezes every display. Drag a region, click a window, or press Enter for the whole screen. It lives in the system tray.
- **Capture library**: every capture is saved to `%USERPROFILE%\CaptureMarkupTool\Images` (configurable in Settings) and shows up in the *Recent captures* strip under the canvas. Click one to reopen it, drag it straight into Slack or email, or right-click to copy, show it in the folder, or send it to the Recycle Bin. Ctrl+S on a capture updates its library file. The default folder avoids Pictures and Videos on purpose: Windows' Controlled folder access guards those from unrecognized apps. If you pick a folder in Settings that Windows blocks, captures fall back to the default and Settings explains why.
- **Annotate**: arrows, lines, rectangles, ellipses, text, callouts, numbered steps, highlighter, and blur/pixelate/solid redaction. They stay editable: select one to move it, resize it, or restyle it from the options bar.
- **Paint**: anti-aliased brush with pen pressure, a pixel pencil with pixel-perfect lines, eraser, flood fill, eyedropper and a pixel grid at 800% and up. It comes with palettes (PICO-8, Endesga 32 and others).
- **Selections**: rectangle (M), lasso (Q: drag freehand, or click point by point) and magic wand (W). Hold Shift to add, Alt to subtract, both to intersect, or pick a mode in the options bar. Brushes, fill, clear, copy and adjustments all respect the selection's exact shape. Ctrl+Shift+I inverts it.
- **Free transform** (Ctrl+T): scale, rotate, move and flip a pixel layer, or just the selected pixels. Shift keeps proportions or snaps rotation to 15°, and Alt scales from the centre. Turn Smooth off to keep hard pixel edges for pixel art. Enter applies and Esc cancels.
- **Photo basics**: crop (drag past the edge to add space), resize, canvas size and padding, rotate and flip, brightness, contrast, saturation, hue and blur, copy and paste.
- **Layers**: pixel layers and annotation layers, with opacity, blend modes, lock, reorder, merge down, rasterize and flatten.
- Tabs for multiple images, full undo/redo, and drag and drop.

## Install

Windows 10 or 11 (64-bit). Download `Capture Markup Tool Setup <version>.exe` from the [Releases page](https://github.com/jambalayadog/CaptureMarkupTool/releases) and run it. It installs just for you, with no admin prompt, and adds a Start menu shortcut. Uninstall it from *Settings → Apps* like anything else.

The installer isn't code-signed, so Windows SmartScreen will say it *protected your PC* the first time. Click **More info → Run anyway**.

Closing the window keeps the app in the system tray so the capture hotkey keeps working. Quit from the tray icon's menu. *File → Settings* has **Start with Windows**, which starts it quietly in the tray when you sign in.

## Running from source

```bash
npm install
npm run dev        # Electron app with hot reload for the UI
npm run dev:web    # just the editor UI in a browser at http://localhost:5199
npm run typecheck
npm run dist       # Windows installer in dist/
```

To start the dev app without a terminal window, double-click `scripts\start-dev.vbs` (output goes to `dev.log`). If the app is already running, it just brings the window up. Launching it through Explorer also avoids a quirk: apps started from inside another packaged app (such as the Claude desktop app) have their AppData writes silently redirected into that app's private folder.

The dev build can be pinned to the taskbar and set to start with Windows too. Both go through `start-dev.vbs`, so they keep running your latest source.

In development, **F12** opens DevTools and **F5** reloads. By default, closing the window hides the app to the tray so the capture hotkey keeps working. Use the tray menu's **Quit** item, or turn that off in *File → Settings*. Settings and caches live in `%APPDATA%\CaptureMarkupTool`.

Development-only hooks, all ignored in packaged builds:

- `CMT_CAPTURE_DIR=<folder>` sends captures to a scratch folder instead of your real library.
- `electron . --capture-test` runs the whole capture pipeline on a 64×64 corner of the primary display, without showing the overlay.
- `electron . --debug-shot=<file.png>` saves a PNG of the editor window's own contents.

## Files

- **.png / .jpg / .webp** are flattened images.
- **.imk** is a Capture Markup Tool project that keeps layers and editable annotations. It's JSON with PNG data for the pixel layers.

Redaction objects are applied when you export a flattened image. In an `.imk` project the original pixels are still stored under the redaction so it stays editable, so share the PNG, not the project.

## Code layout

| Path | What's there |
| --- | --- |
| `src/main/` | Electron main process: windows, tray, hotkey, IPC, settings |
| `src/main/capture.ts` | Freezes displays and drives the per-display overlay windows |
| `src/main/windows.ts` | Win32 window enumeration (via koffi) so capture can snap to windows |
| `src/main/library.ts` | The capture library: auto-save, listing with cached thumbnails, folder watching |
| `src/preload/`, `src/shared/api.ts` | The typed bridge between main and the pages |
| `src/renderer/capture/` | The capture overlay page |
| `src/renderer/src/core/` | Editor engine: document model, history, compositing, objects, selections, image ops, file I/O |
| `src/renderer/src/tools/` | One module per tool (pointer handling and overlays) |
| `src/renderer/src/ui/` | React UI: menus, tool rail, options bar, color and layer panels, dialogs |

A few design notes:

- `Editor` (`core/editor.ts`) owns all state. React only subscribes to it, and the canvas is drawn imperatively.
- Undo stores a structural snapshot, where pixel canvases are shared by reference and annotation objects are cloned, plus pixel patches for the dirty rectangle of each raster edit. That keeps memory small even for 4K screenshots.
- A selection is its bounding rectangle plus an optional alpha mask, so rectangles stay cheap and lasso or wand shapes are exact. Masks are immutable, which lets the marching-ants outline be traced once and cached.
- Free transform only previews until it's applied, so cancelling costs nothing. Applying writes a new layer canvas, and undo restores the old one.
- An annotation layer at 100% opacity and Normal blend draws straight onto the composite. That's what lets the highlighter multiply over the screenshot and lets redaction sample whatever is underneath.

## License

[MIT](LICENSE)
