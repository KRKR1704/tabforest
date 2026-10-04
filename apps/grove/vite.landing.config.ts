// The public landing page: a separate build from the Grove UI, so nothing here
// ends up inside the extension. Output goes to build/landing, ready for any
// static host.
import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';

const landingDir = path.resolve(__dirname, 'landing');

/** In development the page lives at /landing/; opening the bare address goes there. */
const openLanding = (): Plugin => ({
  name: 'tabforest-open-landing',
  apply: 'serve',
  configureServer(server) {
    server.middlewares.use((request, response, next) => {
      if (request.url === '/' || request.url === '/index.html') {
        response.statusCode = 302;
        response.setHeader('Location', '/landing/');
        response.end();
        return;
      }
      next();
    });
  },
});

export default defineConfig(({ command }) => ({
  // The build is rooted in landing/ so index.html lands at the top of the output.
  // The dev server is rooted in apps/grove like the Grove's own: with landing/ as
  // its root, pre-bundled packages were served from outside the root and React
  // was loaded twice ("Invalid hook call"), which left the page blank.
  root: command === 'build' ? landingDir : __dirname,
  envDir: __dirname,
  base: './',
  // Its own cache, so it can run next to `npm run dev` without the two servers
  // overwriting each other's pre-bundled packages.
  cacheDir: path.resolve(__dirname, 'node_modules/.vite-landing'),
  plugins: [react(), openLanding()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
      '@contracts': path.resolve(__dirname, '../../contracts'),
    },
    dedupe: ['react', 'react-dom'],
  },
  optimizeDeps: {
    entries: ['landing/index.html'],
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
}));
