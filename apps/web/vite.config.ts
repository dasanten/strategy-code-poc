import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  resolve: { conditions: ['source'] },
  // PixiJS alone is most of the bundle; code splitting can come later.
  build: { chunkSizeWarningLimit: 1500 },
  server: {
    port: 5173,
    proxy: {
      '/api': 'http://127.0.0.1:3000',
      '/ws': { target: 'ws://127.0.0.1:3000', ws: true },
    },
  },
})
