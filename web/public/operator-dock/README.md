# Vendored hapi-inline operator dock

Pinned tag: **v0.19.4**  
Source: https://github.com/Heavygee-Projects/hapi-inline/releases/tag/v0.19.4

Files here (`operator-dock.js`, `operator-dock.css`, `vendor/html2canvas.min.js`) are a byte copy of that release. Do not edit them in this repo.

SHA-1 (v0.19.4):

- `operator-dock.js` — `b30619b10b526759db10115afe735c5b1da6c25b`
- `operator-dock.css` — `c129235c397a9bf638d786ec121c18d72b7cd415`
- `vendor/html2canvas.min.js` — `00dac05dbfa83704e76c420a6ab3fbcc7ada6303` (html2canvas-pro 2.3.5; same path)

Host wiring (not this folder):

- `hapi-boot.js` — HAPI web init. Do **not** bake `hubBase` into remats — env/settings only.
- `hub/src/web/hapi-inline/` — `PINNED_TAG` must match this README. Public config keeps explicit `sttUrl: '/api/stt'` and `privilege: 'execute'`.
- v0.19.4 — freeze host scroll before markup capture (#437/#439). Keeps #432 viewport crop + #419/#341 proxy `/hapi` wipe fix.

Re-vendor: copy `web/` from the next release-please tag. Drop any local dock fork.

Tracker: https://github.com/heavygee/hapi/issues/120
