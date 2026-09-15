/// <reference types="vitest/config" />
import { getViteConfig } from 'astro/config';

// getViteConfig rather than a standalone vitest config: it inherits the path
// aliases and TypeScript settings Astro resolves, so a module imported in a
// test resolves exactly as it will in the browser.
export default getViteConfig({
  test: {
    include: ['test/**/*.test.ts'],
    // The oracle diff needs Python and is run on its own with `npm run oracle`.
    // Keeping it out of the default run means `npm test` never depends on a
    // toolchain the browser app does not have.
    exclude: ['test/oracle/**', 'node_modules/**'],
    // The fixtures are read from disk, so these are not browser tests.
    environment: 'node',
  },
});
