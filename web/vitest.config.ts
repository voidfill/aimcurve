/// <reference types="vitest/config" />
import { getViteConfig } from 'astro/config';

// getViteConfig rather than a standalone vitest config: it inherits the path
// aliases and TypeScript settings Astro resolves, so a module imported in a
// test resolves exactly as it will in the browser.
export default getViteConfig({
  test: {
    include: ['test/**/*.test.ts'],
    // The fixtures are read from disk, so these are not browser tests.
    environment: 'node',
  },
});
