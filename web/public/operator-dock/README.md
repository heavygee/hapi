# Vendored hapi-inline operator dock

Pinned tag: **v0.13.0**  
Source: https://github.com/heavygee/hapi-inline/releases/tag/v0.13.0

Files here (`operator-dock.js`, `operator-dock.css`, `vendor/html2canvas.min.js`) are a byte copy of that release. Do not edit them in this repo.

SHA-1 (v0.13.0):

- `operator-dock.js` — `a8e979993fb19e704669b1ab396ba4f8e45c84be`
- `operator-dock.css` — `e2e29a2b4bf69af214ce63a8c4abedd44fec4d43`
- `vendor/html2canvas.min.js` — `00dac05dbfa83704e76c420a6ab3fbcc7ada6303` (html2canvas-pro 2.3.5; same path)

Host wiring (not this folder):

- `hapi-boot.js` — HAPI web init (`appId: hapi-web`, `configUrl: /hapi/config`, `getHubJwt` for #176). Boots on `/opmic` knock or Settings pref `hapi-operator-dock=true`. Clears known-bad stored secret before init (host complement to package #158).
- Settings → General → Show operator tools (owner-only). Gate probe (#123).
- `hub/src/web/hapi-inline/` — `PINNED_TAG` must match this README. Allow-list: POST `messages` / `upload` / `abort`. Public config: `sttUrl: '/api/stt'`, `sttAuth: 'hub-jwt'` (#176). `web/index.html` loads dock with `?v=<pin>`.
- v0.12.18+ session-name on Agent replies (#259). v0.12.23+ replies poll keepalive + Send restart (#229). v0.13.0 About/changelog trail (#280).

Re-vendor: copy `web/` from the next release-please tag. Drop any local dock fork.

Tracker: https://github.com/heavygee/hapi/issues/120
