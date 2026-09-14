import { defineConfig } from 'astro/config';

// Static output with no framework runtime: the deployed artefact is a folder of
// files that any static host serves, which is the one promise from the original
// design that survived allowing a build step at all.
export default defineConfig({
  output: 'static',
  // Set `site` and `base` when the Pages origin is known. Left unset so `astro
  // dev` and `astro build` both work from a bare checkout.
  vite: {
    // uPlot is vendored and ships as a UMD bundle; Vite must not try to
    // pre-bundle it as an ES module.
    optimizeDeps: { exclude: ['uplot'] },
  },
});
