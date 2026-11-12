import { defineConfig } from 'eslint/config';
import tseslint from 'typescript-eslint';

export default defineConfig([
  {
    files: ['src/**/*.ts', 'test/**/*.ts', 'examples/**/*.ts'],
    extends: [tseslint.configs.recommended],
  },
  {
    files: ['src/desktop/workbench.js'],
    languageOptions: {
      globals: { document: 'readonly', window: 'readonly', FormData: 'readonly' },
    },
    rules: { 'no-undef': 'error', 'no-unused-vars': 'error' },
  },
  {
    files: ['src/desktop/preload.cjs'],
    languageOptions: { globals: { require: 'readonly' } },
    rules: { 'no-undef': 'error', 'no-unused-vars': 'error' },
  },
]);
