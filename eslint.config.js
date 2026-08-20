// @ts-check
import js from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: ['dist/**', 'node_modules/**', 'public/**', '.github/**', '*.config.js', '*.config.ts'],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['**/*.ts'],
    languageOptions: {
      parserOptions: {
        project: './tsconfig.json',
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      // Underscore-prefixed args/vars are intentionally unused (callback signatures, etc.)
      '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      '@typescript-eslint/no-explicit-any': 'warn',
      // FFmpeg/OCR singletons and WASM glue lean on non-null assertions in a few hot paths
      '@typescript-eslint/no-non-null-assertion': 'off',
      // Page modules declare `let x!: T;` and assign once inside a setup routine
      // (definite-assignment pattern) — prefer-const can't see that and misflags it.
      'prefer-const': 'off',
      'no-console': ['warn', { allow: ['warn', 'error'] }],
    },
  },
);
