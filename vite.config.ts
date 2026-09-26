import { defineConfig, loadEnv } from 'vite';
import vue from '@vitejs/plugin-vue';

/**
 * The absolute site URL the link-preview tags in index.html need (D7 of the
 * About design), from the environment or any `.env*` file, defaulting to the
 * Pages URL; a custom domain sets VITE_SITE_URL in the deploy workflow. The
 * tags append paths to it (`%VITE_SITE_URL%og.png`), so it always ends in `/`.
 */
function siteUrl(mode: string): string {
	const url = loadEnv(mode, process.cwd(), 'VITE_').VITE_SITE_URL || 'https://voidfill.github.io/aimcurve/';
	return url.endsWith('/') ? url : `${url}/`;
}

export default defineConfig(({ mode }) => {
	// Vite's HTML replacement reads it from here, after `.env*` files are loaded.
	process.env.VITE_SITE_URL = siteUrl(mode);
	return {
		plugins: [vue()],
		// Relative, so the build works under GitHub Pages' /aimcurve/ subpath or a
		// custom domain alike. Safe because routing is hash-based: index.html is
		// always the page at the root of the deploy.
		base: './',
		server: {
			// OPFS and IndexedDB are origin-scoped. A silently reassigned port looks
			// identical to lost data during persistence testing.
			port: 4321,
			strictPort: true,
		},
		// PGlite ships wasm + a worker; pre-bundling it breaks both.
		optimizeDeps: { exclude: ['@electric-sql/pglite'] },
		worker: { format: 'es' },
	};
});
