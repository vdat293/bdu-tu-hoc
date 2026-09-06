import js from '@eslint/js';
import reactHooks from 'eslint-plugin-react-hooks';

export default [
  { ignores: ['dist/**', 'node_modules/**', 'public/**'] },
  js.configs.recommended,
  {
    files: ['client/**/*.{js,jsx}', 'vite.config.js', 'vitest.config.js'],
    languageOptions: {
      parserOptions: { ecmaVersion: 'latest', sourceType: 'module', ecmaFeatures: { jsx: true } },
      globals: {
        window: 'readonly', document: 'readonly', navigator: 'readonly', localStorage: 'readonly', sessionStorage: 'readonly',
        FormData: 'readonly', Blob: 'readonly', URL: 'readonly', fetch: 'readonly', Headers: 'readonly', EventSource: 'readonly',
        WebSocket: 'readonly', atob: 'readonly', CustomEvent: 'readonly', URLSearchParams: 'readonly', console: 'readonly', setTimeout: 'readonly', clearTimeout: 'readonly',
        setInterval: 'readonly', clearInterval: 'readonly', performance: 'readonly'
      }
    },
    plugins: { 'react-hooks': reactHooks },
    rules: {
      // Core ESLint does not count JSX references without eslint-plugin-react;
      // the build itself remains the authoritative module-usage check here.
      'no-unused-vars': 'off',
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'warn'
    }
  }
];
