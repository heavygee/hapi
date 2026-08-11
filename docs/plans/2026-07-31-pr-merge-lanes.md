# PR merge lanes (estate overlay) - 2026-07-31

Chip = health. Lane = local policy. Build order: (1) policy lib + tests (2) Meta queue sections (3) AGENTS A/B/C (4) optional merge automation later - **not yet**.

## Amendment 2026-08-09 - drop path-kind reject

**Retired:** auto-B short-circuit `product_paths` ("because product" → lane A). Touching `cli/src|hub/src|web/src|shared/src` is no longer a hard reject.

**Current auto-B:** size caps on **product files only** (≤8 files, ≤120 delta). Unit/spec tests (`*.test.*`, `*.spec.*`, `__tests__/`, `__mocks__/`) are excluded from both caps - they measure thoroughness, not blast radius. Pure test-only PRs (#1268 class) stay auto-B. Docs still count. Product under caps → lane B. Oversized / judgment-call → still needs **promote** (`low-impact` / allowlist).

**Why:** Meta was teaching "wait on tiann (product_paths)" for every runtime PR, which contradicted the label table ("product OK if scoped") and the #1268 blessing scope. Path kind is a weak proxy for blast radius; size + human promote is enough.

**Kill criterion:** first wrong auto-merge of a sneaky under-cap product change → restore a tighter gate or lower caps. Do not reintroduce path-kind as the sole Meta "wait tiann" reason without revisiting this amendment.

## Why size heuristics suck (salience) - historical 2026-07-31

Deterministic "small enough" by file/line count alone fails both ways. Original audit used a **path-kind** auto-B gate (since removed):

| Example | Size | Paths | Auto-B then | Reality |
|---------|------|-------|-------------|---------|
| #1268 / #1269 (merged) | tiny | tests only | **yes** | True lane B; tiann blessed taking these off his plate |
| #1270 issue tip (session e5d00bb1, not filed/pushed yet at audit) | 8 files, +511/-63 | `cli/` launcher + `shared/` SKU + tests | **no** (`product_paths`) | Oversized - still needs **promote** under 2026-08-09 rules (`too_large_delta`) |
| #1087 | 7 files, +293 | `cli/` ACP + docs | **no** | Oversized |
| #1227 | 8 files, +792 | `web/` scratchlist park | **no** | Oversized |
| #1163 / #1108 / #945 / … | huge | product | **no** | Obvious lane A |

**Open heavygee PRs on `tiann/hapi` (2026-07-31 audit):** all classified **maintainer / product_paths** under the old auto-B - zero auto-B candidates among opens. Numbers seen: 847, 897, 945, 947, 958, 986, 987, 1087, 1108, 1163, 1227, 1228, 1271.

Salience for policy design (updated):

1. Auto-B is **size-capped** (product paths OK under caps).
2. Human **promote** is the escape hatch for oversized focused fixes (#1270 / #1430-class).
3. Do not teach agents "if lines < N then merge" without chip green + policy lane B.

## Blessing

[#1268](https://github.com/tiann/hapi/pull/1268) comment from @tiann: *"Sounds great! Thanks for helping out."* after heavygee self-merged a test-only flake fix and offered to take low-impact PRs off the plate.

## Implementation

- `scripts/tooling/lib/pr-merge-policy.sh` + `.test.sh`
- `scripts/tooling/pr-merge-policy.example.json` → copy to `~/.hapi/pr-merge-policy.json`
- `hapi-pr-emoji-batch.sh`: on `✅`, overlay `mergeLane` + rewrite `action`
- `hapi-meta-daily.sh`: queue sections **WAIT TIANN** / **SELF-MERGE ELIGIBLE**
- `docs/operator/AGENTS.md` § Upstream relationship

Meta CLI still never runs `gh pr merge` (operator/Meta-with-TTY does).

## Merge UX (quiet)

When merging lane B: **just merge** (squash). Do **not** leave a trail comment about "estate lane B", the #1268 blessing, or why the merge is allowed. That was a one-time courtesy on the first community auto-B (#978). From then on, eligibility is read from policy + chip - not restated on the PR.

## Label ownership

One promote label: **`low-impact`** on `tiann/hapi`.

We dropped `self-merge-ok` - it was on-the-nose and redundant. Lane B = `low-impact` (or auto tests/docs) **and** chip `✅` (CI/bot/threads). The health chip already gates "ok to merge"; a second "please merge me" label added no signal.

**Owner session:** [Issue labelling (tiann/hapi)](/sessions/f3c41205-ba17-465e-8964-8e46f190f208) (`f3c41205-ba17-465e-8964-8e46f190f208`) - daily ~09:00 UTC sweep; apply `low-impact` on focused heavygee PRs by judgment.

| Label | Apply when | Do not |
|-------|------------|--------|
| `low-impact` | Focused PR (or issue whose fix PR will be) with small blast radius - product OK if scoped; human judgment | Auto-slap on every "small" bug; never as sole size heuristic; never on others' / `community-pr` without ask |

Policy reads **PR** labels via `pr-merge-policy.sh`. Issue-only labels are advisory until the PR exists. Allowlist (`allow_pr_numbers`) remains the escape hatch if you want B without the public label.
