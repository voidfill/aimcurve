import { defineConfig, type Plugin } from 'vite';
import vue from '@vitejs/plugin-vue';

// The absolute site URL the link-preview tags in index.html need (D7 of the
// About design). `.env` is gitignored, so the default lives here; a custom
// domain sets VITE_SITE_URL in the deploy workflow. Always ends in `/`.
process.env.VITE_SITE_URL ??= 'https://voidfill.github.io/aimcurve/';

/**
 * Fails the build if the About page's own chunks pull in the database. About
 * renders from a bundled snapshot so a first-time visitor never waits for
 * PGlite; one stray import of `useDb` would quietly undo that. The shared entry
 * chunk is excluded: the app shell legitimately opens the database.
 */
function aboutStaysLocal(): Plugin {
	const FORBIDDEN = [/\/src\/db\/client\.ts$/, /@electric-sql[\\/]pglite/];
	return {
		name: 'aimcurve:about-stays-local',
		apply: 'build',
		generateBundle(_, bundle) {
			const chunks = Object.values(bundle).filter((c) => c.type === 'chunk');
			const byName = new Map(chunks.map((c) => [c.fileName, c]));
			const about = chunks.find((c) => c.facadeModuleId?.endsWith('/src/views/AboutView.vue'));
			if (!about) this.error('The About view chunk was not found');
			const seen = new Set<string>();
			const queue = [about.fileName];
			while (queue.length > 0) {
				const chunk = byName.get(queue.pop()!);
				if (!chunk || chunk.isEntry || seen.has(chunk.fileName)) continue;
				seen.add(chunk.fileName);
				const bad = Object.keys(chunk.modules).find((id) => FORBIDDEN.some((re) => re.test(id.replaceAll('\\', '/'))));
				if (bad) this.error(`About's chunk ${chunk.fileName} includes ${bad}`);
				queue.push(...chunk.imports, ...chunk.dynamicImports);
			}
		},
	};
}

export default defineConfig({
	plugins: [vue(), aboutStaysLocal()],
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
