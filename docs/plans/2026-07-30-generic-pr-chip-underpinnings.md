# Generic PR chip underpinnings + estate display overrides

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Make upstream `externalRefs` PR status forge-native only; move Meta/soup vocabulary (emoji, babysit labels, "wait on tiann", `pre_pr`) into overrideable estate display config.

**Architecture:** Protocol stores identity + optional GitHub-shaped snapshot (`openState` / `checks` / `merge` / `statusCheckedAt`) plus optional opaque `estateCode`. Default chip renderer maps forge fields with boring generic terms. Estate file (`HAPI_HOME/pr-chip-display.json`) overrides emoji/labels/tones/staleMs/`estateCode` → action strings. Hub serves the resolved profile on `GET /api/features` (or sibling). Meta classifier writes forge facts + `estateCode`; it does not invent protocol enums.

**Tech Stack:** Zod schemas in `shared`, hub settings file load, web `SessionPrChip`, fork Meta scripts consume the same JSON.

**Upstream PR:** reshape [tiann/hapi#1163](https://github.com/tiann/hapi/pull/1163) (no backward compat).

**Companion ADR:** update `docs/plans/2026-07-25-github-pr-awareness-optin-and-attachment.md` § D8.

---

## Non-goals

- Live browser → GitHub queries (still forbidden)
- Shipping Meta babysit classifier upstream
- Multi-forge beyond `github_pr` kind (still additive union later)

---

## Schema (generic underpinnings)

Replace on `GithubPrExternalRef`:

```ts
// REMOVE: status: clean|pending|needs_work|pre_pr|merged|unknown
// REMOVE: statusAction: string
// REMOVE: githubPrStatusEmoji / githubPrStatusFromEmoji from protocol contract

openState?: 'open' | 'closed' | 'merged' | 'draft'
checks?: 'pass' | 'fail' | 'pending' | 'none' | 'unknown'
merge?: 'clean' | 'conflicting' | 'blocked' | 'behind' | 'unstable' | 'draft' | 'unknown'
statusCheckedAt?: number  // ms; honesty mute when stale
estateCode?: string       // max 64; opaque; only estate display profile interprets
```

`merge` values track GitHub `mergeStateStatus` (subset). `checks` tracks rollup. No `pre_pr` in protocol — that is an estateCode (`peer.incubating`) if the estate wants it.

Preserve-on-relink: keep forge snapshot + `estateCode` for same `repo#N` unless writer sets them explicitly (same sticky behavior as today, new field names).

---

## Estate display config

**Path:** `$HAPI_HOME/pr-chip-display.json` (optional). Missing file → built-in generic defaults from `shared`.

```jsonc
{
  "staleMs": 7200000,
  "forge": {
    "checks.fail": { "emoji": "", "tone": "needs_work", "label": "checks failed" },
    "merge.conflicting": { "emoji": "", "tone": "needs_work", "label": "conflicts" },
    "merge.clean+checks.pass": { "emoji": "", "tone": "ok", "label": "ready to merge" },
    "openState.merged": { "emoji": "", "tone": "merged", "label": "merged" },
    "openState.draft": { "emoji": "", "tone": "muted", "label": "draft" },
    "checks.pending": { "emoji": "", "tone": "pending", "label": "checks running" }
  },
  "estateCodes": {
    "babysit.green": { "emoji": "✅", "tone": "ok", "label": "clean", "action": "full green — wait on tiann" },
    "babysit.needs_work": { "emoji": "⚠️", "tone": "needs_work", "action": "…" },
    "babysit.pending": { "emoji": "🔁", "tone": "pending" },
    "peer.incubating": { "emoji": "📝", "tone": "muted", "label": "pre-PR" },
    "babysit.merged": { "emoji": "🔧", "tone": "merged" }
  }
}
```

**Resolution order for chip display:**

1. If `estateCode` matches a profile entry → use it (estate wins).
2. Else first matching `forge` rule (specificity: compound keys before singles; document order).
3. Else identity-only (`#N`, default link tone).
4. If `statusCheckedAt` older than `staleMs` → mute + `?` (generic honesty).

Upstream ships empty/minimal `estateCodes` and generic forge labels (no Meta prose, emoji optional/empty by default for upstream defaults — estate file adds the mood-ring glyphs).

---

## API

Extend `GET /api/features` response:

```ts
prChipDisplay: PrChipDisplayProfile  // resolved defaults ⊕ file
```

No PATCH for v1 (file + restart / hub reload is enough for estate). Optional later: PATCH under operator auth.

---

## Callers to update

| Caller | Change |
|--------|--------|
| `SessionPrChip` | Render via display profile, not `githubPrStatusEmoji(status)` |
| Meta `hapi-pr-emoji-batch` / `hapi-meta-daily` | Write `openState`/`checks`/`merge` + `estateCode`; stop writing old `status`/`statusAction` |
| Soup classify-on-attach | Same field names |
| Tests / fixtures | New shapes; delete emoji↔enum protocol tests |
| ADR D8 | Rewrite to forge + estate overlay |

---

## Tasks

### Task 1: Schema + helpers (shared)

**Files:** `shared/src/schemas.ts`, `shared/src/externalRefs.ts`, `shared/src/schemas.externalRefs.test.ts`, `shared/src/types.ts`, `shared/src/index.ts`

- Replace status enum with forge fields + `estateCode`
- Add `DEFAULT_PR_CHIP_DISPLAY` + `resolvePrChipDisplay(ref, profile, nowMs)`
- Delete emoji↔Meta-status protocol helpers (or move to fork-only script helper, not `@hapi/protocol`)

### Task 2: Hub loads + serves profile

**Files:** `hub/src/config/prChipDisplay.ts`, `hub/src/web/routes/features.ts`, tests

- Load `$HAPI_HOME/pr-chip-display.json`, merge over defaults
- Expose on features GET

### Task 3: Web chip

**Files:** `web/src/components/SessionPrChip.tsx`, tests, `useFeatures`, locales if needed

- Consume profile from features hook (fallback to shared defaults if features offline)
- Tooltip shows forge label / estate action from profile, never raw Meta enum names

### Task 4: Estate sample config + Meta writers (fork)

**Files:** `scripts/tooling/config/pr-chip-display.estate.json` (sample), `lib/pr-emoji-core.sh` / meta-daily write path

- Sample estate file with current emoji vocabulary as overrides
- Classifier emits forge snapshot + `estateCode=babysit.*`
- Install/copy note in operator AGENTS

### Task 5: ADR + #1163 body

- Rewrite D8; comment on PR that status model is forge-native + estate display overlay

### Task 6: Verify

- `bun typecheck && bun run test` (relevant packages)
- Force-push #1163

---

## Kill criteria

- Upstream chip tooltip contains "tiann" or "babysit" with **no** estate file → FAIL
- `pre_pr` appears in `@hapi/protocol` schemas → FAIL
- Estate file can restore ✅/⚠️/🔁/📝/🔧 mood ring without protocol change → PASS

## Friction

Steelman: one coarse status enum is simpler for agents. Rejected for upstream because `clean` already means two different things (GH CLEAN vs Meta green). Opaque `estateCode` + forge facts is the cheapest split that keeps both honest.
