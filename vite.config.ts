import path from 'node:path';
import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

const rootDir = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig(({ mode }) => ({
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(rootDir, 'src')
    }
  },
  server: {
    port: 5173,
    strictPort: true
  },
  preview: {
    port: 4173,
    strictPort: true
  },
  esbuild:
    mode === 'production'
      ? {
          drop: ['debugger'],
          pure: ['console.log', 'console.debug', 'console.info', 'console.trace'],
          legalComments: 'none'
        }
      : undefined,
  build: {
    target: 'es2020',
    cssCodeSplit: true,
    sourcemap: false,
    chunkSizeWarningLimit: 600,
    rollupOptions: {
      output: {
        manualChunks(id: string) {
          if (!id.includes('node_modules')) return undefined;
          // Incluye react-dom/client y scheduler, que con la lista anterior
          // se quedaban dentro del paquete principal (~170 kB).
          if (/node_modules\/(react|react-dom|scheduler|react-router|react-router-dom|@remix-run)\//.test(id)) return 'vendor-react';
          if (id.includes('lucide-react')) return 'vendor-icons';
          if (id.includes('@supabase')) return 'vendor-supabase';
          if (id.includes('recharts') || id.includes('/d3-') || id.includes('victory-vendor')) return 'vendor-charts';
          if (id.includes('@sentry')) return 'vendor-sentry';
          return undefined;
        }
      }
    }
  }
}));