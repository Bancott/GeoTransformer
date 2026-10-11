import { resolve } from 'node:path';
import { defineConfig } from 'vite';

export default defineConfig({
  base: './', // 相对路径，构建产物可放在任意目录或静态托管
  resolve: {
    alias: {
      '@': resolve(import.meta.dirname, 'src'),
    },
  },
  build: {
    outDir: 'dist',
    sourcemap: false,
    chunkSizeWarningLimit: 1500,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (!id.includes('node_modules')) return undefined;
          if (id.includes('leaflet')) return 'vendor';
          if (
            id.includes('proj4') ||
            id.includes('shpjs') ||
            id.includes('shp-write') ||
            id.includes('jszip') ||
            id.includes('topojson') ||
            id.includes('togeojson')
          ) {
            return 'geo-core';
          }
          return 'deps';
        },
      },
    },
  },
  server: {
    port: 5173,
    open: false,
  },
});
