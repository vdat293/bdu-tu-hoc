import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  root: 'client',
  plugins: [react()],
  publicDir: false,
  build: {
    outDir: '../dist/client',
    emptyOutDir: true,
    assetsDir: 'app-assets',
    rollupOptions: {
      output: {
        manualChunks: {
          react: ['react', 'react-dom', 'react-router-dom'],
          query: ['@tanstack/react-query']
        }
      }
    }
  },
  server: {
    port: 5173,
    strictPort: true,
    proxy: {
      '/api': { target: 'http://localhost:3000', changeOrigin: false },
      '/media': { target: 'http://localhost:3000', changeOrigin: false },
      '/assets': { target: 'http://localhost:3000', changeOrigin: false },
      '/css': { target: 'http://localhost:3000', changeOrigin: false },
      '/admin-tool': { target: 'http://localhost:3000', changeOrigin: false },
      '/ws': { target: 'ws://localhost:3000', ws: true, changeOrigin: false }
    }
  }
});
