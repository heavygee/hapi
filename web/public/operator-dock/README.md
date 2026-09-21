# Vendored hapi-inline operator dock

Pinned tag: **v0.18.4**  
Source: https://github.com/heavygee/hapi-inline/releases/tag/v0.18.4

Files here (`operator-dock.js`, `operator-dock.css`, `vendor/html2canvas.min.js`) are a byte copy of that release. Do not edit them in this repo.

SHA-1 (v0.18.4):

- `operator-dock.js` — `183dd20eb9fb218fbc187854487a2d332bbf4950`
- `operator-dock.css` — `ab71ee95192aa23a314f2c88bff5b5bc08e3001b`
- `vendor/html2canvas.min.js` — `00dac05dbfa83704e76c420a6ab3fbcc7ada6303` (html2canvas-pro 2.3.5; same path)

Host wiring (not this folder):

- `hapi-boot.js` — HAPI web init. Do **not** bake `hubBase` into remats — env/settings only.
- `hub/src/web/hapi-inline/` — `PINNED_TAG` must match this README. Public config keeps explicit `sttUrl: '/api/stt'`.
- v0.18.4 — unseen-version dot stays on the About settings tab until the changelog opens (#382).

Re-vendor: copy `web/` from the next release-please tag. Drop any local dock fork.

Tracker: https://github.com/heavygee/hapi/issues/120
