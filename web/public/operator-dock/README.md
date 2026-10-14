# Vendored hapi-inline operator dock

Pinned tag: **v0.22.1**  
Source: https://github.com/Heavygee-Projects/hapi-inline/releases/tag/v0.22.1

Files here (`operator-dock.js`, `operator-dock.css`, `vendor/html2canvas.min.js`) are a byte copy of that release. Do not edit them in this repo.

SHA-1 (v0.22.1):

- `operator-dock.js` — `4e4353b015bb058e24c722164ad48eb1c752255f`
- `operator-dock.css` — `8dae7c38b949a96dba2543e6a3f022b6c6292da2`
- `vendor/html2canvas.min.js` — `00dac05dbfa83704e76c420a6ab3fbcc7ada6303` (html2canvas-pro 2.3.5; same path)

Host wiring (not this folder):

- `hapi-boot.js` — HAPI web init. Do **not** bake `hubBase` into remats — env/settings only.
- `hub/src/web/hapi-inline/` — `PINNED_TAG` must match this README. Public config keeps explicit `sttUrl: '/api/stt'` and `privilege: 'execute'`.
- v0.22.1 — Harden Open in HAPI `location.assign` for CodeQL XSS (#508/#509). Keeps #497/#498 title + open-in-HAPI, #492 filter.

Re-vendor: copy `web/` from the next release-please tag. Drop any local dock fork.

Tracker: https://github.com/heavygee/hapi/issues/120
