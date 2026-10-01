// Runs the editor UI in a plain browser (no Electron) for quick iteration.
// Screen capture falls back to the browser's screen-share picker.
import { readFileSync } from 'fs'
import { resolve } from 'path'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

const { version } = JSON.parse(readFileSync(resolve(__dirname, 'package.json'), 'utf8')) as { version: string }

export default defineConfig({
  root: resolve(__dirname, 'src/renderer'),
  define: { __APP_VERSION__: JSON.stringify(version) },
  plugins: [react()],
  server: { port: 5199, strictPort: true }
})
