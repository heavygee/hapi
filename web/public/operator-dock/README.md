# Vendored hapi-inline operator dock

Pinned tag: **v0.18.1**  
Source: https://github.com/heavygee/hapi-inline/releases/tag/v0.18.1

Files here (`operator-dock.js`, `operator-dock.css`, `vendor/html2canvas.min.js`) are a byte copy of that release. Do not edit them in this repo.

SHA-1 (v0.18.1):

- `operator-dock.js` — `615d76d3b71b51cc8a134296b5d8e13b955f6000`
- `operator-dock.css` — `bbf7460ea3a5ba7fd585b49834564f5e5dd35877`
- `vendor/html2canvas.min.js` — `00dac05dbfa83704e76c420a6ab3fbcc7ada6303` (html2canvas-pro 2.3.5; same path)

Host wiring (not this folder):

- `hapi-boot.js` — HAPI web init. Do **not** bake `hubBase` into remats — env/settings only.
- `hub/src/web/hapi-inline/` — `PINNED_TAG` must match this README.
- v0.18.1 — Quest Browser whisper over broken Web Speech (#364); includes Quest label #334/#343.

Re-vendor: copy `web/` from the next release-please tag. Drop any local dock fork.

Tracker: https://github.com/heavygee/hapi/issues/120
