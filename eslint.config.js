import js from '@eslint/js';
import globals from 'globals';

export default [
  { ignores: ['node_modules/', 'coverage/'] },
  js.configs.recommended,
  {
    // Kern und Oberfläche: ES-Module für den Browser, gebündelt von der jeweiligen App
    files: ['client/**/*.js', 'ui/**/*.js'],
    languageOptions: { ecmaVersion: 2025, sourceType: 'module', globals: globals.browser },
    rules: {
      'no-unused-vars': ['error', { args: 'none', caughtErrors: 'none' }],
      eqeqeq: ['error', 'always', { null: 'ignore' }],
      'prefer-const': 'error',
      'no-var': 'error',
    },
  },
  {
    // Werkzeuge und Tests laufen in Node
    files: ['*.config.js', 'tests/**/*.js'],
    languageOptions: { ecmaVersion: 2025, sourceType: 'module', globals: { ...globals.node, ...globals.browser } },
  },
];
