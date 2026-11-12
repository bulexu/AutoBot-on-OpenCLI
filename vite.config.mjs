import { fileURLToPath } from 'node:url';
import tailwindcss from '@tailwindcss/vite';
import vue from '@vitejs/plugin-vue';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [vue(), tailwindcss()],
  base: './',
  define: { 'process.env.NODE_ENV': JSON.stringify('production') },
  resolve: {
    // The registry components import shared helpers through the `@` alias,
    // the same convention the shadcn-vue CLI writes into components.json.
    alias: {
      '@': fileURLToPath(new URL('./src/desktop/renderer', import.meta.url)),
    },
  },
  build: {
    outDir: 'renderer-dist',
    lib: {
      entry: 'src/desktop/renderer/main.ts',
      formats: ['es'],
      fileName: () => 'renderer.js',
      cssFileName: 'renderer',
    },
  },
});
