import preact from '@preact/preset-vite';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  // Relative asset paths, so the built page works from any URL path it is hosted under.
  base: './',
  plugins: [preact()],
  test: {
    include: ['test/**/*.test.ts'],
  },
});
