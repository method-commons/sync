import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/**/*.test.js'],
    coverage: { include: ['client/**/*.js'], thresholds: { lines: 90, branches: 80 } },
  },
});
