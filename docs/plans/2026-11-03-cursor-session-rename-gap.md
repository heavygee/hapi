# Cursor (and ACP) session rename gap — findings (2026-11-03)

**Status:** diagnosis **CONFIRMED** by [upstream issue/pr discovery](/sessions/6ce7f124-6240-4479-8dad-f2e27eb880a1) (2026-11-03). Tracker [#2269](https://github.com/tiann/hapi/issues/2269). Path **A** rides existing community PR [#1672](https://github.com/tiann/hapi/pull/1672) — do **not** open a duplicate PR. Path **C** deferred as separate follow-up.

**Source session:** [Boards: edit issue title/body](/sessions/9a25e9d0-557c-44b1-b5cd-505c231cbeb6) (Cursor; spawned via hapi-inline `/opmic` “interrupt and continue”).

**Operator posture:** Very surprised that there is **no apparent trivial built-in Cursor ability to rename a HAPI session**. Treat that surprise as a product smell, not an agent training failure alone.

---

## Genesis vs real scope

| | |
|--|--|
| **Trigger** | Operator mic (`hapi-inline` / `/opmic`) spawned this Cursor session with a rant-as-title; agent did not self-name; rename then took multi-step archaeology. |
| **Real scope** | **Generic HAPI**, not “an opmic bug.” OpMic is one bare-spawn transport. The missing **one-shot rename** hits **every Cursor ACP session** (and, by the same policy, OpenCode + Kimi remote ACP). Claude still gets `change_title`. |

Do **not** frame the tracker as hapi-inline-only. Dock may still want a better provisional title at spawn (see path C), but the core gap is HAPI’s Cursor/ACP title story.

---

## What happened (incident shape)

1. OpMic spawned a Cursor peer into a worktree with the mic transcript as the first user message.
2. Intake §0-backstop says bare/`/opmic` peers must **self-name** before implement (`docs/tooling/new-feature-intake.md`). Operator AGENTS says the same under hapi-inline (“Bare spawn from `/opmic`”).
3. Agent did not rename on turn 1. Sidebar showed truncated mic prose as the “name,” so “generic or unset” was easy to rationalize away.
4. When called out, agent had **no `change_title` in the Cursor `hapi` MCP tool list**. Rename required: discover `PATCH /api/sessions/:id` `{name}`, fight shell/`curl` redirection into context-mode, then succeed. Not a one-liner.

Separate workstream (not this doc’s implement target): board detail lacks issue title/body edit — remitted to [todo board view ui](/sessions/fc47e8d8-f3bc-4c1e-85fb-6c533e2b73b1) to fold into existing Boards PRs (`heavygee/hapi#238`, `tiann/hapi#2147`); **no new upstream issue for that**.

---

## Diagnosis (to confirm)

### A. Self-name is a doc obligation without a Cursor mechanism

- Rule lives in intake §0-backstop + `docs/operator/AGENTS.md` (hapi-inline table).
- It is **not** a forced first action in Cursor’s always-on session surface the way `AGENT_NOTIFY_SUMMARY` is.
- OpMic does not inject “rename yourself first” into the remit; transport is title-blind aside from whatever native/auto title lands.

### B. One-shot rename was **deliberately removed** for Cursor ACP

Evidence on estate soup / mirror:

- `cli/src/cursor/cursorAcpRemoteLauncher.ts` passes `enableChangeTitle: false` into `buildHapiMcpBridge`.
- Same pattern: OpenCode + Kimi remote launchers.
- Landed via **tiann/hapi#1028** (Fixes **#838**): *“disable HAPI's `change_title` MCP tool for remote Cursor, OpenCode, and Kimi ACP sessions”* — native ACP titles (`session_info_update` / `session/list`) become authoritative; MCP fallback removed; OpenCode title prompt removed.
- Comment in `cli/src/modules/common/hapiMcpBridgePrompt.ts`: Cursor uses native MCP overlay + tool descriptions; **no** user-turn prepend of `HAPI_MCP_TITLE_INSTRUCTION` (prompt-taint). With `change_title` off, there is also **no** tool description telling the model to rename.

So for Cursor agents today:

| Capability | Present? |
|------------|----------|
| MCP `change_title` / `hapi_change_title` | **No** (disabled) |
| Injected “rename once when objective is clear” prompt | **No** |
| Native ACP auto-title → HAPI summary bridge | **Yes** (policy intent of #1028) |
| Documented one-shot agent rename for Cursor | **No** first-class path |
| Hub still supports rename | **Yes** — `PATCH /api/sessions/:id` `{ name }` → `renameSession` / `metadata.name` (#1896 exit: name, not summary-only) |

### C. Why the operator’s surprise is correct

Other flavors (Claude) still expose an obvious tool: call `change_title` once. Cursor agents on HAPI look at their tool list and **do not see a rename tool**. Expecting them to know hub PATCH + schema + avoid prompt-taint paths is not “trivial built-in.” Native ACP titles may auto-label from the first rant; that is not the same as an agent-controlled workstream rename.

Related residue: `docs/plans/retros/2026-09-21-change-title-rename-exit.md` (#1896) — explicit rename must set `metadata.name`; summary-only is invisible once spawn `--name` exists. Any restore of Cursor rename must respect that.

---

## Proposed paths (decision menu — discovery to recommend)

| ID | Path | Intent |
|----|------|--------|
| **A** | Re-enable MCP `change_title` for Cursor (and likely OpenCode/Kimi) **with precedence**: explicit agent rename writes `metadata.name` and wins over later native auto-titles until the user/agent renames again | Restore the trivial one-shot; fix the fight #1028 avoided by deleting the tool |
| **B** | Keep MCP off; document/expose Cursor-native title control if ACP actually allows agent-driven rename | Only viable if there is a real, callable native path — verify, don’t assume |
| **C** | OpMic / bare-spawn stamps a **provisional** workstream title at create (not full STT rant) | Fixes spawn labeling; does **not** replace A/B for mid-session rename |
| **D** | Doc / alwaysApply rule only | Insufficient alone — already failed under mic pressure |

**Author lean (source session):** **A + C**. Operator surprise maps to missing tool (A). OpMic rant-as-title is a spawn UX bug (C). Do not ship D alone.

**Out of scope for the rename tracker:** implementing board title/body edit (already with Boards peer).

---

## Discovery peer assignment

**To:** [upstream issue/pr discovery](/sessions/6ce7f124-6240-4479-8dad-f2e27eb880a1)

Please:

1. **Confirm or correct** this diagnosis against current `upstream/main` + estate soup (tool registration, #1028/#838/#1894/#1896, any follow-ups that re-enabled title tools for some flavors).
2. **Search** `tiann/hapi` (and fork if needed) for open/closed issues/PRs on Cursor rename, ACP title sync, `enableChangeTitle`, opmic self-name.
3. Recommend **one** path (or sequenced A then C) and whether the tracker belongs on `tiann/hapi` (upstream-destined product) vs fork-only.
4. File / link the issue **only after** confirmation — do not rubber-stamp this note.
5. Capture the operator signal verbatim in the issue framing: **surprised there is no trivial built-in Cursor ability to rename a session.**
6. Ping back [Boards: edit issue title/body](/sessions/9a25e9d0-557c-44b1-b5cd-505c231cbeb6) (or Meta if this session is archived) with verdict + links.

**Do not** implement product code from this handoff unless the operator later assigns an implementer.

---

## Key citations (starting points)

- `cli/src/cursor/cursorAcpRemoteLauncher.ts` — `enableChangeTitle: false`
- `cli/src/codex/utils/buildHapiMcpBridge.ts` — registers `change_title` only when not false
- `cli/src/modules/common/hapiMcpBridgePrompt.ts` — Cursor does not get title instruction prepend
- tiann/hapi#1028 / #838 — disable change_title for Cursor/OpenCode/Kimi ACP
- tiann/hapi#1896 / #1894 — `change_title` → `metadata.name`
- `docs/tooling/new-feature-intake.md` §0-backstop — self-name on bare/`/opmic` spawn
- `docs/operator/AGENTS.md` — hapi-inline bare spawn row

---

## Discovery verdict (2026-11-03)

- **Confirmed** on `upstream/main`: Cursor/OpenCode/Kimi/Copilot `enableChangeTitle: false`; Claude true; no Cursor title prompt inject; hub PATCH `{name}` + #1896/#2072 intact.
- **Path B rejected** — no agent-callable native Cursor rename (ACP auto-title sync only).
- **Path A already in flight** via community [#1672](https://github.com/tiann/hapi/pull/1672) (junmo-kim) — re-enable `change_title` + manual precedence. Discovery asked author for `Fixes #2269`.
- **Path C** = separate follow-up (opmic/bare-spawn provisional title); may touch hub spawn and/or `heavygee/hapi-inline`. File when operator opens that workstream.
- **Reject D-alone.** Related: [#1976](https://github.com/tiann/hapi/pull/1976) (opt-in auto titles, complementary); [#271](https://github.com/tiann/hapi/issues/271) (different ask).
- Filed: [tiann/hapi#2269](https://github.com/tiann/hapi/issues/2269) (operator surprise preserved). Comment on #1672 linking #2269.

### Path C ownership (2026-11-03)

Operator: Path C is **critical for hapi-inline** (tool FOR HAPI, installed in other apps). Remitted to [hapi-inline ownership oos](/sessions/40da5da5-a8ff-49af-a421-6323e26c2582) — provisional title at dock-spawn; complementary to A; may need hub spawn `name` cooperation.

**Owned + filed:** [heavygee/hapi-inline#566](https://github.com/heavygee/hapi-inline/issues/566) — *Path C — provisional title on opmic / spawn-per-send (no rant-as-title)*. Does **not** block on Path A / #1672 / #2269.

**Hub half (Discovery 2026-11-03):** **not needed.** Peer #566 confirmed provisional title = post-spawn `PATCH` `{name}`; ACP auto-title does **not** overwrite `metadata.name`. Path A remains #2269 / babysit #1672.

### Babysit #1672 + lane B assessment (2026-11-03)

Babysitter: [Boards: edit issue title/body](/sessions/9a25e9d0-557c-44b1-b5cd-505c231cbeb6) (this session; chip on #1672).

| Check | Result |
|-------|--------|
| `hapi-pr-status` three-dim | **CLEAN** (CI pass, 0 unresolved threads, latest bot Pass) |
| `mergeable` / mergeState | MERGEABLE / CLEAN |
| `maintainerCanModify` | true (junmo-kim fork) |
| Auto lane B size (product files excl. tests) | **10 files**, **Δ123** (88+/35−) — **over** caps (≤8 files, ≤120 Δ) |
| Labels | `enhancement`, `area:cli`, `community-pr` — **no** `low-impact` / `dogfooded` |
| `Fixes #2269` in PR body | **not yet** (Discovery asked author; do not edit others' PR bodies) |

**Lane B verdict:** **Not auto-B.** Oversize by 2 product files and ~3 lines of delta. Becomes lane-B **only** via promote (`low-impact` / `dogfooded` + policy) or allowlist. Without promote → **lane A** (wait @tiann). Agents remain prepare-only; merge needs operator TTY + `hapi-laneb-authorise` even after promote.

Honest promote read: focused restore of `change_title` + manual precedence — candidate for `low-impact` if labelling session agrees, or `dogfooded` after estate soup dogfood. Not silent auto-B.

### Dogfood + `dogfooded` path (2026-11-03)

Operator: not auto-B → dogfood then assess `dogfooded` merge basis. **Ran.**

| Proof | Result |
|-------|--------|
| Peer stack `1672-change-title` on PR tip `0e6266df0` | up → live MCP dogfood → down |
| Soup `:3006` tip | **not** yet (cherry-pick onto soup HEAD conflicted; soup still `enableChangeTitle: false`) |
| `tools/list` includes `change_title` | **yes** |
| `change_title` → `metadata.name` + `acpManualTitle` | **yes** |
| Later native title sync does not overwrite | **yes** |
| Tip tests | `acpSessionTitle` + `buildHapiMcpBridge.integration` green |

**Assessment:** **Yes — `dogfooded` is the right lane-B promote** for this PR (focused, community, CLEAN, oversize auto-B). Label + stamp applied; **48h UTC countdown** before merge eligibility. Agents remain prepare-only; merge needs operator TTY + `hapi-laneb-authorise` after the window.

**Not claimed:** production `:3006` soup dogfood (conflicts). Peer-stack live install satisfies the dogfooded “real HAPI install” bar; soup tip still desirable as follow-up.

## Changelog

- 2026-11-03 — Written from opmic Cursor session incident; dispatched to upstream issue/pr discovery.
- 2026-11-03 — Discovery CONFIRMED; #2269 filed; A via babysit #1672; C deferred.
- 2026-11-03 — C → hapi-inline ownership; this session babysits #1672; lane B = not auto (need promote).
- 2026-11-03 — Path C tracker [hapi-inline#566](https://github.com/heavygee/hapi-inline/issues/566); dogfooded stamp on #1672 (48h).
- 2026-11-03 — Discovery: no `tiann/hapi` hub issue for Path C (PATCH name survives ACP auto-title).
