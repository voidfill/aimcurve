/// <reference types="vitest/config" />
import { getViteConfig } from 'astro/config';

export default getViteConfig({
  test: {
    include: ['test/oracle/**/*.test.ts'],
    environment: 'node',
    // The Python dump indexes eleven runs into a throwaway database and then
    // builds two hundred-odd payloads over them; on a cold nix store the first
    // invocation also fetches an interpreter.
    testTimeout: 120_000,
  },
});
