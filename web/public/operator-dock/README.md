# Vendored hapi-inline operator dock

Pinned tag: **v0.10.5**  
Source: https://github.com/heavygee/hapi-inline/releases/tag/v0.10.5

Files here (`operator-dock.js`, `operator-dock.css`, `vendor/html2canvas.min.js`) are a byte copy of that release. Do not edit them in this repo.

Host wiring (not this folder):

- `hapi-boot.js` — HAPI web init (`appId: hapi-web`, `configUrl: /hapi/config`). Boots on `/opmic` knock or Settings pref `hapi-operator-dock=true`.
- Settings → General → Show operator tools (owner-only). Tracker: https://github.com/heavygee/hapi/issues/123
- `hub/src/web/hapi-inline/` — operator-gated `/hapi` proxy (composed `/operator/sessions`, messages/upload only)

Re-vendor: copy `web/` from the next release-please tag. Drop any local dock fork.

Tracker: https://github.com/heavygee/hapi/issues/120
