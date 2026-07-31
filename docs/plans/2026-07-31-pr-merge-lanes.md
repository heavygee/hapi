# PR merge lanes (estate overlay) - 2026-07-31

Chip = health. Lane = local policy. Build order: (1) policy lib + tests (2) Meta queue sections (3) AGENTS A/B/C (4) optional merge automation later - **not yet**.

## Why size heuristics suck (salience)

Deterministic "small enough" by file/line count alone fails both ways:

| Example | Size | Paths | Auto-B? | Reality |
|---------|------|-------|---------|---------|
| #1268 / #1269 (merged) | tiny | tests only | **yes** | True lane B; tiann blessed taking these off his plate |
| #1270 issue tip (session e5d00bb1, not filed/pushed yet at audit) | 8 files, +511/-63 | `cli/` launcher + `shared/` SKU + tests | **no** (`product_paths`) | Feels "small enough" to humans; still runtime behavior - needs **promote** (`low-impact` / allowlist) |
| #1087 | 7 files, +293 | `cli/` ACP + docs | **no** | Focused Cursor worktree fix - still product |
| #1227 | 8 files, +792 | `web/` scratchlist park | **no** | Small file count, large delta, product |
| #1163 / #1108 / #945 / … | huge | product | **no** | Obvious lane A |

**Open heavygee PRs on `tiann/hapi` (2026-07-31 audit):** all classified **maintainer / product_paths** under auto-B - zero auto-B candidates among opens. Numbers seen: 847, 897, 945, 947, 958, 986, 987, 1087, 1108, 1163, 1227, 1228, 1271.

So salience for policy design:

1. Auto-B stays **strict** (no product under `cli/src|hub/src|web/src|shared/src` except tests; size caps as backstop).
2. Human **promote** is the escape hatch for focused runtime fixes (#1270-class).
3. Do not teach agents "if lines < N then merge."

## Blessing

[#1268](https://github.com/tiann/hapi/pull/1268) comment from @tiann: *"Sounds great! Thanks for helping out."* after heavygee self-merged a test-only flake fix and offered to take low-impact PRs off the plate.

## Implementation

- `scripts/tooling/lib/pr-merge-policy.sh` + `.test.sh`
- `scripts/tooling/pr-merge-policy.example.json` → copy to `~/.hapi/pr-merge-policy.json`
- `hapi-pr-emoji-batch.sh`: on `✅`, overlay `mergeLane` + rewrite `action`
- `hapi-meta-daily.sh`: queue sections **WAIT TIANN** / **SELF-MERGE ELIGIBLE**
- `docs/operator/AGENTS.md` § Upstream relationship

Meta CLI still never runs `gh pr merge`.

## Label ownership

One promote label: **`low-impact`** on `tiann/hapi`.

We dropped `self-merge-ok` - it was on-the-nose and redundant. Lane B = `low-impact` (or auto tests/docs) **and** chip `✅` (CI/bot/threads). The health chip already gates "ok to merge"; a second "please merge me" label added no signal.

**Owner session:** [Issue labelling (tiann/hapi)](/sessions/f3c41205-ba17-465e-8964-8e46f190f208) (`f3c41205-ba17-465e-8964-8e46f190f208`) - daily ~09:00 UTC sweep; apply `low-impact` on focused heavygee PRs by judgment.

| Label | Apply when | Do not |
|-------|------------|--------|
| `low-impact` | Focused PR (or issue whose fix PR will be) with small blast radius - product OK if scoped; human judgment | Auto-slap on every "small" bug; never as sole size heuristic; never on others' / `community-pr` without ask |

Policy reads **PR** labels via `pr-merge-policy.sh`. Issue-only labels are advisory until the PR exists. Allowlist (`allow_pr_numbers`) remains the escape hatch if you want B without the public label.
