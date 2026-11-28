import js from '@eslint/js';
import prettier from 'eslint-config-prettier';
import reactHooks from 'eslint-plugin-react-hooks';
import globals from 'globals';
import tseslint from 'typescript-eslint';
import { importLayers } from './tools/eslint/import-layers.mjs';
import * as layers from './tools/eslint/layers.mjs';

export default tseslint.config(
  {
    ignores: [
      '**/dist/',
      '**/coverage/',
      '**/.data/',
      'apps/api/drizzle/',
      // Sakuga VFX: upstream's files, kept as upstream wrote them (packages/sakuga-vfx/AGENTS.md).
      'packages/sakuga-vfx/*',
      '!packages/sakuga-vfx/test/',
    ],
  },
  js.configs.recommended,
  tseslint.configs.recommended,
  {
    languageOptions: { globals: { ...globals.node } },
    rules: {
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
    },
  },
  {
    files: ['apps/web/**/*.{ts,tsx}'],
    extends: [reactHooks.configs.flat.recommended],
    languageOptions: { globals: { ...globals.browser } },
  },
  {
    // The layers of each package, its lazy entries and the package rules (docs/architecture.md).
    // The rules take no options: what they allow is declared in tools/eslint/layers.mjs alone.
    plugins: { 'import-layers': importLayers({ repo: import.meta.dirname, ...layers }) },
    rules: { 'import-layers/order': 'error', 'import-layers/no-cycle': 'error' },
  },
  prettier,
);
