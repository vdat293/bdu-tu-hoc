import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  root: 'client',
  plugins: [react()],
  test: {
    environment: 'jsdom',
    include: ['../tests/frontend/**/*.test.{js,jsx}'],
    setupFiles: ['../tests/frontend/setup.js']
  }
});
