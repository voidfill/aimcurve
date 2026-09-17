# aimcurve browser app

Requires Node.js 22.12 or newer for development and builds. From this directory:

```sh
npm ci
npm run dev
```

Open [http://localhost:4321](http://localhost:4321) and select the installation
folder containing `stats/` and optional `performances/`.

`npm run build` writes the static site to `dist/`; `npm run preview` serves that
build locally. Use HTTPS or localhost so Web Locks can protect indexing across
tabs. The hosted app needs no Node installation and sends no run data away.

Run `npm test`, `npm run check`, and `npm run build` for local verification.
See the [repository README](../README.md) for the Python oracle and integration
limitations.
