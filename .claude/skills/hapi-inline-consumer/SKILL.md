---
name: hapi-inline-consumer
description: >-
  Integrate or maintain the hapi-inline operator mic in a consuming app.
  Use when vendoring operator-dock, wiring /hapi proxy or browser-hub,
  touching ?opmic visibility, or when an agent wants to “fix the mic”
  inside jessica-story / newman / any host app.
---

# hapi-inline consumer

## Mandatory first step

1. Read the contract in **heavygee/hapi-inline**:
   `https://github.com/heavygee/hapi-inline/blob/main/docs/CONSUMER_CONTRACT.md`
2. Ensure the paste block from
   `https://github.com/heavygee/hapi-inline/blob/main/docs/consumer-agents-snippet.md`
   is present in **this app’s** `AGENTS.md` and `CLAUDE.md` (if used). If missing, add it before any dock work.

## Hard rule

- **Do not** lasting-edit vendored dock/proxy/contract files in the app.
- **Do** file issues on `heavygee/hapi-inline`.
- Owner lands the change → release-please tag → **re-vendor** here.

Emergency app hotfix → same-day issue + round-trip + re-vendor (see contract).

## Vendor command shape

Pin a release tag (example):

```bash
TAG=v0.7.2
# copy web/operator-dock.js web/operator-dock.css web/vendor/ from that tag
```

Record the pinned tag next to the vendored files.
