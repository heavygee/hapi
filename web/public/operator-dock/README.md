# Vendored hapi-inline operator dock

Pinned tag: **v0.21.0**  
Source: https://github.com/Heavygee-Projects/hapi-inline/releases/tag/v0.21.0

Files here (`operator-dock.js`, `operator-dock.css`, `vendor/html2canvas.min.js`) are a byte copy of that release. Do not edit them in this repo.

SHA-1 (v0.21.0):

- `operator-dock.js` — `264c313e1f7d22016b82e634fce943dd915e4996`
- `operator-dock.css` — `1d9ccfddcddb33c123f0291dc47754bfd55a5902`
- `vendor/html2canvas.min.js` — `00dac05dbfa83704e76c420a6ab3fbcc7ada6303` (html2canvas-pro 2.3.5; same path)

Host wiring (not this folder):

- `hapi-boot.js` — HAPI web init. Do **not** bake `hubBase` into remats — env/settings only.
- `hub/src/web/hapi-inline/` — `PINNED_TAG` must match this README. Public config keeps explicit `sttUrl: '/api/stt'` and `privilege: 'execute'`.
- v0.21.0 — Project Sessions search filter (#492/#493). Keeps #474 markup Android path, #466 replies mic, #419 wipe fix.

Re-vendor: copy `web/` from the next release-please tag. Drop any local dock fork.

Tracker: https://github.com/heavygee/hapi/issues/120
