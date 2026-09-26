import vue from '@vitejs/plugin-vue';
import { defineConfig } from 'vitest/config';

// KovaaK's stamps filenames in the recording machine's local time, and the
// curated fixtures were recorded in Berlin. Pinned before any worker spawns
// (they inherit it) so pairing runs to perfs does not depend on where the
// suite runs — CI is UTC.
process.env.TZ = 'Europe/Berlin';

export default defineConfig({
	// For the few suites that mount a view (they opt into happy-dom per file).
	plugins: [vue()],
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
