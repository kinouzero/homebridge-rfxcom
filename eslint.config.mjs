import js from '@eslint/js';
import { defineConfig } from 'eslint/config';
import tseslint from 'typescript-eslint';

export default defineConfig([
  { ignores: ['dist/**', 'coverage/**', 'node_modules/**'] },
  {
    files: ['src/**/*.ts'],
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    rules: {
      '@typescript-eslint/no-require-imports': ['error', { allowAsImport: true }],
      '@typescript-eslint/no-non-null-assertion': 'off',
      quotes: ['error', 'single'],
      semi: ['error', 'always'],
      'comma-dangle': ['error', 'always-multiline'],
      eqeqeq: 'error',
      curly: ['error', 'multi'],
      'no-trailing-spaces': 'error',
    },
  },
]);
