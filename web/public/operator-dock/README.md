# Vendored hapi-inline operator dock

Pinned tag: **v0.20.1**  
Source: https://github.com/Heavygee-Projects/hapi-inline/releases/tag/v0.20.1

Files here (`operator-dock.js`, `operator-dock.css`, `vendor/html2canvas.min.js`) are a byte copy of that release. Do not edit them in this repo.

SHA-1 (v0.20.1):

- `operator-dock.js` — `92976fee33a010c8f3914cb6824722cae7fa7e79`
- `operator-dock.css` — `25c407a6969bd421dbbecf70f286d83efc818b19`
- `vendor/html2canvas.min.js` — `00dac05dbfa83704e76c420a6ab3fbcc7ada6303` (html2canvas-pro 2.3.5; same path)

Host wiring (not this folder):

- `hapi-boot.js` — HAPI web init. Do **not** bake `hubBase` into remats — env/settings only.
- `hub/src/web/hapi-inline/` — `PINNED_TAG` must match this README. Public config keeps explicit `sttUrl: '/api/stt'` and `privilege: 'execute'`.
- v0.20.1 — markup via AndroidOperator.requestMarkupCapture (#474/#473). Keeps #466 replies mic, #453 Compose STT, #419 wipe fix.

Re-vendor: copy `web/` from the next release-please tag. Drop any local dock fork.

Tracker: https://github.com/heavygee/hapi/issues/120
