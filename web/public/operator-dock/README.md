# Vendored hapi-inline operator dock

Pinned tag: **v0.19.2**  
Source: https://github.com/Heavygee-Projects/hapi-inline/releases/tag/v0.19.2

Files here (`operator-dock.js`, `operator-dock.css`, `vendor/html2canvas.min.js`) are a byte copy of that release. Do not edit them in this repo.

SHA-1 (v0.19.2):

- `operator-dock.js` — `1426af24a64969eb5d5bf0c372fb74a1ac3907bb`
- `operator-dock.css` — `de06b06af3dfe235ba6faea17199bd58f76f60f6`
- `vendor/html2canvas.min.js` — `00dac05dbfa83704e76c420a6ab3fbcc7ada6303` (html2canvas-pro 2.3.5; same path)

Host wiring (not this folder):

- `hapi-boot.js` — HAPI web init. Do **not** bake `hubBase` into remats — env/settings only.
- `hub/src/web/hapi-inline/` — `PINNED_TAG` must match this README. Public config keeps explicit `sttUrl: '/api/stt'` and `privilege: 'execute'`.
- v0.19.2 — fix #419/#341: keep relative `/hapi` through `requestTarget` (proxy wipe); fail-closed empty base; no HTML-as-JSON; spawn send feedback; About recent dock ops.

Re-vendor: copy `web/` from the next release-please tag. Drop any local dock fork.

Tracker: https://github.com/heavygee/hapi/issues/120
