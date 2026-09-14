# Vendored hapi-inline operator dock

Pinned tag: **v0.14.1**  
Source: https://github.com/heavygee/hapi-inline/releases/tag/v0.14.1

Files here (`operator-dock.js`, `operator-dock.css`, `vendor/html2canvas.min.js`) are a byte copy of that release. Do not edit them in this repo.

SHA-1 (v0.14.1):

- `operator-dock.js` — `5ffc46c745d7a966fb7b05230663c391c7791038`
- `operator-dock.css` — `e2e29a2b4bf69af214ce63a8c4abedd44fec4d43`
- `vendor/html2canvas.min.js` — `00dac05dbfa83704e76c420a6ab3fbcc7ada6303` (html2canvas-pro 2.3.5; same path)

Host wiring (not this folder):

- `hapi-boot.js` — HAPI web init (`appId: hapi-web`, `configUrl: /hapi/config`, `getHubJwt` for #176). Boots on `/opmic` knock or Settings pref.
- `hub/src/web/hapi-inline/` — `PINNED_TAG` must match this README. Allow-list: POST `messages` / `upload` / `abort`. `sttUrl: '/api/stt'`, `sttAuth: 'hub-jwt'`. `web/index.html` loads dock with `?v=<pin>`.
- v0.14.1 — #290 knock. Prior: #229 replies keepalive, #280 About trail, #259 session-name.

Re-vendor: copy `web/` from the next release-please tag. Drop any local dock fork.

Tracker: https://github.com/heavygee/hapi/issues/120
