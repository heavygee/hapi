# Vendored hapi-inline operator dock

Pinned tag: **v0.15.2**  
Source: https://github.com/heavygee/hapi-inline/releases/tag/v0.15.2

Files here (`operator-dock.js`, `operator-dock.css`, `vendor/html2canvas.min.js`) are a byte copy of that release. Do not edit them in this repo.

SHA-1 (v0.15.2):

- `operator-dock.js` — `7525538a4a656b7f4b77d64d3392a15b4864e762`
- `operator-dock.css` — `da241c835235a30fd04f15c81eb77179f8387adb`
- `vendor/html2canvas.min.js` — `00dac05dbfa83704e76c420a6ab3fbcc7ada6303` (html2canvas-pro 2.3.5; same path)

Host wiring (not this folder):

- `hapi-boot.js` — HAPI web init. Do **not** bake `hubBase` into remats — env/settings only.
- `hub/src/web/hapi-inline/` — `PINNED_TAG` must match this README. Allow-list: POST `messages` / `upload` / `abort`.
- v0.15.2 — #298 shared StorageLike (drop emergency unlock Storage Pick widens).

Re-vendor: copy `web/` from the next release-please tag. Drop any local dock fork.

Tracker: https://github.com/heavygee/hapi/issues/120
