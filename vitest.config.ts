/// <reference types="vitest/config" />
import { getViteConfig } from 'astro/config';

export default getViteConfig({
	test: {
		environment: 'node',
		// Tests sit next to their source; `test/` holds shared helpers and fixtures.
		include: ['src/**/*.test.ts', 'test/**/*.test.ts'],
		// A cold PGlite WASM boot does not fit in the 5 s default, and several
		// suites now boot one, so the default flakes under parallel load.
		testTimeout: 30000,
	},
});
