# Vendored hapi-inline operator dock

Pinned tag: **v0.15.5**  
Source: https://github.com/heavygee/hapi-inline/releases/tag/v0.15.5

Files here (`operator-dock.js`, `operator-dock.css`, `vendor/html2canvas.min.js`) are a byte copy of that release. Do not edit them in this repo.

SHA-1 (v0.15.5):

- `operator-dock.js` — `c65f24893853b6c2866c51af06bcb5a9472c9c05`
- `operator-dock.css` — `da241c835235a30fd04f15c81eb77179f8387adb`
- `vendor/html2canvas.min.js` — `00dac05dbfa83704e76c420a6ab3fbcc7ada6303` (html2canvas-pro 2.3.5; same path)

Host wiring (not this folder):

- `hapi-boot.js` — HAPI web init. Do **not** bake `hubBase` into remats — env/settings only.
- `hub/src/web/hapi-inline/` — `PINNED_TAG` must match this README.
- v0.15.5 — #308 mediaDevices HTTP mic.

Re-vendor: copy `web/` from the next release-please tag. Drop any local dock fork.

Tracker: https://github.com/heavygee/hapi/issues/120
