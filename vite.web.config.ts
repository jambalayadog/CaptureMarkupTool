// Runs the editor UI in a plain browser (no Electron) for quick iteration.
// Screen capture falls back to the browser's screen-share picker.
import { resolve } from 'path'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  root: resolve(__dirname, 'src/renderer'),
  plugins: [react()],
  server: { port: 5199, strictPort: true }
})
