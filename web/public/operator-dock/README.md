# Vendored hapi-inline operator dock

Pinned tag: **v0.11.8**  
Source: https://github.com/heavygee/hapi-inline/releases/tag/v0.11.8

Files here (`operator-dock.js`, `operator-dock.css`, `vendor/html2canvas.min.js`) are a byte copy of that release. Do not edit them in this repo.

SHA-1 (v0.11.8):

- `operator-dock.js` — `337d5feb9210818daebc630198c00717aff518aa`
- `operator-dock.css` — `2a6be0ed68538bb9cc949e2f109b5a7cafc3b6c4` (unchanged from v0.11.7)
- `vendor/html2canvas.min.js` — `00dac05dbfa83704e76c420a6ab3fbcc7ada6303` (html2canvas-pro 2.3.5; same path)

Host wiring (not this folder):

- `hapi-boot.js` — HAPI web init (`appId: hapi-web`, `configUrl: /hapi/config`). Boots on `/opmic` knock or Settings pref `hapi-operator-dock=true`. Clears known-bad stored secret before init (host complement to package #158). Package fail-closes H/markup when gate secret missing/bad (#155 / v0.11.6+).
- Settings → General → Show operator tools (owner-only). In-page gate field (no `window.prompt`); probes before enable (#123).
- `hub/src/web/hapi-inline/` — operator-gated `/hapi` proxy (composed `/operator/sessions`, messages/upload only)

Re-vendor: copy `web/` from the next release-please tag. Drop any local dock fork.

Tracker: https://github.com/heavygee/hapi/issues/120
