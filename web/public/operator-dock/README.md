# Vendored hapi-inline operator dock

Pinned tag: **v0.20.0**  
Source: https://github.com/Heavygee-Projects/hapi-inline/releases/tag/v0.20.0

Files here (`operator-dock.js`, `operator-dock.css`, `vendor/html2canvas.min.js`) are a byte copy of that release. Do not edit them in this repo.

SHA-1 (v0.20.0):

- `operator-dock.js` — `83b61311fdb353b738f0921d6782bb8954b0f49a`
- `operator-dock.css` — `25c407a6969bd421dbbecf70f286d83efc818b19`
- `vendor/html2canvas.min.js` — `00dac05dbfa83704e76c420a6ab3fbcc7ada6303` (html2canvas-pro 2.3.5; same path)

Host wiring (not this folder):

- `hapi-boot.js` — HAPI web init. Do **not** bake `hubBase` into remats — env/settings only.
- `hub/src/web/hapi-inline/` — `PINNED_TAG` must match this README. Public config keeps explicit `sttUrl: '/api/stt'` and `privilege: 'execute'`.
- v0.20.0 — mic on replies interrupt composer (#466/#467). Keeps #453 Compose STT, #437 scroll freeze, #432 viewport crop, #419/#341 proxy `/hapi` wipe fix.

Re-vendor: copy `web/` from the next release-please tag. Drop any local dock fork.

Tracker: https://github.com/heavygee/hapi/issues/120
