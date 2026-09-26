## Development

Run the dev server in background mode; it binds port 4321 with `strictPort`,
so the origin stays constant and the local database (OPFS) and saved folder
handle (IndexedDB) survive restarts.

    pnpm dev

## Preview assets

The About page, the link-preview card (`public/og.png`) and the README
screenshots come from bundled sample runs. To refresh any of them, follow
[docs/preview-assets.md](docs/preview-assets.md): `pnpm gen:demo-fixtures`,
`pnpm gen:demo`, then `pnpm shots` against the dev server.

## Documentation

Consult these guides before working on related tasks:

- [Vue SFC syntax](https://vuejs.org/api/sfc-script-setup.html)
- [Vue reactivity](https://vuejs.org/api/reactivity-core.html)
- [vue-router essentials](https://router.vuejs.org/guide/essentials/navigation.html)
- [Vite configuration](https://vite.dev/config/)
- [VueUse](https://vueuse.org/functions.html)
