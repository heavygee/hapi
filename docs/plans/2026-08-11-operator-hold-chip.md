# Operator-hold chip + fleet upgrade salvage

> Incident: Tiann asked to trim #1108 (2026-08-02T01:26Z, [comment](https://github.com/tiann/hapi/pull/1108#issuecomment-5154418101)). No operator decision. Babysit agent thinned 2026-08-11T12:52Z. Squash-merged 14:24Z. Operator learned a week later in chat.
>
> **For Claude:** Track A is the chip. Track B is fork-only upgrade rehydrate. Do not mix them in one PR.

**Goal:** Give the operator an unmissable, infrequent, latching PR-chip state when a human maintainer (or equivalent) changes the work outside the agent loop - and keep the fat #1108 upgrade stack as a named backup for estate soup.

**Architecture:** Do not add another agent-rouse emoji. `⚠️` already means "peer, go fix CI/threads." The miss is **operator-only hold**. New chip state beats `⚠️` in `pec_worst_emoji`, **never hourly-pings the coding peer**, pulses on the existing PR chip, emits one Overseer/`needs_decision` inbox item, and clears only on explicit operator ack. Detector is identity + surface, not NLP.

**Tech Stack:** `config/pr-chip-states.yaml`, `lib/pr-emoji-core.sh`, `hapi-meta-daily.sh`, soup `SessionPrChip` (github-pr-awareness layer), existing `needs_decision` channel events, FCM/notify if already wired for session-bound events.

---

## Playback (operator)

What you asked: a glanceable hold when something outside our known babysit loop affects the work - scope cut, maintainer decision - without another haystack of agent pings. And get the fat upgrade tip back because the fleet still needs hub-push even if upstream will not take it.

What already exists (and failed you):

| Piece | What it does today | Why #1108 still slipped |
|-------|--------------------|-------------------------|
| Hourly Meta classify | Chip `✅🔁⚠️📝🔧🧹` | Tiann comment does not change the chip |
| `📨 NEW GITHUB COMMS` | Printed in Meta cron stdout | Haystack; not on the session um |
| `--emit-events` notif path | `needs_decision` for GitHub notifs, mapped to **⚠️** | Default mental model is "agent work"; 45m timer emits but chip stays green |
| Overseer contracts | `needs_decision` = operator judgement | Not bound to the PR chip glance |
| `AGENT_NOTIFY_SUMMARY` `needs_decision` | Peer self-report | Peers did not self-report a scope cut; they executed it |

Proposed gap: **hold is a chip state + operator ack**, not a log line and not a peer ping.

---

## Track A - `🛑 needs_operator` (babysit.hold)

### Contract

| Field | Value |
|-------|--------|
| Emoji | `🛑` (unmissable; not `⚠️`, not `?`) |
| `status` | `needs_operator` |
| `estateCode` | `babysit.hold` |
| Rank | **7** - worst of all (`?` is 6, `⚠️` is 5). Hold beats red CI so agents cannot "fix" a maintainer cut by thinning. |
| Sticky peer ping | **false** |
| Operator notify | **once per latch** (FCM / Overseer inbox). Never hourly "are you done yet" |
| Clear | Operator ack only (`hapi hold-ack <pr>` / chip tap / inbox dismiss). Agent GitHub reply does **not** clear |
| Agent rule | If chip is `needs_operator`: **stop**. Do not thin, do not "address Tiann", do not push. Wait. |

### Detector (tight, infrequent)

Do **not** NLP "trim" / "drop". Tiann does not spam PR comments. False-positive "thanks" → one-tap ack is cheaper than missing a scope cut.

Latch `🛑` when **all** of:

1. Linked `github_pr` chip on `tiann/hapi` or `heavygee/hapi`
2. New item is a **human** issue comment or review *body* (not inline bot Findings thread, not `github-actions[bot]`, not Dependabot)
3. Author login ∈ `HAPI_PR_HOLD_LOGINS` (default: `tiann`). Config: `~/.hapi/pr-hold.json` or env. Expand later (CODEOWNERS) without changing rank/ack
4. Not already latched for this `(pr, comment-id)` fingerprint

Optional second latch (phase 2): review_requested from those logins.

Kill-criterion for detector: if `github-actions` or Codex bot can set `🛑`, the design has failed.

### What Meta must not do on `🛑`

- Must **not** ping the coding peer to resume/fix
- Must **not** treat it as `⚠️` in `pec_worst_emoji` ties
- May ping **operator** once (existing notify / Overseer), then silence until ack or new distinct fingerprint

### UI

Pulse on `SessionPrChip` while `estateCode === babysit.hold` (reuse `FueDot` pulse, not a new FUE feature-id). Tooltip = `statusAction` (first 140 chars of the maintainer comment + link). Chip tap or session header action = ack.

Soup: awareness layer already owns the chip. Track A ships classifier on fork `main` first (chip cache writes `needs_operator` even if UI falls back to generic tone), then soup-promote chip pulse.

### Tests

- `pr-emoji-core.test.sh`: rank 7 beats ⚠️; `pec_status_from_emoji 🛑` = `needs_operator`; strip leading 🛑 from titles
- Meta daily test: human tiann comment → hold; bot Findings → no hold; ack fingerprint → back to live classify
- Web chip test (awareness layer): pulse class present iff hold

### Agent canon (one paragraph, High-signal later)

Any `@tiann` (or hold-login) comment on a Lane A PR is **operator work**, not babysit work. Do not execute "trim this PR" from a review comment. Chip `🛑` means stop.

---

## Track B - fat upgrade stack (estate, not upstream)

Pinned 2026-08-11 (this session):

| Branch | SHA | What |
|--------|-----|------|
| `origin/backup/hub-runner-version-governance-fat` | `687982a84` | Named fat backup (supervised Upgrade → systemd exit) |
| `origin/backup/hub-runner-version-governance-pr-head-fat` | `fee9084b` | Last fat PR head before thin force-push 2026-08-11T12:52Z |

Both still contain `cli/src/upgrade/` + hub artifact/tunwg.

**Do not remat mid-wave.** After Meta remats upstream squash `1cd4d1137` into soup:

1. New worktree off **current** `upstream/main` (thin already landed)
2. Replay fat upgrade paths only (not the duplicate banner/caps that already merged)
3. Fork-only soup layer, e.g. `estate/fleet-runner-upgrade` - **never** open as tiann #1108 follow-up unless operator explicitly wants another Lane A fight
4. Dogfood: one already-onboarded runner (`runner-self-upgrade` live) auto-applies; one legacy host does not loop-toast (Tiann's point 1 is real - first generation is still manual)

Tiann's rationale stays valid for *upstream*. Estate still wants the onboarding-then-auto loop. That is a product disagreement, not a git failure.

---

## Friction / kill-criteria

- **Steelman no-new-emoji:** bind GitHub notifs harder into Overseer only. Rejected: glance surface is the chip; #1108 was ✅ while the cut sat in cron stdout.
- **Steelman NLP trim-detector:** rejected; identity latch is infrequent enough.
- **Kill-criterion A:** one week of dogfood with zero `🛑` on bot noise; at least one synthetic tiann-login fixture in tests.
- **Kill-criterion B:** fat layer must refuse auto-upgrade when live RPC missing (no 15m toast forever).

---

## Implementation tasks (Track A, after operator confirms playback)

### Task 1: State contract

**Files:** `config/pr-chip-states.yaml`, `scripts/tooling/config/pr-chip-display.estate.json`, `scripts/tooling/lib/pr-emoji-core.sh` (+ `.test.sh`)

Add `needs_operator` / `🛑` / rank 7 / `stickyPing: false`. Title strip includes 🛑. **Shipped** on `tooling/operator-hold-chip` (PR #124).

### Task 2: Latch in Meta

**Files:** `scripts/tooling/hapi-meta-daily.sh`, `hapi-meta-daily.test.sh`

After classify, overlay hold from GitHub issue comments + review bodies. Persist `hold` in `meta-daily.json` (`pr`, `comment_id`, `author`, `url`, `acked`). `pec_worst_emoji` with live emoji. Skip peer ping when combined is 🛑. Emit one `needs_decision` event per new latch (`--emit-events` path already on 45m timer). **Shipped** (`pr-hold-core.sh` + Meta overlay tests).

### Task 3: Ack

**Files:** new `scripts/tooling/hapi-hold-ack.sh`; optional MCP later

`hapi hold-ack <pr>` sets `acked`. Next Meta run returns to live classify. Chip tap in web is the same hub mutation if we add a tiny route; v1 CLI ack is enough. **Shipped** CLI ack; chip-tap route still deferred.

### Task 4: Chip pulse (soup)

**Files:** awareness `SessionPrChip` + `FueDot`

Pulse + tooltip. Do not put 🛑 in session titles (ADR D8). **Shipped** soup layer `driver/operator-hold-chip`; peer proof `e2e/peer/121-operator-hold-chip.spec.ts`.

### Task 5: Agent rule

**Files:** `docs/operator/AGENTS.md` High-signal row + Meta watcher legend; lifecycle one-liner. No title emoji. **Shipped** on the classifier branch.

---

## Intake status

- [x] 1 Code search - Meta queue + notif events + chip YAML exist; no hold state
- [x] 2 Upstream search - no tiann/hapi issue for this; fork-only
- [x] 3 Playback - operator confirmed 2026-08-11 (🛑 contract + spawn Track A peer + Track B after remat)
- [x] 4 Issue - https://github.com/heavygee/hapi/issues/121 (fork tooling; not tiann)
- [x] 5 Peer - this session (`feat/operator-hold-chip`); do not implement in archived #1108 Gate A session
