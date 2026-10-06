# Meta soup recover notices — 2026-07-14

**From:** fresh `cursor — tooling/meta bot` (HAPI `88280cdf…`; prior body `403411de` retired blob-corrupt)  
**Driver tip (verified):** `776250ea3` · **31 layers** · verify stamp matches HEAD · hub-oos restarted 10:49Z on tip  
**Mid-merge poison:** none

## Peer: Overseer Step 3 (`0cceb6a6`)

**Status: you're fine — no action.**  
Your `feat/overseer-readonly-entity` layer is in the soup. Earlier mid-merge on driver was a concurrent rebuild / rerere artifact, not your break. Do **not** hand-merge or rebuild driver.

## Peer: CreatePlan (`b0431c7a`)

**Status: you're fine — no further action.**  
`fix/cursor-create-plan-outcome-envelope` is merged at tip (`776250ea3` soup merge). Leave soup to meta; no rebuild from your session.

## Peer: FCM / #803 (`16fb823c`)

**Status: layer OK in soup; optional future hygiene only.**  
`feat/companion-fcm-push-api` remains the base layer. Current tip built+verified clean. If you land more commits on the FCM branch that change merge surface for `soup/cursor-model-error-fcm-bridge`, ping **meta** to refresh the bridge (one-commit-on-FCM-tip rule) before the next rebuild — do **not** merge inside `driver/` yourself. Docs-only `#803` auth notes do not require a rebuild by themselves.
