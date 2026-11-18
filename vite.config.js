import { defineConfig } from 'vite';

const API = 'http://localhost:3003';

export default defineConfig({
  server: {
    host: true,
    port: 5177,
    open: true,
    proxy: {
      '/api': { target: API, changeOrigin: true },
      '/chat': { target: API, ws: true, changeOrigin: true },
    },
  },
  build: {
    // three.js 本体约 544 kB，超过默认 500 kB 阈值会误报无意义警告——上调阈值保持零 warning
    chunkSizeWarningLimit: 600,
    rollupOptions: {
      output: {
        // three.js 体积占大头且业务代码改动不影响其 hash——拆独立 chunk 利于浏览器长缓存
        manualChunks: {
          three: ['three'],
        },
      },
    },
  },
});
