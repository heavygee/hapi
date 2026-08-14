# Vendored hapi-inline operator dock

Pinned tag: **v0.11.9**  
Source: https://github.com/heavygee/hapi-inline/releases/tag/v0.11.9

Files here (`operator-dock.js`, `operator-dock.css`, `vendor/html2canvas.min.js`) are a byte copy of that release. Do not edit them in this repo.

SHA-1 (v0.11.9):

- `operator-dock.js` — `f710d6aa1567da400140b2ad35e8f431d3a37721`
- `operator-dock.css` — `b4f2817dd76a1d3ef1e622f00fffd83dcc43b7dc`
- `vendor/html2canvas.min.js` — `00dac05dbfa83704e76c420a6ab3fbcc7ada6303` (html2canvas-pro 2.3.5; same path)

Host wiring (not this folder):

- `hapi-boot.js` — HAPI web init (`appId: hapi-web`, `configUrl: /hapi/config`). Boots on `/opmic` knock or Settings pref `hapi-operator-dock=true`. Clears known-bad stored secret before init (host complement to package #158). Package fail-closes H/markup when gate secret missing/bad (#155 / v0.11.6+).
- Settings → General → Show operator tools (owner-only). In-page gate field (no `window.prompt`); probes before enable (#123).
- `hub/src/web/hapi-inline/` — operator-gated `/hapi` proxy. `PINNED_TAG` in `config.ts` is what the mic payload `build` field reports (must match this README pin). `web/index.html` loads dock assets with `?v=<pin>` so browsers do not keep a stale `operator-dock.js`.

Re-vendor: copy `web/` from the next release-please tag. Drop any local dock fork.

Tracker: https://github.com/heavygee/hapi/issues/120
