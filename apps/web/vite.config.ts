import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// The game server's port (`PORT`, as the server reads it), so two checkouts can run side by side.
const SERVER_PORT = process.env.PORT ?? 3000

export default defineConfig({
  plugins: [react()],
  resolve: { conditions: ['source'] },
  // One .env at the repo root serves server and client.
  envDir: '../..',
  // PixiJS alone is most of the bundle; code splitting can come later.
  build: { chunkSizeWarningLimit: 1500 },
  server: {
    port: 5173,
    proxy: {
      '/api': `http://127.0.0.1:${SERVER_PORT}`,
      '/ws': { target: `ws://127.0.0.1:${SERVER_PORT}`, ws: true },
    },
  },
})
