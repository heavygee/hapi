# AGENTS.md (operator fork)

Work style: telegraph; noun-phrases ok; drop grammar;

**Canonical agent guide for `heavygee/hapi`.** Upstream `tiann/hapi` ships root `AGENTS.md` - **this fork deletes that file** and keeps everything here. Never PR this path or a root `AGENTS.md` change to upstream.

Prefer progressive loading: **[feature-work-lifecycle.md](../tooling/feature-work-lifecycle.md)** (sole workflow doc) → this file (fork identity, upstream PR) → root `README.md` → package READMEs.

**Why progressive (not one mega-AGENTS):** keep always-loaded context small; put procedure in deep docs. Tradeoff: agents that only skim this file miss step-level gates. Fix = **high-signal pointers below** (one-liners + deep link), not copying whole lifecycle here. Root `AGENTS.md` stays upstream-verbatim (Codex Cloud RAG); fork-private surface is **this file** + Cursor/Claude overlays.

### High-signal index — open these before “done / dogfood / handoff”

| When | Do | Detail |
|------|----|--------|
| Any local feature / soup / peer work | Read lifecycle first | [`feature-work-lifecycle.md`](../tooling/feature-work-lifecycle.md) (sole workflow) |
| Message another HAPI session | **PATH tooling only** + **identify yourself** (see § Peer message identity) | `hapi-ping-peer …` / `hapi ping-peer …`; open with `From: /sessions/<your-id>` (auto-stamped when `HAPI_SESSION_ID` is set) |
| Peer close-the-loop / status | **Spawn parent only** — never CC Meta PR watcher | § quieter Meta (2026-08-10); intake §0 + spawn-peer skill |
| Read another HAPI session | Same — no JWT+curl | `hapi inspect-peer <id>` / MCP `inspect_peer` (read-only, no resume). Citations: `[title](/sessions/<id>)` → pass `<id>` |
| Proof / screenshots / clips for operator | **Inline into HAPI chat** — do not only paste paths | **Estate default (this host only):** `~/coding/server-setup/docs/operator-visible-proof.md`. Off-host / other-repo peers: skill **`localize-estate-guidance`**. HAPI deep dive: lifecycle [§ Proof tiers](../tooling/feature-work-lifecycle.md#proof-tiers-images-and-video). **Playwright videos:** annotated pointer + `clickForHuman` (dwell on result) — raw `recordVideo` is a fail. Default branch language: **main**. MCP `display_image` / `display_video`, or `bun scripts/tooling/hapi-display-image.mjs <session-prefix> <abs-path> [title]` |
| Stale Cursor `mcp.json` / hub-move MCP panic | **Hub ≠ MCP URL.** Strip project `hapi`/`hapi-*` sidecars; never rewrite `--url` to `:3006`. Live HAPI Cursor sessions overlay **user-level** `~/.cursor/mcp.json` → loopback `hapiMcpUrl` | [`cursor-hapi-mcp.md`](../tooling/cursor-hapi-mcp.md); prune: `hapi-prune-stale-cursor-mcp` |
| Cursor ACP `Authentication required` / account flip on proxmox (or after auth switch) | **oos `~/.config/cursor/auth.json` is source of truth** — derive `api-key.env` + `~/.hapi/cursor.env`, `chattr +i`, restart **runner only**; no commented dual-key museums | [`cursor-auth-fleet-sync.md`](../tooling/cursor-auth-fleet-sync.md) |
| Link operator to a file/doc in HAPI chat | Write path as **bare text** — no `[](...)`, no backticks | HAPI auto-links bare paths → in-app file viewer (`remarkFilePathLinks`). Only allowlisted extensions link; **wrap `.mmd`/exotic in a `.md`** so it's clickable + previewable. Tracking: [tiann/hapi#1120](https://github.com/tiann/hapi/issues/1120) |
| New behavior intake / peer spawn | Follow intake §0 handoff | [`new-feature-intake.md`](../tooling/new-feature-intake.md) |
| Touch `:3006` soup | `hapi-driver-status --quiet` first (0 idle / 75 busy / **76 remat-hold**); no stack-switch from agent shell; on remat failure **stop** — Meta owns escalation (`hapi-remat-hold status`); **never park peer layers** to unblock rematerialize | Lifecycle § Agent permission matrix; [`driver-soup.md`](../tooling/driver-soup.md) § Remat escalation hold |
| Resume fails after hub/runner restart (`spawn-happy-session` / `No machine online`) or ACP `agent` not on PATH | Machine id re-enroll orphaned sessions (#1473 gap) and/or multi-runner soup — **not** Quest | Runbook [`machine-reenroll-resume-runbook.md`](../tooling/machine-reenroll-resume-runbook.md); postmortem [`2026-08-10-1473-provenance-dogfood-machine-id-postmortem.md`](../plans/2026-08-10-1473-provenance-dogfood-machine-id-postmortem.md) |
| Remat conflict on `playwright.config.ts` | Keep soup/fork peer-stack file; cherry-pick tip `testIgnore` only — **never** ask upstreamable tips to absorb annotated-video / fork Playwright | [`peer-stack.md`](../tooling/peer-stack.md#meta-remat-playwrightconfigts-conflicts-2026-07-28) |
| Re-thin a soup layer after remat conflict | **Not** onto `origin/driver/integration` — use `upstream/main` or the exact pre-layer SHA Meta names; each remat mint may differ | [`driver-soup.md`](../tooling/driver-soup.md#re-thin-bases-2026-07-29--awareness-remat) |
| Claim wave remat / web soup “green” | Smoke `/sessions` past error boundary **and** `hapi-session-send-smoke` (Send/Enter must not ReferenceError); new `index-*.js` hash if UI was broken; hard-reload / clear Workbox if sticky | [`driver-soup.md`](../tooling/driver-soup.md) § HappyComposer send-intent + When upstream moves |
| About to claim gates / PR ready | Mechanical verify before assertion | Lifecycle §6 + [`pr-review-loop.md`](../tooling/pr-review-loop.md) |
| High-stakes upstream tip / "minimize bot thrash" | **Full court press** — Claude→FIX→Sol→FIX→**then** open PR (bot attacks on create; never open early for a URL) | [`pr-review-loop.md` § Full court press](../tooling/pr-review-loop.md#full-court-press-escalate-when-bot-thrash-must-die) |
| Upstream PR “babysit / merge-ready” | **Prepare only** (agents); lane B self-merge is operator/Meta | § Upstream relationship - lanes A/B/C; #1096; #1268 blessing |
| Public speech on others' PRs/issues | **Operator first**; no estate jargon; do not police other contributors | § Public GitHub voice |
| **Daily PR sweep / "the dance"** | Run **`hapi-meta-daily.sh`** — classify → chip status cache → strip title emoji (chipped) → policy-ping → action queue. Don't reinvent it each morning. | § Meta PR watcher (below) |
| Upstream PR **merged** (Meta daily / chip `merged`) | Notify peer with **MERGED cleanup brief** (Gate A + **Gate A' exit reflection**) → peer cleans → rematerialize **once** after the wave → archive when idle (peers: no mid-turn self-archive; **no** `🔧` title rewrite) | Lifecycle [§ After upstream merge](../tooling/feature-work-lifecycle.md#after-upstream-merge-fleet-cleanup--meta-sweep-must-advise-this) + [§ Exit reflection](../tooling/feature-work-lifecycle.md#exit-reflection-gate-a--knowledge-cleanup); paste brief in § Meta PR watcher |
| Peer about to be archived after cleanup | **Exit reflection** + **`hapi-emit-exit-reflection`** (channel SystemEvent) before Meta archive | Template [`retros/TEMPLATE-exit-reflection.md`](../plans/retros/TEMPLATE-exit-reflection.md); emit [`2026-08-08-peer-exit-reflection-events.md`](../plans/2026-08-08-peer-exit-reflection-events.md) |
| Meta wave after peers ack cleanup | **Skim** retros; apply **Promote?**; **emit** judgment via `hapi-emit-exit-reflection`; then archive. `skip: timebox` OK | Lifecycle § Exit reflection **Meta wave job** |
| Long babysit PR **empty vs main** after upstream lands a superseding merge | Close as superseded; retarget chip to absorber; drop soup; exit reflection; idle — do not keep resolving forever | [`2026-08-08-cross-flavor-inline-images-babysit-retro.md`](../plans/2026-08-08-cross-flavor-inline-images-babysit-retro.md) (#958 → #1405) |
| Session title / PR health | Title = workstream only (no `PR #N:` once chipped); identity+health on **chip**; attach via `hapi link-pr` / MCP `link_pr` | Lifecycle [§ Session titles and PR chips](../tooling/feature-work-lifecycle.md#session-titles-and-pr-chips) |
| Local Pi coding agent (5090 / oos-linux) | New Session → **Pi**; backend `oos-llm` VIP | [`pi-local-coding-agent.md`](./pi-local-coding-agent.md) |
| Agent mangles `tiann`/`oos-linux`/MagicDNS doubles | Free-recall / tokenization hazard - not HAPI pipe. **Outside-Cursor control done (2026-07-24): native claude+codex 0/27 drops** | [`2026-07-22-doubled-character-free-recall.md`](../plans/2026-07-22-doubled-character-free-recall.md) + [outside-cursor results](../plans/2026-07-22-doubled-character-free-recall-outside-cursor-results.md) |

---

## Peer message identity (interim until A2A stamps principal)

> **Upstream track:** [#1203](https://github.com/tiann/hapi/issues/1203) = A2A RFC **P0.5** (Layer 0 delivery provenance - not a P2 work-contract). Peer `6212dae5` / worktree `a2a-p05-peer-provenance` owns the PR. Until that lands, the habit below still applies.

Cross-session pings (`hapi-ping-peer` / MCP `ping_peer`) are **not** intrinsically attributed on the wire today. The recipient sees a user message with no trusted "who sent this" field - shades of the A2A ledger problem (#1332 / notify→events). Until the hub stamps a principal on peer delivery:

**Every agent-authored message to another HAPI session MUST open with:**

```markdown
From: /sessions/<your-full-or-8+-char-hapi-session-id>
Name: <optional metadata.name>
```

Then the body. No exceptions for "obvious from context," Meta briefs, or close-the-loop pings.

| Mechanism | Behavior |
|-----------|----------|
| `hapi-ping-peer` (PATH script) | Auto-prepends `From:` when `HAPI_SESSION_ID` is set (runner/agent shells usually export it). Warns on stderr if unset. Skip only with `HAPI_PING_PEER_SKIP_FROM=1` when the body already has a correct `From:`. |
| MCP `ping_peer` / bare soup CLI (until product stamp) | **You** must include the `From:` lines in the message text. |
| Operator paste into a chat | Prefer the same header so agents do not treat you as an anonymous peer. |

Forgery is still possible (it is text). The point is a **shared estate habit** so orchestrators stop guessing. Hub-attributed delivery is the real fix ([#1203](https://github.com/tiann/hapi/issues/1203) / A2A RFC **P0.5** - Layer 0 provenance, not a P2 work-contract). Do not invent a parallel auth protocol here.

---

## Meta: what this fork is

**HAPI is an agent-corralling platform** - local-first remote control for CLI coding agents (Claude Code, Codex, Cursor Agent, Gemini, OpenCode, Pi). Extension of upstream **[tiann/hapi](https://github.com/tiann/hapi)** (AGPL-3).

| Layer | Role |
|-------|------|
| **Upstream HAPI** | Multi-agent hub, PWA, Telegram, ElevenLabs voice, session sync |
| **Our layer** | Voice-first modality, deterministic mode state, optional `AGENT_NOTIFY_SUMMARY`, multi-agent fleet ops from phone while AFK |
| **Legacy reference** | CursorVox, CursorRemote - mine patterns, do not rebuild parallel stacks |

**North star:** *Gardening while agents work* - [`docs/plans/2026-05-23-voice-agent-state-integration.md`](../plans/2026-05-23-voice-agent-state-integration.md) §14.

---

## Upstream relationship

```text
upstream  →  https://github.com/tiann/hapi.git
origin    →  https://github.com/heavygee/hapi.git
```

### Merge lanes (A / B / C) - post #1268 blessing

Chip status stays **PR health only** (`✅` / `🔁` / `⚠️` / …). Merge authority is an **estate overlay** (`scripts/tooling/lib/pr-merge-policy.sh`, config `~/.hapi/pr-merge-policy.json` - see `scripts/tooling/pr-merge-policy.example.json`). Meta queue splits green PRs into **WAIT TIANN** vs **SELF-MERGE ELIGIBLE**.

| Lane | Who merges | How you get there | Agents |
|------|------------|-------------------|--------|
| **A** maintainer | **@tiann** | Default when over size caps and not promoted | Prepare only - never `gh pr merge` |
| **B** self-merge | Operator / Meta tooling (not agents) | Auto: size caps (≤8 files, ≤120 delta) - **product paths OK**; **or** human promote via GitHub label `low-impact` **or** `allow_pr_numbers` in policy | Prepare only - no auto merge yet |
| **C** forbidden | Nobody here | Others' PRs, direct push to `main`, settings, force-push | Hard no |

**Blessing:** after heavygee self-merged test-only [#1268](https://github.com/tiann/hapi/pull/1268), @tiann replied ([comment](https://github.com/tiann/hapi/pull/1268#issuecomment-5141575753)): *"Sounds great! Thanks for helping out."* That authorizes taking **low-impact** PRs off tiann's plate - not a blank check for every green PR.

**Path kind is not a lane reject.** "Because product" was retired 2026-08-09 - touching `cli/`/`hub/`/`web/`/`shared/` does **not** force lane A. Auto-B is size-capped; oversized focused fixes promote with `low-impact` / allowlist. Salience + history: `docs/plans/2026-07-31-pr-merge-lanes.md`.

**Incident #1096** (2026-07-20): first accidental heavygee upstream merge - do not treat write access as "merge anything green."

**Agents:** babysit / "to merge" / merge-ready still means **prepare only** (CI, rebase, threads, ping). Do **not** run `gh pr merge` on `tiann/hapi` unless an operator with a controlling TTY explicitly directs a **lane B** merge. Meta CLI never merges.

**Fork `main` mirror:** after upstream activity run `hapi-sync-fork-main` (in `scripts/tooling/`) and `git push origin main`. Primary checkout `~/coding/hapi` must contain **upstream product code + fork docs** - not docs-only drift. `hapi-driver-rebuild` refuses if `main` is behind `upstream/main`.

- Extend upstream; PR-sized slices; default path unchanged when new code off
- **Never modify maintainer canon** in upstream PRs - see § Upstream file boundaries
- **Upstream PR branches** start from `upstream/main` only - product code diffs, nothing fork-local

### Upstream collaborator status (heavygee on tiann/hapi)

`heavygee` has **`write`** permission on `tiann/hapi` (verify: `gh api repos/tiann/hapi/collaborators/heavygee/permission`). Write ≠ blank-check merge authority. Scoped by lanes A/B/C above (blessing: #1268 comment).

Default remains **fork-contributor discipline** for product work (PRs from `upstream/main`-based branches via `hapi-pr-create`, no direct writes to upstream branches or other people's work). Code review on others' PRs is welcome **when substance helps the author** (plain language, code-focused). Unsolicited top-level "estate status" comments are not - see § Public GitHub voice. Prefer operator-mediated offers (rebase help, scope expansion).

**What we self-permit:**

- **Label management** on `tiann/hapi` issues and PRs - including applying `low-impact` for lane B promote. Daily taxonomy owner: HAPI session **Issue labelling (tiann/hapi)** (`f3c41205…`); see `docs/plans/2026-07-31-pr-merge-lanes.md` § Label ownership.
- **Lane B self-merge** when policy says eligible (operator/Meta; agents prepare-only until merge automation is explicitly enabled). Includes our PRs **and** others' auto-B / `low-impact` PRs. **Merge quietly** - no PR comments explaining estate lanes, the #1268 blessing, or why we are allowed to merge. Policy + chip are the paper trail; the merge commit is enough.
- **Pushing to PR branches via `maintainerCanModify`** *only when* (a) the PR has `maintainerCanModify: true`, (b) we have coordinated with the PR author first (comment + reasonable response window), and (c) we are addressing a clear stall (conflicts, no author iteration, no maintainer review). Stays attributed: author's commits keep their authorship; our rebase / fix commits add `Co-authored-by:` lines

**What we explicitly do NOT do (lane C):**

- Direct push to `tiann/hapi:main` or any other upstream branch (use the normal PR flow)
- Merging **lane A** PRs without @tiann (or any PR that is not policy lane B)
- Force-pushing to others' PR branches
- Closing issues or PRs we don't own
- Editing PR titles / bodies / descriptions on others' PRs
- Modifying repo settings, branch protections, secrets, or `.github/workflows/*`
- Acting on behalf of @tiann in any communication with contributors
- Granting or revoking access to others
- Triggering / dismissing workflows on others' PRs
- Unsolicited public comments on others' PRs/issues that leak estate process or jargon (route to operator first - § Public GitHub voice)
- Offering rebase/takeover/scope changes on others' work without operator-approved wording

If @tiann narrows or expands scope, revise this section.

---

## Meta orchestration volume (quieter Meta — 2026-08-09; tightened 2026-08-10)

Meta (`meta - PR watcher`) is **dispatch + queue**, not a party line. Peers must **not** CC Meta by default.

**Hard rule (operator 2026-08-10):** a peer's close-the-loop / status pings go to the **session that spawned them** (originator), **at most**. Do **not** ping Meta PR watcher for IDLE acks, dogfood progress, hub-flip yells, "thanks", or polite status. Meta must **not** solicit those replies ("Yell when…", "please IDLE and ack", "ping me when ready").

| Do | Don't |
|----|--------|
| One-shot handoff to a **single owning peer** (feature peer or PR-chip babysitter) | Require every cold/implementer ping to Meta |
| Spawn a babysit peer onto a PR chip and step away | Stay in the loop for every freeze / Sol / race ACK |
| Take **one** rollup when Ready YES/NO or blocked for operator judgment | Be CC on close-the-loop (unless Meta **was** the spawn parent) |
| Remat hold → ping **remat owner** (`config/remat-escalate.yaml` / soup-stabilize), not PR watcher | Treat "ping Meta" as "ping PR watcher" for every soup hiccup |

**Full court press:** orchestrator (or Meta) may spawn pass 1, then **devolve** — implementer owns subsequent cold spawns, fix loops, and freeze discipline. Cold peers ping **implementer only**. Meta PR watcher gets pinged once at Ready YES (upstream draft) or hard block needing **operator** judgment — not for routine peer↔peer coordination. Standing cyber-flag recovery still applies to whoever owns the press (`pr-review-loop.md` § Provider cyber-flag recovery).

**Race noise to avoid:** after Meta/orchestrator already spawned the next cold, do **not** send a second "please spawn Sol" ping — that was the double-ping storm.

**Incident note (2026-08-10):** Meta asked peers for IDLE/hub-flip/dogfood reply loops during a soup storm; that made Quest FCM chattery. Undone — do not reintroduce reply-soliciting Meta briefs.

---

## Meta PR watcher (daily PR sweep — "the dance")

**Entrypoint: `scripts/tooling/hapi-meta-daily.sh`.** One deterministic command for the whole morning routine. Do **not** hand-reconstruct the sweep each day, and do **not** reach straight for the low-level scripts — this wraps them.

Requires **GitHub CLI ≥ 2.80** from the **official** apt repo (`cli.github.com`), not Debian bookworm's community `2.23` (missing `gh pr checks --json`; caused false PASS in `hapi-pr-status`). Install/upgrade: `bash scripts/tooling/install-gh-official.sh`. Tooling refuses to run below the floor (`lib/require-gh-version.sh`).

```bash
hapi-meta-daily.sh              # classify → chip status → strip emoji + PR #N: → ping → queue
hapi-meta-daily.sh --dry-run    # decide + print only; no hub/state writes
hapi-meta-daily.sh --no-ping    # strip + queue, never ping (safe re-run)
hapi-meta-daily.sh --no-ping --emit-events  # quiet refresh (chips + inbox; no peer pings)
hapi-meta-daily.sh --backfill-refs [--apply]  # one-shot session↔PR externalRefs
hapi-meta-daily.sh --json       # machine-readable plan (pure JSON on stdout)
hapi-meta-daily.sh --pr 75      # force a single (e.g. low-numbered) upstream PR
```

**Machine timers (oos-linux / this estate only — fork tooling, not Tier-1, not upstream):**

```bash
sudo bash scripts/tooling/install-hapi-meta-daily-timer.sh
# optional: --run-now   one quiet refresh after enable
#          --disable   stop + disable both timers
```

| Timer | When | Command |
|-------|------|---------|
| `hapi-meta-daily.timer` | **hourly :00 Europe/London** (+ up to 2m random; BST/GMT) | full Meta (peer pings + wave-clear unlock) |
| `hapi-meta-daily-refresh.timer` | every **45m 24/7** (`OnBootSec=3min` + `OnUnitActiveSec=45min`) | `--no-ping --emit-events` |

Quiet chip-only refresh (45m) was retired 2026-08-04 — hourly London `:00` refreshes chips and may ping peers / unlock Meta tooling for rematerialize. Chip UI mutes to `?` when `statusCheckedAt` is older than **3h** (`config/pr-chip-states.yaml` / `$HAPI_HOME/pr-chip-display.json` staleMs). Host TZ on oos may stay `Etc/UTC`; the timer unit suffixes `Europe/London` so the hour is operator-local, not UTC. Units: `scripts/tooling/systemd/hapi-meta-daily*`. Optional env: `~/.hapi/meta-daily.env` (`HAPI_META_TOOLING_SESSION_ID`, `HAPI_META_WAVE_COLLECT_SECS`). Chip UI never live-queries GitHub. Logs: `journalctl -u hapi-meta-daily`.

What it does, idempotently:

1. **Discovers** the union of open `heavygee` PRs on `tiann/hapi`, recently-merged tracked PRs (last 7d), and every hub session with a linked `github_pr` chip on `tiann/hapi` | `heavygee/hapi` (**titles ignored**).
2. **Classifies each PR once** via `hapi-pr-emoji-batch.sh` → `lib/pr-emoji-core.sh`.
3. **Caches status on the chip** (`externalRefs.status` / `statusCheckedAt` / `statusAction`) for attached sessions.
4. **Strips leading status emoji and `PR #N:` prefixes** from titles of chipped sessions (chip owns identity + health — ADR D8+). Keeps `Peer #N:` incubating titles. Does **not** write emoji or PR-number prefixes into titles. **Agents must not put ✅/🔁/⚠️/📝/🔧 or `PR #N:` back into titles** after a strip or ping.
5. **Pings only when actionable** (see policy) — state-gated so a second run the same morning is a no-op. Ping text tells peers the chip status changed; it does **not** ask them to keep emoji in the title.
6. **Reads GitHub notifications** for both repos since a stored cursor (`all=true`, actionable reasons only: comment/mention/review_requested/state_change/…) and folds new human comms into the queue.
7. **Wave-clear (gate A):** for owned 🔧 sessions only, detect soup-layer + worktree cleanup (`lib/meta-wave.sh`). Start a ~30m collect fuse when members go clean; when the wave is clear, unlock-ping Meta tooling (`HAPI_META_TOOLING_SESSION_ID`) on ping windows. Defers while `hapi-driver-status --quiet` is busy (exit 75) so mid-window manual rebuilds are respected. Orphans are anomalies and **never** block. Meta CLI still never runs `hapi-driver-rebuild` itself — the tooling bot may.
8. Prints a sorted **action queue** (⚠️ / 🔧 / 🧹 / wave / orphans / inactive / new comms) + next steps.

**Status contract** (chip + Meta queue; worst wins when a session tracks >1 PR). Canon: [`config/pr-chip-states.yaml`](../../config/pr-chip-states.yaml).

| Emoji / status | Meaning | Advice pinged |
|----------------|---------|---------------|
| ✅ `clean` | open PR, CI green, 0 **current** unresolved threads, bot clean, mergeable | wait on tiann |
| 🔁 `pending` | CI/bot in flight, or thread/CI data momentarily unavailable | wait / retry |
| ⚠️ `needs_work` | failing CI, **current** open threads, bot findings, rebase, or **closed-unmerged** | fix per action string |
| 📝 `pre_pr` | tracked number, no open PR upstream yet | file when ready |
| 🔧 `merged` | merged; cleanup still owed (or Gate A clean, archive pending) | drop soup/wt/branch → **exit reflection** (or `skip:`) → ack + idle; Meta archives (peers: **no mid-turn self-archive**) |
| 🧹 `complete` | fully cleaned (layer DROPPED, no worktree/branch, session archived) | **never** (babysit ended) |
| `?` `unknown` | GitHub data unavailable this run | **chip left at last good status; never pinged** |

Chip thread count excludes GraphQL `isOutdated` unresolved threads (#847: leftover bot Majors on old lines must not keep ⚠️ after Findings:None + green CI on tip).

**Ping policy (why it isn't spam for greens, but is a rouse for work):** on **hourly ping windows** (Europe/London :00), Meta **always** pings sticky ⚠️ / 🔧 sessions — "are you done yet?" — including **inactive** ones (`hapi-ping-peer` resumes them). ✅ / 🔁 / 📝 only ping on an emoji **transition** (first sight / state change), never on every window. 🧹 / `?` **never** ping (incl. 🔧→🧹). Manual `--no-ping` never pings. State lives at `${XDG_STATE_HOME:-~/.local/state}/hapi/meta-daily.json`. Classifier / sticky 🔧 pings already mention exit reflection; **human Meta briefs must too** — use the paste block below (do not invent "stand down / archive now").

**MERGED cleanup brief (paste to peer — Gate A + Gate A'):**

```text
PR #<N> merged (<tip SHA if known>). Chip shows merged / 🔧 — leave the workstream title alone.

Please:
1. Drop your soup layer(s) from ~/.config/hapi/driver-manifest.yaml (# DROPPED comment OK)
2. Remove worktree + delete local/remote branch (hapi-branch-audit until clean)
3. Exit reflection: copy docs/plans/retros/TEMPLATE-exit-reflection.md →
   docs/plans/retros/YYYY-MM-DD-<slug>-exit.md (or honest skip: <reason> / skip: timebox)
4. Ack: "Gate A clean + exit reflection: <path|skip:> — idle for archive."
5. Idle cleanly — do NOT self-archive mid-turn (orphans tool UI). Meta archives when idle.

Do not rematerialize mid-wave; Meta rebuilds once when the wave is clear.
```

**Meta wave job (after acks):** skim new `docs/plans/retros/*-exit.md`; apply **only** checked **Promote?** rows (High-signal index line, tiny lifecycle/tooling patch, or file issue). Ignore essays. Then **`hapi-emit-exit-reflection`** with Meta judgment (`applied` / `none` / `skip`) — fork channel event for Overseer prep (soup; not upstream). `skip: timebox` → emit skip + archive; do not hold 🧹 forever. Without the emit, the improve loop has no queryable row.

**Scope guard (chips only):** Meta discovers sessions **only** via linked `metadata.externalRefs` `github_pr` chips on `tiann/hapi` | `heavygee/hapi`. Session titles are never scraped for classify/ping (2026-08-06 Sparling: `"Module 02 … #395"` title scrape destroyed foreign work). Unlinked sessions are invisible until `hapi link-pr` / MCP `link_pr`. `--backfill-refs` remains a one-shot title→chip migrator (`PR #N` markers only). Use `--pr <N>` for a rare low-numbered upstream PR in the open/merged union.

**What it will NEVER do** (judgment/destructive — CLI never executes these): merge upstream PRs · sync/push fork `main` · edit the soup manifest · rebuild/restart the driver · delete branches/worktrees · archive sessions · reply on GitHub · mark notifications read. Wave-clear **unlocks** the Meta tooling session to rematerialize once; that bot (and any agent following soup rules) **may** run `hapi-sync-fork-main` + `hapi-driver-rebuild --build-web --verify` without further operator approval — after `hapi-driver-status --quiet` is idle. Manual soup rebuilds outside the hourly ping windows are expected and fine; unlock waits if a rebuild is already in progress.

Lower-level primitives: `hapi-pr-emoji-batch.sh` (pure classifier → JSON). `hapi-pr-session-emoji.sh` is a **removed stub** (exits 2; prints `hapi-meta-daily.sh [--pr N]` — no escape hatch). Shared engine: `lib/pr-emoji-core.sh` + `lib/meta-wave.sh`; unit tests in `lib/pr-emoji-core.test.sh` + `lib/meta-wave.test.sh` + `hapi-meta-daily.test.sh`.

**Overseer relationship:** the CLI **actuates** (chip status cache + strip leftover title emoji + policy-ping), **surfaces** a queue, and can emit contribution-state transitions as channel SystemEvents with **`--emit-events`** (default off). Session-bound transitions promote into the operator inbox; peer pings remain independently gated. First chatty corpus dogfooded 2026-07-25; steady-state rerun emitted nothing. Principle: [`docs/plans/2026-07-25-contribution-state-as-overseer-sensor.md`](../plans/2026-07-25-contribution-state-as-overseer-sensor.md). Live ingest + dogfood receipt: [`docs/plans/2026-07-25-contrib-state-event-ingest-spec.md`](../plans/2026-07-25-contrib-state-event-ingest-spec.md). Ancestor framing: session [State indicators based on PR state](/sessions/fc561649-e783-4a56-be5e-3ca7511c1663).

---

## Strategic direction: voice-first

ElevenLabs ConvAI today: handoff OK, readback weak, payment, no mode machine. Target: pluggable voice modality + hub-owned state. Plan: `docs/plans/2026-05-23-voice-agent-state-integration.md`. Do **not** port CursorVox `dispatch_agent.py` as state owner.

---

## Operator docs map

| Doc | Purpose |
|-----|---------|
| **`docs/operator/AGENTS.md`** | This file (fork agent canon + high-signal index) |
| [`docs/tooling/feature-work-lifecycle.md`](../tooling/feature-work-lifecycle.md) | **Sole workflow** — soup/peer/clean, agent permissions, **§ Proof tiers** (`display_image` / video) |
| [`docs/tooling/new-feature-intake.md`](../tooling/new-feature-intake.md) | **New behavior requests** — discovery, spawn handoff, soup vs clean, gates before operator test |
| `docs/tooling/driver-soup.md` | Daily driver manifest, `hapi-active`, worktrees, **coordination (`hapi-driver-status`) and DB jiu-jitsu** |
| [`docs/tooling/cursor-auth-fleet-sync.md`](../tooling/cursor-auth-fleet-sync.md) | **Cursor login fleet sync** — oos `auth.json` → proxmox envs + pin/`chattr`; account-switch runbook |
| `docs/plans/*` | Integration plans, PR A-F; peer agent: `2026-05-30-peer-agent-offering.md` |
| `docs/operator/xr/*` | **XR only (private):** work graph + mindmap visualization epic — start at `xr/work-graph-and-visualization.md` |
| `docs/operator-local-tooling.md` | `localdocs/`, machine indexes |
| `docs/dogfood/*.md` | Voice evidence for upstream PR bodies |

---

## Stack-switch tooling: agents do NOT touch live `:3006`

**Full workflow, mermaid, and agent permission matrix:** [`feature-work-lifecycle.md`](../tooling/feature-work-lifecycle.md) — **only place that defines this.**

**Forbidden agent tool-calls** (stack path change — kills sessions): `hapi-use-worktree`, `hapi-use-driver`, `hapi-driver-rebuild --activate`, `hapi-watch-activate-driver` from tool shells.

**Allowed for soup dogfood when already on driver:** see lifecycle § Agent permission matrix — summary: `hapi-driver-rebuild --build-web [--verify]`, `hapi-verify-web-dist`, **`hapi-restart-hub`** (hub/cli). Not `hapi-use-driver`.

**Raw `sudo systemctl restart hapi-hub`:** forbidden — use `hapi-restart-hub`. Three-layer block + TTY-gated bypass: `.cursor/rules/operator-fork.mdc` § sudo systemctl. Outage pattern: agents running `hapi-use-worktree` from inside their worktree (2026-06-10, 2026-06-11) — don't be the third.

---

## Upstream PR series

| PR | Scope |
|----|-------|
| **A** | Voice readback - `contextFormatters.ts`, `voiceHooks.ts` |
| **B** | ElevenLabs archive - `hub/src/voice/`, `voice.ts` |
| **C** | Optional `AGENT_NOTIFY_SUMMARY` |
| **D** | Mode state + modality wrapper |
| **E** | Local OpenAI backend (after #401) |
| **F** | Web import picker |

Coordinate **#401**, **#640**. Details §16 in integration plan.

---

## Upstream file boundaries

### Never touch in upstream-bound PRs

`AGENTS.md`, `CONTRIBUTING.md`, `LICENSE`, `SECURITY.md`, root `README.md`, `.github/*`, `website/`, `docs/operator/*`, `docs/plans/*`

PR branch sanity check before push:

```bash
git fetch upstream
git diff --name-only upstream/main...HEAD | grep -E '^(AGENTS\.md|CONTRIBUTING|docs/operator|docs/plans)' && echo STOP || echo OK
```

### Fork-only (stay on `origin/main`, not in upstream PRs)

- `docs/operator/AGENTS.md` (this file)
- `docs/plans/*`, `docs/operator-local-tooling.md`
- `.cursor/rules/operator-fork.mdc`
- Root `.gitattributes` (`AGENTS.md merge=ours` - fork merge hygiene)
- Absence of root `AGENTS.md` (deleted on fork)

### Keeping a clean tree after upstream sync

One-time per clone:

```bash
git config merge.ours.driver true
```

Fork root `.gitattributes` keeps **`AGENTS.md` deleted** when merging `upstream/main` (ours = fork side).

If `AGENTS.md` reappears after a rebase anyway:

```bash
git rm -f AGENTS.md
git commit -m "chore(fork): drop upstream AGENTS.md (canonical copy in docs/operator/)"
```

**Upstream PR branches:** branched from `upstream/main` - root `AGENTS.md` exists on the branch but **leave it untouched**; your PR diff must not include it.

---

## Public GitHub voice (tiann/hapi and the fork)

Audience is upstream maintainers and other contributors - not the estate.
Write like a careful external collaborator. Diffident in tone; concrete in facts.

**Our PR bodies** = humble first-timer; work = first-class. Silent checklist: rebase, tests, default path note, no fork docs in diff. Skeleton: Summary / Problem / Approach / Testing / Related / Questions.

Never in upstream PR **bodies**: AI disclosure, fork strategy, internal plans, canon edits.

### Trust other contributors (do not police them)

Assume authors and maintainers are operating at their best. If something looks "missed," treat it as **time / attention lag**, not incompetence. Upstream already has tests and the HAPI / Codex review bot - rebase collisions, stale threads, and broken CI get figured out without an estate lecture. Agents police **themselves** and the **operator channel**. They do **not** police other people's PRs.

### Default: talk to the operator first

Unsolicited top-level comments on **someone else's** issue/PR are **operator decisions**, not agent autonomy.
If soup dogfood, schema remaps, rebase blockers, or product-direction offers matter:
1. Report them in the HAPI session / to the operator.
2. Do **not** `gh pr comment` / `gh issue comment` unless the operator explicitly asks you to post, or pastes the exact body to publish.
3. Prepare-lane babysit of **our** PRs (thread replies via `hapi-pr-reply`, CI, rebase notes **to the operator**) stays allowed.

Exception: answering a direct @-mention / review question on a thread we already own - still plain language, still no estate jargon.

### Banned from public comments (always)

- Estate jargon without translation: soup, Meta, remat, chip, lane A/B/C, union tip, dogfood note, `:3006`, worktree paths, session IDs
- Explaining our fork strategy, blessing (#1268), merge policy, or why we may self-merge
- Speaking as @tiann or "the project maintainers"
- Dumping internal triage ("so Meta stops counting Codex threads") onto authors who cannot act on our tooling
- Offering to rebase / take over / expand scope on others' PRs unless the operator asked you to make that offer
- "Helpful" warnings that amount to policing someone else's open work

### Allowed when the operator greenlights a public note

- Plain technical facts the author can use (e.g. "main already has schema v21 from #1390; this PR's pin migration still claims v20 and needs remapping to v22")
- Short, optional offer framed as **heavygee the human**, not "we/the soup kitchen"
- Zero fork autobiography. If a local nickname must appear once, define it in one plain sentence - prefer not to use it at all

Canonical correction example: `tiann/hapi#1115` comment `5204453417` (operator rewrite after an agent dump).

---

## Cursor sessions: markdown tables (2026-07-01)

**Tables are allowed.** The 2026-06 `alwaysApply` ban in `.cursor/rules/cursor-markdown-table-discipline.mdc` was **removed** on 2026-07-01 (`94226fd7e`) after HAPI gained pre-parse GFM table repair (`web/src/lib/remark-repair-tables.ts`, #902).

- **Do not** tell operators or peer agents that Cursor forbids markdown tables — obsolete.
- **Do** match separator column count to header when emitting tables (best practice; repair handles common off-by-one).
- **Git docs** may use tables freely (`docs/operator/`, lockhouse `docs/strategy/`, etc.).
- **If an agent still cites the ban:** Cursor may have cached the deleted rule by path — the rule file was **re-added on main with superseding text** (same filename, new policy). Reload Cursor or start a fresh session after pulling `main`.

Historical investigation: `docs/plans/peer-handoff-agent-table-markdown-serialization.md`.

---

## Voice mode states (gardening)

`idle_warm|cold`, `align_intent`, `await_confirm`, `executing_async` (silence), `reporting`, `blocked`, `report_refresh`. Ack only after hub queues. Optional `AGENT_NOTIFY_SUMMARY` - parse when present; `~/coding/agent-notify/ACTUALSPEC.md`.

---

## Git workflow

### Two branches, two purposes

| Branch | Base | Purpose |
|--------|------|---------|
| **`main`** on `origin` (fork) | upstream + fork-only commits | Local dev; operator docs; deleted `AGENTS.md` - **never open a PR to tiann from this branch** |
| **`fix/…`, `feat/…`** | **`upstream/main` only** | Upstream PRs - diff must be product code only |

Committing fork metadata on fork `main` is **fine**. It only leaks into an upstream PR if you branch wrong.

**Safe (upstream PR):**

```bash
git fetch upstream
hapi-worktree-create voice-ready --branch fix/voice-ready-inline-summary
cd ~/coding/hapi/worktrees/voice-ready
# ... edits in cli/hub/web/shared only ...
git diff --name-only upstream/main...HEAD   # must not list AGENTS.md, docs/operator/, docs/plans/
git push -u origin fix/voice-ready-inline-summary
hapi-pr-create --title "fix(voice): inline ready summary" --body-file body.md
```

The wrapper enforces base = `upstream/main`, runs `check-operator-leaks.sh` on the diff and body, and requires a `Closes #N` keyword in the body (bypass with `--no-closes-required` for spike PRs or discussion-only links).

**Unsafe (will PR the deletion + operator docs):**

```bash
git checkout -b fix/voice main    # fork main includes fork-only commits
gh pr create --repo tiann/hapi     # BAD - ancestry includes AGENTS.md deletion
```

If you started from fork `main` by mistake, re-cut before push:

```bash
git fetch upstream
git checkout -b fix/voice-ready-inline-summary upstream/main
git cherry-pick <commit-sha>      # product commits only, not fork config commits
```

Or: `git rebase --onto upstream/main upstream/main fix/voice` after ensuring fork-only commits aren't in the chain.

### Sync fork main with upstream

```bash
git fetch upstream && git checkout main && git merge upstream/main   # AGENTS.md stays deleted (merge=ours)
git rm -f AGENTS.md 2>/dev/null; true
```

Or use the wrapper: `hapi-sync-fork-main` (handles fork-only commits, runs `hapi-branch-audit --on-merge` at the end so any branches whose PRs just landed upstream get flagged for cleanup).

One-time per clone: `git config merge.ours.driver true`

Before `git add` on **PR branches**: no `localdocs/`, secrets, `docs/operator/`, `docs/plans/`.

### One branch per tracked item (enforced via audit)

Every long-lived local branch must map to exactly one tracked item: an open upstream PR, an upstream issue, an upstream discussion, or a fork-only PR for staging. Branches without that mapping rot — silently bitrotting, silently re-doing work that already merged, silently piling up.

Three rules:

1. **Before opening a PR**, the linked tracker (issue / discussion / fork issue) must exist. File it first if needed. Use `gh-public-body-check.sh` on the issue body before `gh issue create`.
2. **Open upstream PRs via `hapi-pr-create`** (wrapper around `gh pr create`). It refuses PRs from `main`/`driver/integration`/infra branches, runs `check-operator-leaks.sh` on the diff + body, and rejects bodies that lack a `Closes #N` / `Fixes #N` / `Resolves #N` keyword. Bypass with `--no-closes-required` only for spike PRs or discussion-only links.
   - **Fork-side cold-review stage is mandatory before opening an upstream PR for non-trivial changes.** Push the branch to origin, open a fork PR (`gh pr create --repo heavygee/hapi --base main --head fix/X --draft`) so the fork review bot weighs in. Iterate until the bot has no remaining findings. Apply the `cold-review-clean` label to the fork PR as the explicit "I've addressed or accepted bot findings" signal. Close the fork PR. **Then** run `hapi-pr-create` for the upstream PR. The goal: every upstream PR is green on first bot review — no public feedback-then-fix cycle. Bypass with `--skip-fork-stage` only for trivial changes (typo, debug log removal, etc.) where bot review adds no value. See [`repo-layout-and-dev-flow.md` §3.1-§3.2](./repo-layout-and-dev-flow.md#31-why-the-fork-stage-comes-first) for the full rationale.
3. **`hapi-branch-audit`** runs read-only over every local branch and classifies each as `OK`, `OK-LINKED` (body has `#N` ref like a discussion, no auto-close), `NO-LINKS`, `MERGED` (delete candidate), `NO-TRACKING`, `STALE-BEHIND` (>30 commits behind upstream/main), `DETACHED-WT`. Run `hapi-branch-audit` to see the full table; `--quiet` shows only branches needing action and exits non-zero. Runs automatically after `hapi-sync-fork-main` and via the `post-merge` git hook on `main`.

Infra branches exempted from audit: `main`, `driver/integration`, `upstream-main-test`, `garden/r3f-poc`.

---

## HAPI baseline (from upstream `tiann/hapi` AGENTS.md)

Inlined here so the fork does not need root `AGENTS.md`. When upstream updates their copy, manually port relevant technical deltas into this section.

### What is HAPI?

Local-first platform for running AI coding agents (Claude Code, Codex, Gemini, Cursor Agent, OpenCode) with remote control via web/phone. CLI wraps agents and connects to hub; hub serves web app and handles real-time sync.

### Repo layout

```
cli/     - CLI binary, agent wrappers, runner daemon
hub/     - HTTP API + Socket.IO + SSE + Telegram bot
web/     - React PWA for remote control
shared/  - Common types, schemas, utilities
docs/    - VitePress documentation site
website/ - Marketing site
```

Bun workspaces; `shared` consumed by cli, hub, web.

### Architecture overview

```
┌─────────┐  Socket.IO   ┌─────────┐   SSE/REST   ┌─────────┐
│   CLI   │ ──────────── │   Hub   │ ──────────── │   Web   │
│ (agent) │              │ (server)│              │  (PWA)  │
└─────────┘              └─────────┘              └─────────┘
```

**Data flow:**
1. CLI spawns agent, connects to hub via Socket.IO
2. Agent events → CLI → hub → DB + SSE broadcast
3. Web subscribes to SSE `/api/events`
4. User actions → Web → hub REST → RPC → CLI → agent

**Voice path (ElevenLabs default):**

```text
Browser WebRTC ↔ ElevenLabs ConvAI → client tools → hub queue → coding agent CLI
                                                      ↑ voiceHooks contextual updates
```

### Reference docs

- `README.md`, `cli/README.md`, `hub/README.md`, `web/README.md`, `docs/guide/`, `CONTRIBUTING.md` (read only)

### Shared rules

- No backward compatibility required
- Pragmatism; avoid overengineering; tests only when needed
- TypeScript strict; Bun from repo root; `@/*` → `./src/*`; 4-space; Zod in `shared/src/schemas.ts`

### Common commands

```bash
bun typecheck
bun run test
bun run dev
bun run build:single-exe
```

### Key source dirs

**CLI (`cli/src/`):** `api/`, `claude/`, `codex/`, `agent/`, `runner/`, `commands/`, `modules/`, `ui/`

**Hub (`hub/src/`):** `web/routes/`, `socket/handlers/cli/`, `sync/`, `store/`, `sse/`, `telegram/`, `notifications/`, `config/`, `visibility/`, **`voice/`** (operator extensions)

**Web (`web/src/`):** `routes/`, `components/`, `hooks/`, `api/client.ts`, **`realtime/`** (voice)

**Shared (`shared/src/`):** `types.ts`, `schemas.ts`, `socket.ts`, `messages.ts`, `modes.ts`, **`voice.ts`**

### Voice integration seams

| Concern | Path |
|---------|------|
| Voice prompt + tools | `shared/src/voice.ts` |
| Default transport | `web/src/realtime/RealtimeVoiceSession.tsx` |
| Client tools | `web/src/realtime/realtimeClientTools.ts` |
| Context feed | `voiceHooks.ts`, `contextFormatters.ts` |
| Token API | `hub/src/web/routes/voice.ts` |
| Notify + mode hook | `hub/src/socket/handlers/cli/sessionHandlers.ts` |
| Outbound messages | `hub/src/sync/messageService.ts` |

### Testing

Vitest; `*.test.ts` next to source; hub + cli tests; no web tests currently.

### Common tasks

| Task | Key files |
|------|-----------|
| Add CLI command | `cli/src/commands/`, `cli/src/index.ts` |
| Add API endpoint | `hub/src/web/routes/`, `hub/src/web/index.ts` |
| Add Socket.IO event | `hub/src/socket/handlers/cli/`, `shared/src/socket.ts` |
| Modify session logic | `sessionCache.ts`, `syncEngine.ts` |
| Modify messages | `messageService.ts` |
| Voice readback / mode | `contextFormatters.ts`, `sessionHandlers.ts`, `hub/src/voice/` |
| Attach agent chat | `machines.ts`, `scripts/attach-agent-chat.sh` |

### Important patterns

- **RPC:** `rpc-register` + `rpcGateway.ts`
- **Versioned updates:** stale rejected
- **Session modes:** `local` vs `remote`
- **Permission modes:** `default`, `acceptEdits`, `bypassPermissions`, `plan`
- **Namespaces:** `CLI_API_TOKEN:<namespace>`

### Critical thinking

1. Fix root cause (not band-aid).
2. Unsure: read more code; ask w/ short options.
3. Conflicts: call out; pick safer path.
4. Unrecognized changes: assume other agent; focus your changes.
5. **Upstream first** - general fixes → upstream PR.
6. **Maintainer canon read-only** - never PR edits to `AGENTS.md`, `CONTRIBUTING.md`, root `README.md`.
7. **Fork agent doc is here only** - root `AGENTS.md` must not exist on fork `main`.

---

## New functionality intake

When the operator asks for **new product behavior**, follow [`docs/tooling/new-feature-intake.md`](../tooling/new-feature-intake.md) end-to-end.

**Orchestrator** completes steps 1-3 (and usually 4-5), then spawns a **feature peer** with the mandatory handoff block in that doc (completed steps vs peer-owned steps).

**Feature peer** implements in **`~/coding/hapi/worktrees/<name>`** (created via `hapi-worktree-create <name> --branch <branch>`) — not in `~/coding/hapi/driver` by hand. For §6 Playwright / visual evidence, use **`hapi-peer-stack up`** (isolated hub on `3100–3199`, registry `~/.hapi-peer/`) so proof does not yank `:3006`. **Always soup-promote** the tip for estate dogfood on `:3006` (heal/union if needed) — peer stack is not a substitute. Pass §6 **and** promote soup **before** asking the operator to browser-test on `:3006`. Upstream PR only after operator dogfood approval (§8). Use **`hapi-pr-create`** to open the PR — it enforces the closes-keyword + leak scan.

**Instruction roots:** agents read **this file** and tooling docs from the **`~/coding/hapi` workspace**, plus `~/coding/AGENTS.local.md`. The **daily driver** (`~/coding/hapi/driver`) is what **`hapi-active` runs** — not where IDE rules come from unless that tree is the opened workspace.

**Do not overwrite `cli/AGENTS.md` or `hub/AGENTS.md`.** Those paths are **tracked stubs** pointing here and to `docs/guide/client-auth.md`. Machine-global `~/coding/AGENTS.md` is already injected by Cursor; fork canon is this file. Peer handoffs belong in `docs/plans/peer-briefings/`, not pasted into package AGENTS files.

**Canonical worktree layout (2026-06-01 onward):** see [`.cursor/rules/worktree-layout.mdc`](../../.cursor/rules/worktree-layout.mdc) and [`docs/plans/2026-06-01-hapi-folders-reorganization.md`](../plans/2026-06-01-hapi-folders-reorganization.md). Summary: `~/coding/hapi/{driver,upstream,worktrees/<name>}` — never create new worktrees at `~/coding/hapi-<name>/` or `~/coding/hapi-worktrees/<name>/` (those are pre-reorg legacy locations being drained).

---

## Peer spawn handoff (required)

Do not spawn a feature peer without filling the template in [`new-feature-intake.md` §0](../tooling/new-feature-intake.md#0--feature-peer-agent--mandatory-handoff). Minimum: parent session id, playback summary, which steps are **DONE** vs **peer-owned**, worktree path, demo topology (soup vs clean).
