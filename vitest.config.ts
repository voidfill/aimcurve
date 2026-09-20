import { defineConfig } from 'vitest/config';

export default defineConfig({
	test: {
		environment: 'node',
		// Tests sit next to their source; `test/` holds shared helpers and fixtures.
		include: ['src/**/*.test.ts', 'test/**/*.test.ts'],
		// A cold PGlite WASM boot does not fit in the 5 s default, and several
		// suites now boot one, so the default flakes under parallel load. The
		// same boot inside a beforeAll/beforeEach hook does not fit vitest's
		// 10 s hookTimeout default either.
		testTimeout: 30000,
		hookTimeout: 30000,
	},
});
