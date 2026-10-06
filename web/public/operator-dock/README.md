# Vendored hapi-inline operator dock

Pinned tag: **v0.18.6**  
Source: https://github.com/heavygee/hapi-inline/releases/tag/v0.18.6

Files here (`operator-dock.js`, `operator-dock.css`, `vendor/html2canvas.min.js`) are a byte copy of that release. Do not edit them in this repo.

SHA-1 (v0.18.6):

- `operator-dock.js` — `b90fa566fa022de417718b87876f18ab6641fed1`
- `operator-dock.css` — `de06b06af3dfe235ba6faea17199bd58f76f60f6`
- `vendor/html2canvas.min.js` — `00dac05dbfa83704e76c420a6ab3fbcc7ada6303` (html2canvas-pro 2.3.5; same path)

Host wiring (not this folder):

- `hapi-boot.js` — HAPI web init. Do **not** bake `hubBase` into remats — env/settings only.
- `hub/src/web/hapi-inline/` — `PINNED_TAG` must match this README. Public config keeps explicit `sttUrl: '/api/stt'` and `privilege: 'execute'`.
- v0.18.6 — Settings sheet UX (#416): Hide on About only; About is the page; Change pin text link; Spawn purpose copy. Also live STT under fan (#415 lineage on main).

Re-vendor: copy `web/` from the next release-please tag. Drop any local dock fork.

Tracker: https://github.com/heavygee/hapi/issues/120
