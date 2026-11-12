import { defineConfig } from 'eslint/config';
import tseslint from 'typescript-eslint';

export default defineConfig([
  {
    files: ['src/**/*.ts', 'test/**/*.ts', 'examples/**/*.ts'],
    extends: [tseslint.configs.recommended],
  },
  {
    // The renderer is a separate TypeScript project (tsconfig.renderer.json)
    // because it is bundled by Vite rather than run by Node.
    files: ['src/desktop/renderer/**/*.ts'],
    extends: [tseslint.configs.recommended],
    rules: {
      // Vue single-file components are linted through vue-tsc; the plain
      // TypeScript helpers under the renderer still get the recommended rules.
      '@typescript-eslint/no-explicit-any': 'off',
    },
  },
  {
    files: ['src/desktop/preload.cjs'],
    languageOptions: { globals: { require: 'readonly' } },
    rules: { 'no-undef': 'error', 'no-unused-vars': 'error' },
  },
  {
    ignores: ['src/desktop/renderer/components/**', 'renderer-dist/**'],
  },
]);
