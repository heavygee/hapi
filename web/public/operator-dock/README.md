# Vendored hapi-inline operator dock

Pinned tag: **v0.19.3**  
Source: https://github.com/Heavygee-Projects/hapi-inline/releases/tag/v0.19.3

Files here (`operator-dock.js`, `operator-dock.css`, `vendor/html2canvas.min.js`) are a byte copy of that release. Do not edit them in this repo.

SHA-1 (v0.19.3):

- `operator-dock.js` — `f731a22d0486bf78cd0fac7311e577e4491c72e2`
- `operator-dock.css` — `31a57587c9f95b327ed509aa5848584a1d7b547a`
- `vendor/html2canvas.min.js` — `00dac05dbfa83704e76c420a6ab3fbcc7ada6303` (html2canvas-pro 2.3.5; same path)

Host wiring (not this folder):

- `hapi-boot.js` — HAPI web init. Do **not** bake `hubBase` into remats — env/settings only.
- `hub/src/web/hapi-inline/` — `PINNED_TAG` must match this README. Public config keeps explicit `sttUrl: '/api/stt'` and `privilege: 'execute'`.
- v0.19.3 — markup capture aligned to visible viewport (#432). Keeps v0.19.2 #419/#341 proxy `/hapi` wipe fix.

Re-vendor: copy `web/` from the next release-please tag. Drop any local dock fork.

Tracker: https://github.com/heavygee/hapi/issues/120
