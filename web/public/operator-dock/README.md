# Vendored hapi-inline operator dock

Pinned tag: **v0.23.1**  
Source: https://github.com/heavygee/hapi-inline/releases/tag/v0.23.1

Files here (`operator-dock.js`, `operator-dock.css`, `vendor/html2canvas.min.js`) are a byte copy of that release. Do not edit them in this repo.

SHA-1 (v0.23.1):

- `operator-dock.js` — `5fce70324ed1a177591c2aac6f4daccf9672dc3c`
- `operator-dock.css` — `2f4b1856493dc529409f09a7f9414901c80c2260`
- `vendor/html2canvas.min.js` — `00dac05dbfa83704e76c420a6ab3fbcc7ada6303` (html2canvas-pro 2.3.5; same path)

Host wiring (not this folder):

- `hapi-boot.js` — HAPI web init. Do **not** bake `hubBase` into remats — env/settings only.
- `hub/src/web/hapi-inline/` — `PINNED_TAG` must match this README. Public config keeps explicit `sttUrl: '/api/stt'` and `privilege: 'execute'`.
- v0.23.1 — Replies chrome no longer sticks on 8-char hub id after change_title (#576/#575). Keeps #567/#570/#557/#558/#535/#534.

Re-vendor: copy `web/` from the next release-please tag. Drop any local dock fork.

Tracker: https://github.com/heavygee/hapi/issues/120
