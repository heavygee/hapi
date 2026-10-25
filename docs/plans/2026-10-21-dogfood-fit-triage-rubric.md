# Dogfood-fit triage: choosing which *foreign* upstream PRs we run first

**Date:** 2026-10-21 · **Status:** design, ready for Meta PR watcher to adopt
**Scope:** open PRs on `tiann/hapi` **not** authored by `heavygee`
**Remit source:** operator — *"evaluate PRs not just technically / CI, but fit for the project and where it is going"*, with **much more weight on merge-permission collaborators' statements (and @tiann)**.

This is **selection**, not merge. It answers *which community PR do we put on the estate next*, which then feeds the existing `dogfooded` 48h opt-out lane ([Discussions #2083](https://github.com/tiann/hapi/discussions/2083)). Everything here is **prepare-only on upstream**.

---

## 0. Why this is a separate axis from the chip

The existing chip (`hapi-pr-emoji-batch.sh` → ✅/🔁/⚠️) answers **"is it healthy?"**. It says nothing about **"should it exist?"**. The backlog proves the two come apart:

- **211** open foreign PRs (2026-10-21), **49** CONFLICTING, **6** draft.
- Author concentration: `techotaku39` 73, `miuiadmin` 21, `junmo-kim` 17, `swear01` 16.
- Age: `2026-03` 2 · `2026-04` 6 · `2026-05` 3 · `2026-07` 14 · `2026-08` 81 · `2026-09` 47 · `2026-10` 58.

A green CI on a PR @tiann has already pushed back on is not a dogfood candidate. A conflicting PR from April that implements something he explicitly endorsed may be.

**`updatedAt` is a liar.** PR #394 shows `updatedAt = 2026-09-12` but `lastCommit = 2026-04-04` and last human comment `2026-04-11` (hqhq1025). A repo-wide mergeability recompute bumped ~every stale PR to 2026-09-12. **Staleness must be computed as `max(last non-bot comment, last commit committedDate)`**, never `updatedAt`.

---

## 1. Canon sources, ranked by weight

Re-derive tier 3 every pass; do not hardcode the roster.

### Tier 0 — @tiann on *this* PR (overrides everything)

His review/comment on the artifact itself. If he asked for a trim, a different approach, or said no, the fit question is **already answered**.

```bash
gh api repos/tiann/hapi/issues/<N>/comments --jq '.[]|select(.user.login=="tiann")|"\(.created_at[:10]) \(.body)"'
gh api repos/tiann/hapi/pulls/<N>/reviews  --jq '.[]|select(.user.login=="tiann")|"\(.submitted_at[:10]) \(.state) \(.body)"'
```

### Tier 1 — @tiann's stated product doctrine (quote these; they are the rubric's spine)

| Doctrine | Primary source | Quote |
|---|---|---|
| **Core value proposition test** | [#1583](https://github.com/tiann/hapi/pull/1583) (closed) | *"HAPI exists to fill a gap: terminal-native agents (Claude Code, Codex, Gemini) lose controllability the moment you step away from the machine, so HAPI adds remote control with seamless local↔remote switching"* — and therefore *"I don't think HAPI is the right home for a deep DSH integration."* |
| **Scope proportionality** | [#1309](https://github.com/tiann/hapi/pull/1309) | *"The problem is real; the framework is disproportionate. … The genuine UX issue is narrow … That deserves a fix — but it's a one-line layout decision, not a customization [framework]."* |
| **Trim, don't bundle** | [#1108](https://github.com/tiann/hapi/pull/1108) | *"I'd like to **trim this PR down to the governance/alerting subset** and drop the auto-upgrade machinery."* |
| **Settings are not discoverability** | [#1798](https://github.com/tiann/hapi/pull/1798) | *"a global Display setting is itself hard to discover: users who do not know HAPI supports additional Agents are unlikely to look for this toggle. … Could we instead add a lightweight 'View other supported Agents' [affordance]"* |
| **Don't regress a deliberate design** | [#1199](https://github.com/tiann/hapi/pull/1199) | *"the implementation is clean … but I'd like to push back on the direction rather than the code. The legacy layout was replaced for a reason."* |
| **No duplicate channels** | [#553](https://github.com/tiann/hapi/pull/553) | *"Sorry, I won't accept this PR since we've already supported https://sct.ftqq.com/ in #515."* |
| **Surface-area creep is the real cost** | [#769](https://github.com/tiann/hapi/pull/769) | *"如果做 Desktop App，很有可能到最后把主页那一堆都顺手塞进去了，这可能不是个好主意"* (a desktop app ends up absorbing everything on the homepage — probably a bad idea). |
| **Tests must cover the claim, not the happy path** | [#1809](https://github.com/tiann/hapi/pull/1809) | *"20 raw messages do not necessarily produce 20 meaningful UI items … The new text-only fixture verifies the request size … but does not cover this distinction."* |
| **Skills + CLI over MCP** | [Discussions #1258](https://github.com/tiann/hapi/discussions/1258), 2026-08-06 | *"I believe skills + CLI is a better solution than MCP. … MCP infiltrates the system prompt and occupies a fixed context window, while skills load progressively."* Echoed on [#1195](https://github.com/tiann/hapi/pull/1195): *"ping-peer is better suited to skills."* |
| **A2A is the endorsed next direction** | [Discussions #1258](https://github.com/tiann/hapi/discussions/1258), 2026-07-31 | *"starting with Agent-to-Agent (A2A) collaboration is the perfect pragmatic first step"* — artifact-based handoffs, "One Boss" routing, unified work advertisements. Corroborated by his own freedrop dogfood story (two machines, two Codex sessions, `@session`, 1.9× throughput). |
| **Mega PRs are a stated non-starter** | `CONTRIBUTING.md` | *"We do not accept oversized pull requests that introduce large features all at once. … If you want to add a significant feature, please open an issue first."* Plus: disclose AI authorship; one concern per PR; tests; docs. |
| **Stale + conflicting gets closed, politely** | 2026-07-23 sweep (#951, #949, #320, #537, #983, #981, #891, #807, #780) | *"Closing as part of repository maintenance: this PR has merge conflicts with the main branch and has had no activity for over two weeks. If the change is still relevant, please rebase onto the latest main and feel free to reopen."* |

### Tier 2 — revealed preference (what actually merges)

```bash
gh pr list --repo tiann/hapi --state merged --limit 120 \
  --json number,title,author,mergedAt,additions,deletions,changedFiles
```

Shape of the last ~120 merges: overwhelmingly `fix(...)`-scoped, single-concern, mostly ≤ ~1k lines, concentrated in `web` / `codex` / `cli` / `ios`, with tests. Large `feat(...)` lands when it is one coherent capability (e.g. `feat(codex): support user-configured MCP servers`, `feat(web): file context menu`) — not when it is a framework.

### Tier 3 — other write collaborators (re-derive every pass)

```bash
gh api repos/tiann/hapi/collaborators --paginate \
  --jq '.[]|select(.permissions.push)|"\(.login)\tadmin=\(.permissions.admin)"'
```

As of 2026-10-21 that is exactly **`tiann` (admin)**, **`hqhq1025` (push)**, **`heavygee` (push)**. So "merge-permission collaborator statements" ≈ @tiann, plus `hqhq1025` review comments at reduced weight.

> **Self-citation trap.** `heavygee` is on that list. Our own Discussions (#1258 opener, #1332, #1363) are **not** independent direction evidence — only **@tiann's replies to them** are. Never score a PR up because it agrees with a heavygee discussion post.

### Tier 4 — the shipped public pitch (what HAPI *is* today)

`website/src/locales/en.json` hero: **"Vibe Coding Anytime, Anywhere"**, *"Your AI agents work in the background. Get native app or messaging app notifications when they need your input"*; showcase: *"Start on Desktop. Continue Anywhere. Switch Back Anytime"*, *"Your session lives on your machine. Your phone is just a window."* Root `README.md` feature list (Seamless Handoff / Native First / AFK Without Stopping / Terminal Anywhere / Voice Control / Workspace Browser). `docs/guide/why-hapi.md`: decentralized, one hub per user, **single binary**, low complexity, data sovereignty.

Use tier 4 as the **"is it core today?"** test. A PR that improves handoff, AFK approval, notification, or remote session fidelity is on the main line. A PR that adds a service dependency or a second daemon fights `why-hapi.md`'s single-binary claim.

### Tier 5 — community direction, weighted by maintainer engagement

[#1258](https://github.com/tiann/hapi/discussions/1258) (11 comments, tiann twice), [#1332](https://github.com/tiann/hapi/discussions/1332) A2A RFC, [#691](https://github.com/tiann/hapi/discussions/691) voice roadmap, [#746](https://github.com/tiann/hapi/discussions/746) Android/Wear, [#1888](https://github.com/tiann/hapi/discussions/1888) positioning (no maintainer reply yet — advisory only), [#1492](https://github.com/tiann/hapi/discussions/1492) scoped tokens.

Notable non-maintainer constraint worth honouring because two write-adjacent voices repeated it (KorenKrita, swear01, bobleer): *"keep native agents native … make HAPI the connection and coordination layer between them"* — HAPI should not become the owner of every runtime's filesystem, credentials, or MCP state.

### Tier 6 — our standing process (procedure, not direction)

[Discussions #2083](https://github.com/tiann/hapi/discussions/2083) `dogfooded` 48h opt-out · `docs/plans/2026-07-31-pr-merge-lanes.md` § Label ownership · `lib/dogfood-countdown.sh` · `hapi-pr-merge-gate.sh`.

### Explicitly **de-weighted** as public fit evidence

`docs/operator/*`, `docs/plans/*`, estate jargon (soup, remat, chip, lane A/B/C, union tip, `:3006`), XR plans, fork-only roadmaps. These may decide *whether we can conveniently dogfood a thing* — they must **never** appear in a fit rationale, and never in a public comment (§ Public GitHub voice).

---

## 2. The rubric

Two axes, kept separate. **READY** stays the chip. **FIT** is new.

### 2a. Hard gates — any hit ⇒ `SKIP`, record the gate, stop scoring

| Gate | Test | Why |
|---|---|---|
| **G1 maintainer objection standing** | @tiann asked for a trim / different approach / said no, and the author has not addressed it | Tier 0. Reviving it is operator work, not agent work |
| **G2 duplicate or superseded** | Same capability already merged, or a fresher PR exists for it | #553 precedent |
| **G3 draft / self-declared WIP** | `isDraft` or body says WIP | Author hasn't asked for it |
| **G4 core-value-proposition miss** | Does not serve *remote control + seamless local↔remote handoff of a terminal-native agent the user runs themselves* | #1583, verbatim test |
| **G5 not dogfoodable here** | iOS / Android / macOS / Windows-only, or needs a vendor account the estate lacks | **`dogfooded` means a write collaborator actually ran it.** We cannot honestly label what we cannot run. Score it `WATCH`, never `DOGFOOD NEXT` |
| **G6 maintainer-canon diff** | Touches `AGENTS.md`, `CONTRIBUTING.md`, `LICENSE`, `SECURITY.md`, root `README.md`, `.github/*`, `website/` | We don't sponsor changes to the maintainer's own canon |

### 2b. FIT score — 10 dimensions, 0–3 each, weighted (max **60**)

| # | Dimension | ×  | 3 | 1 | 0 |
|---|---|---|---|---|---|
| F1 | **Maintainer alignment** | 3 | Implements something @tiann asked for or endorsed (A2A, skills+CLI, local-first, a filed issue) | Neutral / unaddressed | Contradicts a stated position |
| F2 | **Problem clarity** | 2 | Body names a concrete user-visible bug/gap with repro | Plausible but unstated | "Improve X", no problem |
| F3 | **Default-path impact** | 2 | Every user hits it, no config | Opt-in but discoverable in-flow | Behind a settings toggle nobody finds (#1798) |
| F4 | **User-visible value** | 2 | We'd notice it missing on the estate tomorrow | Nice-to-have | Pure internal refactor |
| F5 | **Scope proportionality** | 2 | One concern; diff proportionate (CONTRIBUTING) | Slightly broad | Framework for a one-line problem (#1309) |
| F6 | **Blast radius** *(inverted)* | 2 | Additive / default-off / trivially revertible | Contained behaviour change | Hub protocol, DB schema, auth, relay, or new runtime dependency |
| F7 | **Dogfoodability on this estate** | 3 | Runs on our soup today (hub/cli/web, Linux) | Runs but needs a stack flip | Can't run it ⇒ see G5 |
| F8 | **Liveness** | 1 | Author pushed or replied ≤14d | 15–60d | Silent >60d |
| F9 | **Collision with in-flight work** *(inverted)* | 2 | No file overlap | Adjacent files | Overlaps an open @tiann PR or a heavygee PR in flight |
| F10 | **Etiquette cost** | 1 | Label + stamp only; no public comment needed | One short operator-approved note | Needs us to ask the author to rebase/rescope |

Compute staleness for F8 as `max(last non-bot comment, last commit)` — **not** `updatedAt`.

### 2c. Bands

| Band | Condition | Action |
|---|---|---|
| **DOGFOOD NEXT** | FIT ≥ 42 · no gate · F7 = 3 · chip ✅ or a green-able 🔁 | Queue for a live estate run. Label `dogfooded` + stamp **only after** the run, by whoever ran it |
| **WATCH** | FIT 30–41, or ≥42 but blocked on CI / conflicts / G5 | Re-score next pass; note the single unblocking condition |
| **ADOPT-OR-CLOSE** | staleness >60d **and** (CONFLICTING **or** FIT <30) | Produce a **recommendation for the operator**, split *adopt* (FIT ≥36, worth reviving) vs *recommend close* (FIT <24 + conflicting). **Never act on GitHub** |
| **SKIP** | any hard gate | Record gate id so later passes don't re-litigate |

Cap `DOGFOOD NEXT` at **3 per pass**. A dogfood is a real install on the live stack; a queue of 12 is a queue of 0.

---

## 3. Pasteable Meta tick prompt

```text
DOGFOOD-FIT PASS — open tiann/hapi PRs not authored by heavygee.
Selection only. PREPARE-ONLY on upstream: no merge, no close, no public comment,
no label from this pass. Rubric: docs/plans/2026-10-21-dogfood-fit-triage-rubric.md

INPUTS (fetch fresh; do not trust cached or remembered values)
 1. Write collaborators — re-derive, never hardcode:
    gh api repos/tiann/hapi/collaborators --paginate \
      --jq '.[]|select(.permissions.push)|"\(.login) admin=\(.permissions.admin)"'
 2. Candidate set:
    gh pr list --repo tiann/hapi --state open --limit 500 \
      --json number,title,author,createdAt,updatedAt,isDraft,additions,deletions,\
changedFiles,labels,mergeable,reviewDecision \
      | jq '[.[]|select(.author.login!="heavygee")]'
 3. Per candidate you intend to score:
    gh pr view <N> --repo tiann/hapi --json commits,comments,files
    gh api repos/tiann/hapi/issues/<N>/comments --jq '.[]|select(.user.login=="tiann")|.body'
    gh api repos/tiann/hapi/pulls/<N>/reviews  --jq '.[]|select(.user.login=="tiann")|"\(.state) \(.body)"'
 4. Revealed preference baseline (re-read each pass, ~1 min):
    gh pr list --repo tiann/hapi --state merged --limit 120 \
      --json number,title,author,mergedAt,additions,deletions,changedFiles

SCOPE THE PASS (do not score 200 PRs)
 - Weekly deep pass: candidates whose staleness is <=60d, plus the oldest 10 untriaged.
 - Daily thin slice: only PRs opened or state-changed in the last 24h, max 10.
 - Staleness = max(last non-bot comment, last commit committedDate). NEVER updatedAt
   (a repo-wide mergeability recompute bumped every stale PR to 2026-09-12).

GATES — any hit => SKIP with the gate id, stop scoring that PR
 G1 standing @tiann objection unaddressed   G4 fails the #1583 core-value test
 G2 duplicate / superseded                  G5 not runnable on this estate (iOS/Android/macOS/Windows-only)
 G3 draft / WIP                             G6 touches maintainer canon (AGENTS/CONTRIBUTING/LICENSE/SECURITY/README/.github/website)

SCORE (0-3 each, weights in brackets; max 60)
 F1 maintainer alignment [3]   F6 blast radius, inverted [2]
 F2 problem clarity [2]        F7 dogfoodable here [3]
 F3 default-path impact [2]    F8 liveness [1]
 F4 user-visible value [2]     F9 collision with in-flight work, inverted [2]
 F5 scope proportionality [2]  F10 etiquette cost [1]

 Anchor F1 and F5 on quotes, not vibes. The spine:
  - #1583 "HAPI exists to fill a gap: terminal-native agents lose controllability the
    moment you step away ... remote control with seamless local<->remote switching"
  - #1309 "The problem is real; the framework is disproportionate"
  - #1798 "a global Display setting is itself hard to discover"
  - #553  "I won't accept this PR since we've already supported ... in #515"
  - Discussions #1258 "skills + CLI is a better solution than MCP"; A2A endorsed as
    "the perfect pragmatic first step"
  - CONTRIBUTING.md "We do not accept oversized pull requests"
 heavygee's own Discussions are NOT direction evidence. Only @tiann's replies are.

OUTPUT — exactly these four sections, highest score first, max 3 in DOGFOOD NEXT

 ## DOGFOOD NEXT  (FIT>=42, no gate, F7=3, chip green or green-able)
 #<N> <title>  @<author>  FIT <x>/60  chip <emoji>  +a/-d f=<n>
   fit: <one line, quoting the tier-0/1 source that justifies it>
   run: <what to actually exercise on the estate to call it dogfooded>
   next: live run -> whoever ran it applies `dogfooded` + "dogfooded since <ISO UTC>"
         -> 48h window (discussions/2083) -> operator/Meta `hapi-laneb-authorise` + merge

 ## WATCH  (FIT 30-41, or high FIT blocked)
 #<N> FIT <x>  blocked-on: <single unblocking condition>

 ## ADOPT-OR-CLOSE  (stale >60d and (conflicting or FIT<30)) - RECOMMENDATION ONLY
 #<N> FIT <x>  stale <d>d  <ADOPT|RECOMMEND CLOSE>  — <one line>
   draft-for-operator: <plain-language note the operator could post as heavygee,
                        first person singular, zero estate jargon, or "none needed">

 ## SKIP
 #<N> gate <G#> — <one line>

HARD RULES
 - No gh pr merge / gh pr close / gh pr comment / gh issue comment / gh pr edit on tiann/hapi.
 - No label from this pass. `dogfooded` is applied ONLY by whoever actually ran it live.
 - `low-impact` on a community PR needs the author/operator ask - not this pass.
 - Any public wording goes to the operator as a draft first (AGENTS.md § Public GitHub voice):
   first person singular "I", never "we"; no soup/Meta/remat/chip/lane A/B/C/:3006.
 - Do not police other contributors. Treat silence as time lag, not neglect.
 - Report what you did NOT score and why (budget, scope) - no silent truncation.
```

---

## 4. Historical triage playbook (oldest-open first)

The scary number is misleading. The genuinely *old* cohort is small and tractable:

| Cohort | Count | Treatment |
|---|---|---|
| 2026-03 → 2026-05 | **11** | Pass 1. **All 11 are CONFLICTING.** Mostly big integrations (Feishu ×2, WeCom, mobile notifications at +113k/−7.9k, session import at +8.9k) |
| 2026-07 | **14** | Pass 2 |
| 2026-08 → 2026-10 | 186 | Normal weekly flow, not "historical" |

**Order of operations per old PR**

1. **Tier 0 first.** Has @tiann already ruled? #553 is already a stated "no" and is still open — that's a `SKIP G1`, and a clean *recommend-close* candidate for the operator, not a fit question.
2. **Duplicate check.** #312 and #325 are both Feishu (`增加飞书支持` / `Feishu support`) from different authors, both stale. At most one can be adopted; the pair is itself the recommendation.
3. **Mega-PR check.** #490 (+113,035/−7,945, 719 files) and #518 (+8,937/−304, 119 files) fail `CONTRIBUTING.md` on their face. Adoption would mean **slicing**, which is the author's call or a fresh PR — not something we can do on their branch.
4. **Small + conflicting + still relevant** is the sweet spot for *adopt*. Verified candidates in the old cohorts:

   | PR | Size | Why it's an adopt candidate |
   |---|---|---|
   | [#394](https://github.com/tiann/hapi/pull/394) | `+33/−9`, 2 files | Sync Claude Code session title to the web UI. Last human touch 2026-04-11 by **hqhq1025** (write collaborator) — tier-3 interest already on record |
   | [#658](https://github.com/tiann/hapi/pull/658) | `+159/−6`, 4 files | `fix(cli)`: preserve permission mode after ExitPlanMode. Pure default-path correctness, the shape that actually merges (tier 2) |
   | [#1059](https://github.com/tiann/hapi/pull/1059) | `+22/−307`, 4 files | Removes dead `PiModelPanel`/`PiThinkingLevelPanel`. Net deletion, near-zero blast radius |

   All three are CONFLICTING, so adoption means a rebase — the author's call, or ours only under `maintainerCanModify` + coordination (see the table below).
5. **Precedent for close wording already exists** — @tiann's own 2026-07-23 maintenance text. If the operator wants a close recommendation posted, reuse *his* register, don't invent one:
   > *"Closing as part of repository maintenance: this PR has merge conflicts with the main branch and has had no activity for over two weeks. If the change is still relevant, please rebase onto the latest main and feel free to reopen (or open a fresh PR). Thanks for the contribution!"*

   **We do not post that.** Lane C is explicit: *"Closing issues or PRs we don't own"* is forbidden. Our output is a list handed to the operator, who decides whether to raise it with @tiann at all.

**When to ask the operator before any public comment** — effectively always, per § Public GitHub voice. Concretely:

| Situation | Agent action |
|---|---|
| We want the author to rebase so we can dogfood | Draft for operator. Do not post. |
| We want to tell an author their PR duplicates another | Draft for operator. Do not post. |
| We want to recommend a close | Operator → @tiann. Never an agent, never a close. |
| @tiann or the author @-mentions us on a thread we're already in | Reply allowed; plain language, no estate jargon |
| Adopting via `maintainerCanModify` push | Only with `maintainerCanModify: true` **and** prior coordination with the author **or** explicit operator direction. Fast-forward / cherry-pick on top; never force-push over their commits |

---

## 5. Cadence

**Do not fold this into the hourly `hapi-meta-daily` tick.** That tick is chip-cache + ping-backoff machinery over *our* chipped sessions; it is state-gated to be a no-op on a second run. A 211-PR fit sweep with 3–4 `gh` calls per candidate is minutes of API work per hour producing nothing hourly-actionable, and it would couple selection latency to ping policy.

| Pass | When | Shape | Owner |
|---|---|---|---|
| **Weekly deep** | Mon ~09:00 Europe/London | Full prompt above; ≤60d candidates + oldest 10 untriaged; ≤3 DOGFOOD NEXT | Dedicated session, timer-pinged on the `hapi-issue-labelling-daily.sh` pattern (fixed remit, env `…_SESSION_ID`, resumes inactive via `hapi-ping-peer`) |
| **Daily thin** | With the existing 09:00-ish window | Only PRs opened/state-changed in last 24h, max 10; emit `DOGFOOD NEXT` / `WATCH` only | Same session |
| **Historical** | One-off, bounded | Pass 1 = the 11 pre-June PRs; Pass 2 = the 14 July PRs. Then it's over — this is not recurring cost | Same session, operator-triggered |
| **Countdown** | Already live | `hapi-meta-daily.sh` already prints `🟢 DOGFOODED COUNTDOWN` | Meta PR watcher (unchanged) |

Keeping it in its own session also keeps PR watcher's inbound policy intact — peers must not start pinging the watcher with dogfood results.

**Must stay human / operator:**

- The **live dogfood run itself**, and therefore the `dogfooded` label + `dogfooded since <ISO UTC>` stamp. An agent that did not run the build must not label.
- **Every public word** on a foreign PR or Discussion.
- **Any close**, and any recommendation reaching @tiann.
- `hapi-laneb-authorise` + `gh pr merge`. Agents remain prepare-only; `hapi-pr-merge-gate.sh` still blocks until the 48h window elapses.
- The judgment call to ask @tiann for direction when a high-FIT PR has no tier-0 signal at all.

---

## 6. Worked example — #1598 (the one already in flight)

`feat(web,hub): add opt-in search for session message content`, @techotaku39, opened 2026-08-15, `+7,949/−321`, 79 files, labels `enhancement, area:web, area:hub, platform:mobile, community-pr, dogfooded`.

By the raw `CONTRIBUTING.md` size test this is a mega PR and should fail F5. It is on the dogfood lane anyway, and the rubric explains why that is consistent rather than an exception: **F7 = 3** (runs on our soup), **F1 high** (search over your own session history is squarely the tier-4 "your session lives on your machine" pitch), **F3 = 3** (opt-in but reachable in the normal search flow, not buried in settings per #1798), **F8 = 3** (author live — commit 2026-10-21). The `dogfooded` label is precisely the instrument that converts "too big to review cold" into "someone with write access actually ran it for 48 hours." That is the lane's whole purpose, and #1598 is the reference case for it.
