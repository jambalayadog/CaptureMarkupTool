# Markup

A layered image markup editor for Windows, somewhere between Snipping Tool, Snagit, Greenshot, Aseprite and a very small Photoshop.

- **Capture**: global hotkey (default **Ctrl+PrintScreen**) freezes every display. Drag a region, click a window, or press Enter for the whole screen. It lives in the system tray.
- **Annotate**: arrows, lines, rectangles, ellipses, text, callouts, numbered steps, highlighter, and blur/pixelate/solid redaction. They stay editable: select one to move it, resize it, or restyle it from the options bar.
- **Paint**: anti-aliased brush with pen pressure, a pixel pencil with pixel-perfect lines, eraser, flood fill, eyedropper and a pixel grid at 800% and up. It comes with palettes (PICO-8, Endesga 32 and others).
- **Photo basics**: crop (drag past the edge to add space), resize, canvas size and padding, rotate and flip, brightness, contrast, saturation, hue and blur, rectangle selections, copy and paste.
- **Layers**: pixel layers and annotation layers, with opacity, blend modes, lock, reorder, merge down, rasterize and flatten.
- Tabs for multiple images, full undo/redo, and drag and drop.

## Running

```bash
npm install
npm run dev        # Electron app with hot reload for the UI
npm run dev:web    # just the editor UI in a browser at http://localhost:5199
npm run typecheck
npm run dist       # Windows installer in dist/
```

In development, **F12** opens DevTools and **F5** reloads. By default, closing the window hides Markup to the tray so the capture hotkey keeps working. Use the tray menu's **Quit** item, or turn that off in *File → Settings*.

## Files

- **.png / .jpg / .webp** are flattened images.
- **.imk** is a Markup project that keeps layers and editable annotations. It's JSON with PNG data for the pixel layers.

Redaction objects are applied when you export a flattened image. In an `.imk` project the original pixels are still stored under the redaction so it stays editable, so share the PNG, not the project.

## Code layout

| Path | What's there |
| --- | --- |
| `src/main/` | Electron main process: windows, tray, hotkey, IPC, settings |
| `src/main/capture.ts` | Freezes displays and drives the per-display overlay windows |
| `src/main/windows.ts` | Win32 window enumeration (via koffi) so capture can snap to windows |
| `src/preload/`, `src/shared/api.ts` | The typed bridge between main and the pages |
| `src/renderer/capture/` | The capture overlay page |
| `src/renderer/src/core/` | Editor engine: document model, history, compositing, objects, image ops, file I/O |
| `src/renderer/src/tools/` | One module per tool (pointer handling and overlays) |
| `src/renderer/src/ui/` | React UI: menus, tool rail, options bar, color and layer panels, dialogs |

A few design notes:

- `Editor` (`core/editor.ts`) owns all state. React only subscribes to it, and the canvas is drawn imperatively.
- Undo stores a structural snapshot, where pixel canvases are shared by reference and annotation objects are cloned, plus pixel patches for the dirty rectangle of each raster edit. That keeps memory small even for 4K screenshots.
- An annotation layer at 100% opacity and Normal blend draws straight onto the composite. That's what lets the highlighter multiply over the screenshot and lets redaction sample whatever is underneath.
