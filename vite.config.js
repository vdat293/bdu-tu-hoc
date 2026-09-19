import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Docker build context excludes .git, so the build id cannot be a git SHA.
// A timestamp keeps each image distinct; CI/VPS can pin BUILD_ID explicitly.
const BUILD_ID = String(process.env.BUILD_ID || '').trim() || new Date().toISOString().replace(/\D/g, '').slice(0, 14);

// Stamps the build id into the SPA document (meta + legacy stylesheet URLs) and
// emits dist/client/build.json so the runtime can expose /api/version.
function buildMetaPlugin() {
  return {
    name: 'bdu-build-meta',
    apply: 'build',
    transformIndexHtml(html) {
      const withMeta = html
        .replace(/<meta name="bdu-build"[^>]*>\s*/i, '')
        .replace('</head>', `  <meta name="bdu-build" content="${BUILD_ID}" />\n</head>`);
      return withMeta.replace(/(\/css\/[^"']+?\.css)(\?v=[^"']*)?(?=["'])/g, `$1?v=${BUILD_ID}`);
    },
    generateBundle() {
      this.emitFile({
        type: 'asset',
        fileName: 'build.json',
        source: `${JSON.stringify({ build_id: BUILD_ID })}\n`
      });
    }
  };
}

export default defineConfig(({ command }) => ({
  root: 'client',
  plugins: [react(), buildMetaPlugin()],
  publicDir: false,
  // Dev server không có build id riêng: để trống cho client bỏ qua banner
  // "bản mới" thay vì so với dist/client/build.json còn sót từ lần build trước.
  define: { __BUILD_ID__: JSON.stringify(command === 'build' ? BUILD_ID : '') },
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
    host: '0.0.0.0',
    port: 5173,
    strictPort: true,
    proxy: {
      '/api': { target: 'http://127.0.0.1:3000', changeOrigin: false },
      '/media': { target: 'http://127.0.0.1:3000', changeOrigin: false },
      '/assets': { target: 'http://127.0.0.1:3000', changeOrigin: false },
      '/css': { target: 'http://127.0.0.1:3000', changeOrigin: false },
      '/games': { target: 'http://127.0.0.1:3000', changeOrigin: false },
      '/admin-tool': { target: 'http://127.0.0.1:3000', changeOrigin: false },
      '/admin': { target: 'http://127.0.0.1:3000', changeOrigin: false },
      '/ws': { target: 'ws://127.0.0.1:3000', ws: true, changeOrigin: false }
    }
  }
}));
