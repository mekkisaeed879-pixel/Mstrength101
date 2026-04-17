import { defineConfig } from 'vite'

export default defineConfig({
  server: {
    host: '0.0.0.0',
    port: 5173,
    middlewareMode: false,
    allowedHosts: [
      '5173-iyl63er6ibko3nron7qc9-43e284af.us2.manus.computer',
      'localhost',
      '127.0.0.1'
    ],
    proxy: {
      '/api': {
        target: 'http://localhost:3000',
        changeOrigin: true
      }
    }
  }
})
