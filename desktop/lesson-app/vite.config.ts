import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
// Relative asset paths (./assets/...) are required for Tauri extra webviews: absolute "/assets" often fails
// to load in secondary windows, which shows as a blank white page with no React mount.
export default defineConfig({
  base: './',
  plugins: [react()],
  server: {
    host: '127.0.0.1',
    port: 5173,
    strictPort: true,
  },
})
