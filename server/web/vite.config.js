import { defineConfig } from 'vite';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const webRoot = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  root: webRoot,
  base: '/pc/',
  build: {
    outDir: path.resolve(webRoot, '..', 'public', 'pc'),
    emptyOutDir: true,
    sourcemap: true
  },
  server: {
    port: 5173,
    proxy: { '/api': 'http://127.0.0.1:3000' }
  }
});
