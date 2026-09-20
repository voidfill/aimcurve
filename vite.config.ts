import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';

export default defineConfig({
	plugins: [vue()],
	server: {
		// IndexedDB is origin-scoped. A silently reassigned port looks
		// identical to lost data during persistence testing.
		port: 4321,
		strictPort: true,
	},
	// PGlite ships wasm + a worker; pre-bundling it breaks both.
	optimizeDeps: { exclude: ['@electric-sql/pglite'] },
	worker: { format: 'es' },
});
