# Vendored hapi-inline operator dock

Pinned tag: **v0.18.3**  
Source: https://github.com/heavygee/hapi-inline/releases/tag/v0.18.3

Files here (`operator-dock.js`, `operator-dock.css`, `vendor/html2canvas.min.js`) are a byte copy of that release. Do not edit them in this repo.

SHA-1 (v0.18.3):

- `operator-dock.js` — `79941a68db76e2bc5e62ec59faf78a5ed13b73a4`
- `operator-dock.css` — `35bb0133c4e382ab4c2316c4a0ce0b2be1e12f5b` (unchanged vs v0.18.2)
- `vendor/html2canvas.min.js` — `00dac05dbfa83704e76c420a6ab3fbcc7ada6303` (html2canvas-pro 2.3.5; same path)

Host wiring (not this folder):

- `hapi-boot.js` — HAPI web init. Do **not** bake `hubBase` into remats — env/settings only.
- `hub/src/web/hapi-inline/` — `PINNED_TAG` must match this README.
- v0.18.3 — Quest live label beside whisper (#375). Toolbar Undo/Clear/Send stay gone.

Re-vendor: copy `web/` from the next release-please tag. Drop any local dock fork.

Tracker: https://github.com/heavygee/hapi/issues/120
