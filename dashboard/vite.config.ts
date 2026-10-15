import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// `npm run dev` proxies the API to a locally running backend (npm start in ../backend).
export default defineConfig({
  plugins: [react()],
  server: { port: 5173, proxy: { '/api': 'http://127.0.0.1:8080' } },
  build: { outDir: 'dist', sourcemap: false, assetsInlineLimit: 0, chunkSizeWarningLimit: 600 },
});