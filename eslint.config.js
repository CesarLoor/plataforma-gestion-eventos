import js from '@eslint/js';
import globals from 'globals';

export default [
  { ignores: ['**/node_modules/**', '**/dist/**', '**/dev-dist/**'] },
  js.configs.recommended,
  {
    languageOptions: { ecmaVersion: 2024, sourceType: 'module', globals: { ...globals.node } },
    rules: { 'no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }] },
  },
  {
    files: ['apps/pwa/**/*.{js,jsx}'],
    languageOptions: { globals: { ...globals.browser }, parserOptions: { ecmaFeatures: { jsx: true } } },
    // eslint base no entiende JSX como uso de variables: se desactiva solo en la PWA
    rules: { 'no-unused-vars': 'off' },
  },
];
