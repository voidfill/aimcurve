/// <reference types="vitest/config" />
import { getViteConfig } from 'astro/config';

export default getViteConfig({
	test: {
		environment: 'node',
		// Tests sit next to their source; `test/` holds shared helpers and fixtures.
		include: ['src/**/*.test.ts', 'test/**/*.test.ts'],
	},
});
