// The public landing page: a separate build from the Grove UI, so nothing here
// ends up inside the extension. Output goes to build/landing, ready for any
// static host.
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';

export default defineConfig({
  root: path.resolve(__dirname, 'landing'),
  envDir: __dirname,
  base: './',
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
      '@contracts': path.resolve(__dirname, '../../contracts'),
    },
  },
  server: {
    host: '127.0.0.1',
    port: 3100,
    strictPort: false,
    fs: { allow: [__dirname, path.resolve(__dirname, '../../contracts')] },
  },
  build: {
    outDir: path.resolve(__dirname, 'build/landing'),
    emptyOutDir: true,
  },
});
