import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: { '/api': 'http://localhost:8766', '/ws': { target: 'ws://localhost:8766', ws: true } },
  },
  resolve: {
    alias: {
      'three': '/node_modules/three',
      'three/addons/': '/node_modules/three/examples/jsm/',
    },
  },
});
