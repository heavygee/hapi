# Postmortem: lane B promote of #1413 (share-native-deeplink)

Date: 2026-08-11  
PR: [tiann/hapi#1413](https://github.com/tiann/hapi/pull/1413) (Fixes #1412)  
Merge: squash `a0621194` by heavygee after `low-impact` label  
Session: `2bd956ae-62ec-4ac9-824b-f72ba75b977f`

## Decision under review

Operator promoted #1413 to lane B (`low-impact`) and directed a self-merge.
Auto-classifier said **lane A / `product_paths`**. The promote was deliberate, not automatic.

## What landed (blast radius)

8 files, +629/−34, **web-only**:

| Path | Change |
|------|--------|
| `web/src/lib/shareTransfer.ts` | Fragment deep-link parse/scrub + optional `fileUrl` fetch (50 MiB stream cap) |
| `web/src/routes/share/index.tsx` | Ingest branch before no-id; StrictMode-safe hash capture |
| `web/src/router.tsx` | `validateSearch` → `parseShareSearch` (`id`/`error` only) |
| `web/src/lib/attachmentAdapter.ts` | Export existing `MAX_UPLOAD_BYTES` (no limit change) |
| tests + `docs/guide/pwa.md` + README | Coverage / contract |

**Not touched:** hub, CLI, shared schemas, service-worker POST share target, composer handoff after `?id=`.

### Who feels it

- **Android Web Share Target (POST):** effectively unchanged; `?id=` still wins.
- **`/share#url&text&title`:** new on-ramp (Quest-class companions).
- **`/share#…&fileUrl=`:** new browser fetch into IDB — **undogfooded** at merge.

## Why full green was necessary but insufficient

Bot Majors were fixed (query→fragment logging, StrictMode scrub race, unbounded `fileUrl`). Final Findings: None. CI green.

Green does not mean low-impact. Residual gaps at merge:

1. Public companion contract churned mid-PR (query → fragment; APK 1.1.33).
2. `fileUrl` path unproven on headset.
3. Cold VIEW into warm PWA may need hard-reload (dogfood note).
4. No @tiann review — the point of lane A for product.

## Lane policy vs this promote

| | Auto-B (#1268 class) | #1413 promote |
|--|--|--|
| Paths | tests/docs only | `web/src/` product |
| Size | ≤120 delta | 663 lines |
| Mechanism | automatic | human `low-impact` |
| Blessing fit | take flake/docs off plate | ship a new companion ingress |

Policy **allows** promote. It does **not** equate "CI green + impatience" with low-impact.
`low-impact` should mean "tiann would shrug," not "chip says wait-on-tiann and I overrode it."

## Verdict

- **Code impact:** additive on-ramp; existing share mostly safe; real residual risk is `fileUrl` + companion contract discipline.
- **Process impact:** stretches the #1268 blessing. Fine as a conscious operator call; bad as a habit for +600 product PRs.

## Rule of thumb going forward

Promote to lane B when blast radius is opt-in and revert is cheap **and** you would not be embarrassed explaining the skip to @tiann.
Otherwise leave lane A.

## Related

- Exit reflection (Gate A'): `docs/plans/retros/2026-08-11-share-native-deeplink-exit.md`
- Lane canon: `docs/plans/2026-07-31-pr-merge-lanes.md`, `docs/operator/AGENTS.md` § Upstream relationship
