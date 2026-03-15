import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// VITE_BASE_PATH is set in GitHub Actions for GitHub Pages (e.g. '/aztardl/')
// Leave empty for local dev / Railway
const base = process.env.VITE_BASE_PATH || '/';

export default defineConfig({
  plugins: [react()],
  base,
  server: {
    port: 5173,
    proxy: {
      '/api': { target: 'http://localhost:3001', changeOrigin: true },
    },
  },
  preview: {
    proxy: {
      '/api': { target: 'http://localhost:3001', changeOrigin: true },
    },
  },
});
