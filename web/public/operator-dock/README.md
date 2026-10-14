# Vendored hapi-inline operator dock

Pinned tag: **v0.22.2**  
Source: https://github.com/Heavygee-Projects/hapi-inline/releases/tag/v0.22.2

Files here (`operator-dock.js`, `operator-dock.css`, `vendor/html2canvas.min.js`) are a byte copy of that release. Do not edit them in this repo.

SHA-1 (v0.22.2):

- `operator-dock.js` — `1c3a5e94865804dd93b6789992dfb0a5dba9fbf5`
- `operator-dock.css` — `8dae7c38b949a96dba2543e6a3f022b6c6292da2`
- `vendor/html2canvas.min.js` — `00dac05dbfa83704e76c420a6ab3fbcc7ada6303` (html2canvas-pro 2.3.5; same path)

Host wiring (not this folder):

- `hapi-boot.js` — HAPI web init. Do **not** bake `hubBase` into remats — env/settings only.
- `hub/src/web/hapi-inline/` — `PINNED_TAG` must match this README. Public config keeps explicit `sttUrl: '/api/stt'` and `privilege: 'execute'`.
- v0.22.2 — Clear CodeQL xss-through-dom on location.assign (#514/#518). Keeps #508/#497/#498/#492.

Re-vendor: copy `web/` from the next release-please tag. Drop any local dock fork.

Tracker: https://github.com/heavygee/hapi/issues/120
