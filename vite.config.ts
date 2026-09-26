import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';

export default defineConfig({
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
});
