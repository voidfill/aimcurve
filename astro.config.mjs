// @ts-check
import { defineConfig } from 'astro/config';

// https://astro.build/config
export default defineConfig({
	vite: {
		// PGlite ships wasm + a worker; pre-bundling it breaks both.
		optimizeDeps: { exclude: ['@electric-sql/pglite'] },
		worker: { format: 'es' },
	},
});
