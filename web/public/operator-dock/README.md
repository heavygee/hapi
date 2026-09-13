# Vendored hapi-inline operator dock

Pinned tag: **v0.12.23**  
Source: https://github.com/heavygee/hapi-inline/releases/tag/v0.12.23

Files here (`operator-dock.js`, `operator-dock.css`, `vendor/html2canvas.min.js`) are a byte copy of that release. Do not edit them in this repo.

SHA-1 (v0.12.23):

- `operator-dock.js` — `40355b5d987138c31da5b12e8dc762c966aa3a9d`
- `operator-dock.css` — `c61c24d6e1906925b2d82ba39bcb109e6d1dac8b` (#221 H hub lift; #229 replies poll keepalive + Send restart)
- `vendor/html2canvas.min.js` — `00dac05dbfa83704e76c420a6ab3fbcc7ada6303` (html2canvas-pro 2.3.5; same path)

Host wiring (not this folder):

- `hapi-boot.js` — HAPI web init (`appId: hapi-web`, `configUrl: /hapi/config`, `getHubJwt` for #176). Boots on `/opmic` knock or Settings pref `hapi-operator-dock=true`. Clears known-bad stored secret before init (host complement to package #158). Package fail-closes H/markup when gate secret missing/bad (#155 / v0.11.6+).
- Settings → General → Show operator tools (owner-only). In-page gate field (no `window.prompt`); probes before enable (#123).
- `hub/src/web/hapi-inline/` — operator-gated `/hapi` proxy. `PINNED_TAG` in `config.ts` is what the mic payload `build` field reports (must match this README pin). Cursor spawn sends `model: auto`. Package spawnHubBody also defaults `model` to auto (#165). Allow-list: POST `messages` / `upload` / `abort` (GET abort forbidden). Public config: `sttUrl: '/api/stt'`, `sttAuth: 'hub-jwt'` (#176). Host STT wiring unchanged through v0.12.23. Gate secret stays on `/hapi/*`. `web/index.html` loads dock assets with `?v=<pin>`.
- Agent replies header shows hub session name since package **v0.12.18** (#259).
- Agent replies poll keepalive + Send restart since **v0.12.23** (#229).

Re-vendor: copy `web/` from the next release-please tag. Drop any local dock fork.

Tracker: https://github.com/heavygee/hapi/issues/120
