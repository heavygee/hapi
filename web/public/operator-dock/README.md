# Vendored hapi-inline operator dock

Pinned tag: **v0.11.6**  
Source: https://github.com/heavygee/hapi-inline/releases/tag/v0.11.6

Files here (`operator-dock.js`, `operator-dock.css`, `vendor/html2canvas.min.js`) are a byte copy of that release. Do not edit them in this repo.

SHA-1 (v0.11.6):

- `operator-dock.js` — `b0c0b57b00a72d22485ea00043e20cb63e5aad98`
- `operator-dock.css` — `0fba77a6c9a33f72fabc0486a0b6e34cbb4d21f8`
- `vendor/html2canvas.min.js` — `00dac05dbfa83704e76c420a6ab3fbcc7ada6303` (html2canvas-pro 2.3.5; same path)

Host wiring (not this folder):

- `hapi-boot.js` — HAPI web init (`appId: hapi-web`, `configUrl: /hapi/config`). Boots on `/opmic` knock or Settings pref `hapi-operator-dock=true`. Package fail-closes H/markup when gate secret missing/bad (#155 / v0.11.6).
- Settings → General → Show operator tools (owner-only). Probes gate secret before enable (#123).
- `hub/src/web/hapi-inline/` — operator-gated `/hapi` proxy (composed `/operator/sessions`, messages/upload only)

Re-vendor: copy `web/` from the next release-please tag. Drop any local dock fork.

Tracker: https://github.com/heavygee/hapi/issues/120
