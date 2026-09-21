# Vendored hapi-inline operator dock

Pinned tag: **v0.18.2**  
Source: https://github.com/heavygee/hapi-inline/releases/tag/v0.18.2

Files here (`operator-dock.js`, `operator-dock.css`, `vendor/html2canvas.min.js`) are a byte copy of that release. Do not edit them in this repo.

SHA-1 (v0.18.2):

- `operator-dock.js` — `a0ba3ee2520cddb322f4f21290e72a3966a56532`
- `operator-dock.css` — `35bb0133c4e382ab4c2316c4a0ce0b2be1e12f5b`
- `vendor/html2canvas.min.js` — `00dac05dbfa83704e76c420a6ab3fbcc7ada6303` (html2canvas-pro 2.3.5; same path)

Host wiring (not this folder):

- `hapi-boot.js` — HAPI web init. Do **not** bake `hubBase` into remats — env/settings only.
- `hub/src/web/hapi-inline/` — `PINNED_TAG` must match this README.
- v0.18.2 — voice markup drops toolbar Undo/Clear/Send; H dismisses (#373).

Re-vendor: copy `web/` from the next release-please tag. Drop any local dock fork.

Tracker: https://github.com/heavygee/hapi/issues/120
