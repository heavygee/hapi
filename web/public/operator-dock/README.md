# Vendored hapi-inline operator dock

Pinned tag: **v0.15.0**  
Source: https://github.com/heavygee/hapi-inline/releases/tag/v0.15.0

Files here (`operator-dock.js`, `operator-dock.css`, `vendor/html2canvas.min.js`) are a byte copy of that release. Do not edit them in this repo.

SHA-1 (v0.15.0):

- `operator-dock.js` — `9d610ec64aebaa8f764caaa1a90a139bfc41b73d`
- `operator-dock.css` — `da241c835235a30fd04f15c81eb77179f8387adb`
- `vendor/html2canvas.min.js` — `00dac05dbfa83704e76c420a6ab3fbcc7ada6303` (html2canvas-pro 2.3.5; same path)

Host wiring (not this folder):

- `hapi-boot.js` — HAPI web init (`appId: hapi-web`, `configUrl: /hapi/config`, `getHubJwt` for #176).
- `hub/src/web/hapi-inline/` — `PINNED_TAG` must match this README. Allow-list: POST `messages` / `upload` / `abort`. `sttUrl: '/api/stt'`, `sttAuth: 'hub-jwt'`. `web/index.html` loads dock with `?v=<pin>`.

Re-vendor: copy `web/` from the next release-please tag. Drop any local dock fork.

Tracker: https://github.com/heavygee/hapi/issues/120
