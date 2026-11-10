# Fleet upgrade "what's new" in skew banner (#248)

**Status:** v1 implementing alongside #247 deliberate push (parallel track; does not block P0).
**Issue:** https://github.com/heavygee/hapi/issues/248

## Why

Deliberate push means Doug / Ian / standalone personal hubs get new binaries without choosing the moment. They need to see **what changed**, not just that the binary moved. There is no in-app changelog surface today.

## Design (v1 - dogfood on fork)

```
soup publish → NOTES.md next to manifest.json  (+ same body on GH Releases)
                     ↓
hub readPublishedSoupTip → HubUpgradeOffer.releaseNotes + soupTag
                     ↓
GET /api/upgrade/offer (existing)
                     ↓
RunnerVersionSkewBanner → <details> plain markdown dump
```

### Sequencing vs #247

| Tier | Work |
|------|------|
| P0 | restore upgrade-runner, kill unattended auto (done @ `f5c3933b6`) |
| P1 | deliberate `push-upgrade` + per-machine auto (same tip) |
| **P1.5** | **this** - notes on offer + banner (thin tip after #247 remat) |
| P2 | richer history, per-machine applied tip, upstream PR |

### Non-goals v1

- Fancy changelog app / search
- Per-machine "what you received last" history (follow-up)
- Calling `gh` from the hub at request time (local `NOTES.md` only)
- Upstream PR until fork dogfood proves it

### Publish contract

`driver_soup_single_exe_publish` writes `NOTES.md` using the same `driver_soup_single_exe_release_notes` text mirrored to GitHub Releases. Hub never needs network for notes.

**Fleet channel (primary official notes):** `hapi-fleet-seal` upserts the moving
`hapi-fleet` release with the official changelog as the GitHub body **and**
uploads `NOTES.md` (Layer A downloads it beside `manifest.json`). Tip-dated
releases are secondary; do not leave `hapi-fleet` on a pointer-only stub.

Changelog rules: **never truncate** (scroll in the banner). Fleet channel notes
prefer the full range since `fleet-notes-baseline-tag.txt` so a missed NOTES
publish is caught up on the next seal.

### Backfill

Existing tips without `NOTES.md`: banner omits the section. Ops can copy GH release body into `/var/lib/hapi/soup-artifacts/<tag>/NOTES.md` for the current `latest` until the next publish.

## Friction / kill criteria

- If NOTES stay boilerplate after Meta's publish fix, the banner is worse than silence - kill the expandable until notes quality is real.
- Cap dump height (`max-h-40`); do not let notes steal the session list.
