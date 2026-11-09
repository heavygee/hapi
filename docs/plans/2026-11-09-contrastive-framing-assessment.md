# Contrastive framing in HAPI MCP tool prose — assessment

**Date:** 2026-11-09  
**Peer:** `fork/compress-tool-prose` (this worktree)  
**Surface measured:** daily-driver soup at `/work/coding/hapi/driver` (default-install tool set) + shared strings in `shared/src/sessionCitation.ts`, cross-checked against this worktree tip and sibling shrinks.  
**Not a code change.** Operator reviews before anything lands.

Sibling inputs already read (do not re-litigate):
- `docs/operator/2026-10-25-mcp-context-cost-audit.md` (branch `docs/mcp-context-cost-audit`)
- heavygee/hapi#311 / `docs/plans/2026-11-08-slim-big-tools-findings.md` — spawn_peer clause-history + session_job null-hoist
- tiann/hapi#2326 — shrunk `SESSION_ID_PREFIX_PARAM_DESCRIPTION` / `PEER_IDENTITY_UUID_RULE` on upstream (live MCP proof); **not yet on heavygee `main` / this tip / driver soup**

Tokenizer: `@anthropic-ai/tokenizer` (primary, same family as the audit) + `gpt-tokenizer` o200k cross-check, installed under `/tmp/tokcount` for this pass. No Anthropic `count_tokens` API key here. Caveat identical to the audit: Anthropic's published package is legacy vs Claude 3+/4/5 vocab.

---

## 0. Headline verdict on the operator hypothesis

**Hypothesis (paraphrased):** a tool's `description` is only read *after* the model has already decided to consider that tool, so "don't Grep / don't invent titles / don't POST machine-spawn with a message" belongs in system prompt (pre-selection), not inside the tool you'd rather have chosen.

**Verdict: partially false — and client-dependent. Do not treat it as a free cut license.**

Evidence against the absolute claim:

1. **Eager tool catalogs expose name + description + schema before any call.** Anthropic's own tool-use docs and MCP selection research (arXiv 2610.14334) treat description *and* parameter schema as selection-time metadata. Cursor's published behavior matches the audit: full schemas every turn. On Cursor, contrastive text *inside* `inspect_peer` / `ping_peer` is visible while Grep/Bash are also visible — that is exactly when "do NOT Grep `/sessions/`" can bias selection toward the peer tool.
2. **Claude Code Tool Search is the special case that makes the hypothesis look true.** When HAPI tools are deferred to name-only stubs (~141 tokens vs ~4k eager), the model does *not* see "do NOT Grep" inside `inspect_peer` until after `ToolSearch` loads it. For that client, selection-time anti-Grep **must** live in system prompt / clipboard steer. HAPI already does that via `buildSessionCitationSteerInstruction()` (Claude / Codex / OpenCode).
3. **Cursor has no HAPI citation system-prompt channel.** `cli/src/cursor/utils/cursorNotifyRuleOverlay.ts` states this explicitly: cursor-agent has no HAPI-controlled system-prompt path; the overlay only installs `hapi-session.mdc` (notify / @-mention identity), **not** the peer-citation block. Pi title extension likewise does not inject citation steer. For Cursor (and likely Pi/Antigravity unless proven otherwise), **MCP tool prose is the only HAPI-injected place those scar clauses fire.** Cutting tool-level "don't" without adding a Cursor-equivalent steer is a real regression risk on the client that already pays the full eager tax.

So: contrastive framing is often *wordy*, and a lot of it is *duplicated* across system + tool + param `.describe()`. But "it's negative, therefore wrong place" is not a valid cut rule. Cuts need: (scar trace) × (client coverage) × (whether a positive rewrite still names the competing action).

### Decision discriminator (Overseer stand-in, 2026-11-09)

**Cuts that remove *duplication* are client-independent and safe. Cuts that remove *content* are not.**

- **Duplication** = the same information already reaches the model once (system prompt and/or param `.describe()`). Dropping extra copies cannot change behavior on eager or deferred clients.
- **Content** = deleting or rewriting a clause so the model sees less information somewhere. Includes positive-only rewrites that drop competing-tool names. Needs scar review and, for scar clauses, dogfood — not token math.

This peer's recommendation to the operator (aligned with that discriminator): **approve duplication cuts, hold content cuts, keep the scars.** No product commit from this investigation peer.

---

## 1. Where steers actually fire (client matrix)

| Client | Peer citation system prompt? | MCP schemas in context | Implication for "don't Grep / don't invent" |
|---|---|---|---|
| Claude Code (Tool Search on) | Yes — `buildSessionCitationSteerInstruction` | Names first; full schema after ToolSearch | System prompt is load-bearing for *selection*; tool text mostly shapes args after load. Duplicating CONTACT/DELIVERY/FS-guard in tool + system is insurance with a real token cost. |
| Claude Code (eager / older models) | Yes | Full | Duplication is pure waste for identical clauses. |
| Codex / OpenCode | Yes (flavor-named tools) | Typically full | Same as Claude eager. |
| **Cursor ACP** | **No** (notify rule only) | **Full, every turn** | Tool descriptions are the steer. Highest cost + highest need for in-tool scar clauses. |
| Pi / Antigravity | Title-ish only (no citation block found) | MCP as registered | Treat like Cursor until proven otherwise: keep tool-level scar text. |

Clipboard cold-paste also carries `SESSION_REFERENCE_STEER_SUFFIX` (anti-Grep) — a third channel, not an MCP tool description, but it is why Grep-on-citation was such a common failure mode (#1370 / #1373).

---

## 2. What siblings already decided (build on, don't redo)

| Work | Outcome relevant here |
|---|---|
| #311 slim-big-tools | Cut *untraced* spawn prose (return-shape, same hub/namespace, Settings UI path). **Kept** POST-spawn-with-message, remit-fail-closed, permissionMode omit=yolo / don't-clone-parent, machine/dir cross-host. |
| #2326 shrink-shared-prompts | Upstream-only so far. Shrunk IDENTITY 53→36 and PREFIX 57→36 o200k; kept "never invent" / UUID-only / rename non-event. Explicitly did **not** reintroduce soup `agentSessionId survives hub-row churn`. Live MCP proof posted. |
| This pass | Contrastive / negative-framing lens + system-prompt duplication + Cursor gap. May propose *further* cuts on the same two strings #2326 touched — called out in §4. |

`PEER_WAIT_FOR_REPLY_PARAM_DESCRIPTION` from the handoff **does not exist** in driver or this tip (searched). Covered instead by wake + deliveryMode. No action.

---

## 3. Clause ledger

Columns:
- **Origin** — commit / issue, or untraced
- **Sys?** — also in `buildSessionCitationSteerInstruction` / flavor title prompts / clipboard suffix
- **Cursor gap?** — if cut from tools, Cursor loses it unless overlay grows
- **anth / o200k** — clause tokens now
- **Proposed rewrite** + tokens
- **Verdict** — cut / keep / move-to-system-prompt / unsure

### 3.1 Hub-path ≠ filesystem (the Grep trap)

| Clause | Where | Origin | Sys? | Cursor gap? | Now | Proposed | Verdict |
|---|---|---|---|---|---|---|---|
| `do NOT Grep, Glob, or Read it as a local filesystem path` | `INSPECT_PEER_TOOL_DESCRIPTION` | #1370 / #1373 `c7e38e872` — agents treated Copy-reference `/sessions/<id>` as a local path | Yes (sys + clipboard suffix) | Yes | 26 / 26 | Positive: `pass <id> as sessionIdPrefix` only (21) — **loses explicit Grep name** | **keep** (or shorten to `hub path, not a local file — use sessionIdPrefix`) — **unsure** that dropping the Grep/Glob/Read enumeration preserves effect; those are the exact tools observed |
| `do NOT search the local filesystem for it` | `PING_PEER_TOOL_DESCRIPTION`, `ARCHIVE_PEER_TOOL_DESCRIPTION` | Same lineage; archive via #2020 `c9e8177c3` | Yes (sys covers citation; archive not named in sys) | Yes | 19 / 19 each | Same positive as above | **keep** short form; do not drop. Archive is **not** in system prompt — tool text is sole channel |
| `do not Grep/Glob/Read /sessions/ as a local file` | `SESSION_REFERENCE_STEER_SUFFIX` (clipboard) | #1373 | N/A (is the cold-paste channel) | N/A | 30 / 29 | Positive-only loses competing-tool names | **keep** — not MCP schema tax; fires when user pastes |

**Friction:** positive-only ("it's a hub UUID") describes the right object; it does **not** name the wrong tool. Models mid-habit toward Grep benefit from the named prohibition. Kill criterion if someone insists on cutting: dogfood N citation pastes on Cursor with positive-only inspect description; any Grep/Glob/Read on `/sessions/` → restore negative.

### 3.2 Never invent peer titles / UUID identity

| Clause | Where | Origin | Sys? | Cursor gap? | Now | Proposed | Verdict |
|---|---|---|---|---|---|---|---|
| `PEER_IDENTITY_UUID_RULE` (full) | Appended into `spawn_peer` + `ping_peer` | #1922 / heavygee#175 — inventing `upstream` / orchestrator nicknames after parent rename | **No** as a named block (sys does not restate invent/rename) | Yes | 54 / 53 ×2 embeds | #2326 already: 38 / 36. Further positive-only: `Peer identity is /sessions/<uuid> from handoff or inspect_peer / search_peers; titles may change` (29 / 28) | **Adopt #2326 on fork/soup first.** Further drop of "Never invent…" → **unsure** — invent-title was the observed failure; positive "UUID is identity" may be enough *after* #2326 lands and is dogfooded |
| `Never invent peer titles; always use the /sessions/<uuid>…` | Tail of `INSPECT_PEER` | Same | No | Yes | ~18 | Fold into shared shortened IDENTITY or drop if PREFIX + citation extract cover it | **cut** from inspect once PREFIX + #2326 IDENTITY exist on the same surface — inspect already forces UUID via param |
| `Do not pass invented titles or nicknames - UUID only` | `SESSION_ID_PREFIX_PARAM_DESCRIPTION` (soup) | Same + soup durable id `48ce6f2ae` / #1203 | No | Yes | part of 82 / 79 string | #2326: `UUID only - no invented titles` (kept a short negative). Positive-only drops "invented" | **keep short negative** in param describe — this is arg-shaping for the tool already selected; cheap and load-bearing. **Do not cut soup `agentSessionId survives hub-row churn`** (absent upstream; still open as #2251) |

**What #2326 missed under this lens:** it shortened scaffolding but left the contrastive core (`Never invent` / `no invented titles`). That was correct conservatism, not a miss of dead weight. The real remaining fat on **fork/soup** is that #2326 **has not landed here at all** — driver still pays 54×2 + 82×3. Landing #2326 (or the soup-aware PREFIX that keeps agentSessionId) is higher ROI than another contrastive rewrite.

### 3.3 Competing API / shell paths (wrong tool, right intent)

| Clause | Where | Origin | Sys? | Cursor gap? | Now | Proposed | Verdict |
|---|---|---|---|---|---|---|---|
| `Do not call POST /api/machines/.../spawn with a message field` | `SPAWN_PEER_TOOL_DESCRIPTION` | #1509 — message stuffed into machine spawn was stripped; later hub 400 | **Yes** (sys spawn paragraph) | Sys miss for Cursor | 34 / 31 | Positive: `Use spawn_peer to create and deliver the remit; machine spawn accepts no message body` (29 / 26) | **keep** (agree with #311). Positive rewrite is fine *if* it still names machine-spawn / no message body. Pure "use spawn_peer" without naming the rejected POST → **unsure** |
| `Prefer this (or hapi …) over JWT+curl` / `never hand-mint a JWT` | Many peer tools; search_content JWT clause | search_content: `d0bcac38e` / #172 — expired hand-minted JWT → empty list indistinguishable from no hits | Prefer-over: mostly untraced product caveat (audit §3). JWT empty-list: **traced** | Partial | JWT block 29 / 29 | search_content: keep failure mode in one short clause; drop "hand-mint" theater if credentials sentence stays | **keep** JWT empty-list scare on `search_content`. Prefer-over JWT+curl elsewhere: **keep** per #311 / audit (shell-escaping), not a contrastive cut |
| `Prefer this over /proc→SQLite archaeology` | `search_peers` description | `57f35e224` / search_peers feature | No | Yes | 11 / 9 | Drop or replace with "keyword inventory beyond list_peers recency" | **cut** — colorful, no distinct incident beyond "agents dug in SQLite"; recency sentence already states the job |
| `Prefer this over shelling hapi ping-peer --list` | `list_peers` | Untraced product | Sys mentions shell fallback the other direction | Soft | ~12 | Drop from tool; sys already teaches both | **cut** from tool description (sys + CLI docs enough); low confidence harm |

### 3.4 Peer contact / wake / delivery (newest unreviewed strings)

These are the post-audit additions the handoff flagged. They are **real scar tissue** (`5a5731f93`, `2a75984b7` / #2197, `5ce30b20c` / #2298) — and they are **brutally duplicated**.

| Clause / block | Where paid | Origin | Sys? | Now | Notes | Verdict |
|---|---|---|---|---|---|---|
| `PEER_CONTACT_RULE` (incl. Never broadcast… / Do not wake… FYI) | `ping_peer` desc + `list_peers` desc + **system prompt** | `5a5731f93` — woke finished peers; broadcast exclusive-work to whole namespace | Yes | 121 / 120 × (2 tools + sys) | Cursor: tools only | **keep content; dedupe placement.** Proposal: keep full rule in **system prompt** (Claude/Codex/OpenCode) + **one** shared short tool blurb for Cursor; stop appending the full 121-token block into both ping and list descriptions. Exact Cursor channel (tool vs grow notify overlay) needs a product call → placement **unsure**, content **keep** |
| `PEER_WAKE_PARAM_DESCRIPTION` `never for FYI…` | `wake` param `.describe` | Same | Sys restates wake rule | 56 / 56 | Arg-shaping | **cut** FYI litany from param if CONTACT/sys already say it; keep "default false refuses inactive; set true when user asked or handoff requires action" (≈22 tokens) |
| `PEER_DELIVERY_MODE_DESCRIPTION` | **sys + ping_peer description + `deliveryMode` `.describe()`** = **3×** | #2197 / #2298 — wrong delivery / resend / accepted≠consumed | Yes | 228 / 219 ×3 when all fire | Largest contrastive+procedural blob after spawn | **move-to-system-prompt + single param describe** for Claude/Codex/OpenCode: drop the full block from `PING_PEER_TOOL_DESCRIPTION` (keep `Select deliveryMode` → param). For Cursor: keep **param describe** (selection+args); drop duplicate from tool description prose. **Keep** "do not resend automatically" / "accepted does not confirm consumption" somewhere once — those are traced. Cutting all negatives → **unsure** |
| Flavor list in steer ("Claude, Pi, Codex…") | Inside DELIVERY | Feature matrix | Yes | ~20 of the 228 | Becomes stale every flavor add | **keep** until a code-enforced capability bit replaces prose (out of scope) |

### 3.5 permissionMode / spawn parent clone

| Clause | Origin | Sys? | Verdict |
|---|---|---|---|
| omit = yolo; `do not clone the parent session's mode` | `44dcd3c98` / #311 kept | No | **keep** — #311 already judged; positive rewrite that drops "do not clone" is **unsure** (clone-parent was the bug) |

### 3.6 display_* "not an image-reading tool"

| Clause | Where | Origin | Sys? | Now | Proposed | Verdict |
|---|---|---|---|---|---|---|
| `It is not an image-reading… cannot be used to read, inspect, or analyze` | `DISPLAY_IMAGE_PROMPT_*` inlined into tool description **and** Claude/Codex/OpenCode system prompts | #1568 `75d7ed1fc` — models used display_image as vision | Yes (non-Cursor) | 53 / 51 in prompt; path `.describe` adds 30 | Positive: `Sends image to the human for inline display; model does not receive pixels` (20) | **keep a short negative or "model does not receive pixels"** — confusion was real. **Also:** audit proposal #1 (flavor-correct tool names) still open / partially addressed by #2164 lineage — wrong-name Cursor prompt glued onto every flavor is still a tax. Not re-litigated here beyond noting display contrastive text is **duplicated sys+tool for Claude** → drop from tool description on Claude if sys keeps it; **keep on Cursor tool** (no duplicate sys for the reading-semantics beyond the tool string itself — wait, Cursor gets the string *only* via tool description today, and `DISPLAY_IMAGE_PROMPT_CURSOR` is what gets appended). So for Cursor: **keep**. For Claude: tool append of Cursor-named prompt is the #2164 bug class — fix flavor branch, then Claude can rely on sys prompt and slim tool description to one line |
| OpenCode `do not display those again` / `Do not guess other names` | `DISPLAY_TOOLS_PROMPT_HAPI_MCP` | #2307 `b9880693a` | OpenCode sys only | 29+6 | Keep short | **keep** — Code Mode naming footgun is real |

### 3.7 Title rename "Do not rename for routine progress"

| Clause | Where | Origin | Verdict |
|---|---|---|---|
| `Do not rename…` | **System prompt only** (Claude/Codex/OpenCode); `change_title` **tool** description is already positive ("Call once when… concise task title") | `ec1ab23e6` | **This is the good pattern.** Tool stays positive; negative lives pre-selection. **Do not add** the negative into the tool schema. No cut needed in MCP. |

### 3.8 session_job (soup)

| Clause | Origin | Sys? | Verdict |
|---|---|---|---|
| `CRITICAL: do NOT use action=set — it is refused` + action enum `set=REFUSED` | `372004d27` / wardrobe freeze — MCP set + idle agent | No dedicated sys block | **keep** named refusal — positive "use Shell hapi job run" alone did not stop set; hard refuse + CRITICAL was the fix. #311 already hoisted null-clear once |
| `Never invent a percent or ETA` | `3404fcf4a` / sleep-stub / remaining=0 traps | No | **keep** short — inventing progress was observed |
| `Not for todos, thinking, or short tool calls` | Same steer family | No | **keep** or merge into one "outliving work only" phrase |

### 3.9 Mild / stylistic (not scar)

| Clause | Verdict |
|---|---|
| set_voice_mode `not inherited by spawned…` / `rather than mid-turn` | Style; low tokens; **keep** or mild trim — untraced as incident |
| archive `Archive only — never hard-deletes` | #2020 product guarantee; **keep** short positive "soft-archive only" is enough (**cut** "never hard-deletes" if soft-archive is unambiguous) |
| link_issue / skill_lookup | Essentially positive; **no contrastive cut** |

---

## 4. Concrete before / after proposals (operator-pickable)

### A. Settled — duplication cuts (client-independent; Overseer-endorsed)

Information still reaches the model once. Safe to approve without dogfood:

1. **Stop triple-paying `PEER_DELIVERY_MODE_DESCRIPTION`:** keep on `deliveryMode.describe` + system prompt; delete `Select deliveryMode: ${PEER_DELIVERY_MODE_DESCRIPTION}` from `PING_PEER_TOOL_DESCRIPTION`.  
   - Measured drop from ping description: **~232 anth / ~223 o200k** (includes the "Select deliveryMode: " glue).
2. **Stop double-appending full `PEER_CONTACT_RULE` on `list_peers`:** keep full rule in system prompt + `ping_peer` (Cursor still sees it on the tool that sends messages); list keeps a short "directory, not a recipient list" pointer.  
   - Measured drop from list description: **~121 anth / ~120 o200k**.

**Settled duplication subtotal: ~353 anth tokens** off the expanded catalog (232 + 121).

### A′. Still recommended, adjacent — shared-string shrink (not contrastive policy)

3. **Land #2326 (or soup-aware equivalent) on fork/driver.** Keep soup `agentSessionId survives…` in PREFIX. Measured on current soup strings → #2326-shaped IDENTITY + a PREFIX that retains agentSessionId: **~87 anth** across PREFIX×3 embeds + **~32 anth** across IDENTITY×2 ≈ **~119 anth**. This is length trim of already-kept content, not a content delete.

### B. Hold — content cuts (not bundled with dedup)

These remove or rewrite unique prose. Argue separately; do not treat as settled with A:

4. **Cut** `Prefer this over /proc→SQLite archaeology` from search_peers (~11 tokens) — flourish, not duplication.
5. **Trim** `PEER_WAKE_PARAM_DESCRIPTION` FYI litany (~56 → ~22) once CONTACT/sys carry it — content shortening of a param hint.
6. Positive rewrites that drop competing-tool names (Grep enumeration → "hub UUID only", etc.) — **unsure without dogfood**. Estate anti-contrastive guidance is for humans; machine-facing scar "don'ts" that name the wrong path are load-bearing until proven otherwise.

| Before | After | anth Δ | Risk |
|---|---|---|---|
| POST…spawn with a message — hub rejects | Use spawn_peer to create+deliver; machine spawn body rejects message/prompt/text | −5 | Low if rejected endpoint still named |
| display not image-reading (53) | Sends to human for display; model does not receive image pixels (20) | −33 | Medium — dogfood vision-misuse |
| archive never hard-deletes | Soft-archive only | ~0 | Low |

### C. Keep — scars (do not relitigate)

- Grep/Glob/Read enumeration (#1373)
- Never invent titles / UUID-only (#1922); short invent prohibition survives even after #2326
- spawn POST-message / don't-clone-parent (#1509 / #311)
- session_job set-refused; never invent percent
- JWT empty-list on search_content (silent failure; bitten repeatedly)

### D. Structural fix that beats word-surgery (outside pure prose, but honest)

Grow Cursor (and Pi if needed) a **citation steer overlay** parallel to `buildSessionCitationSteerInstruction`, then Claude-style dedupe of *scar content* (not just duplicates) becomes safer for Cursor users too. Without that, "move scar content to system prompt only" remains a **Cursor footgun**. Duplication cuts in §4.A do **not** need this overlay — the surviving copy is still in the param schema Cursor always loads.

---

## 5. Per-turn saving by client (say the split plainly)

A single "we save ~N tokens" number is true of neither client. Use this instead.

Standing tax baseline from the MCP context-cost audit (anthropic tokenizer, HAPI tools only):

| Client | What is paid every turn today (before any cut) |
|---|---|
| **Cursor** (eager) | Full expanded catalog — ~4.1–4.3k for heaviest install |
| **Claude Code** (Tool Search on, typical) | Name-only stubs — **~141** for HAPI's 14 tools; full schema lands only after ToolSearch for that tool |

### Settled duplication cuts only (§4.A: −353 anth off expanded ping+list text)

| Client | Standing per-turn saving | When the saving actually appears |
|---|---|---|
| **Cursor** | **~353 anth / turn, every turn** | Immediately — full schemas are always resident |
| **Claude Code (Tool Search)** | **~0 on the standing stub tax** (still ~141) | **~353 once** into the conversation when `ping_peer` and `list_peers` have both been ToolSearch-expanded (then stays in history). If a session never expands those tools, Claude saves nothing from these cuts. |
| **Claude Code (eager / Tool Search off)** | **~353 / turn**, same as Cursor | Same as Cursor |

### If A′ (#2326-class on soup) also lands (+~119 anth off PREFIX/IDENTITY embeds)

| Client | Standing per-turn saving (A + A′) |
|---|---|
| **Cursor** | **~472 anth / turn** |
| **Claude Tool Search (standing stub)** | still **~0** until the shrunk tools are expanded; then ~472 off those expanded definitions |
| **Claude eager** | **~472 / turn** |

### Content cuts (§4.B) held

Not included in the Cursor/Claude numbers above. Archaeology + wake trim would add ~40 anth on Cursor every turn / on Claude after expand — argue on prose grounds, not as settled dedup.

### Scale check

Even Cursor's ~353–472 anth duplication win is **~8–11%** of the ~4.3k eager HAPI tax — real, but an order of magnitude smaller than Claude Tool Search's ~96% deferral of the same catalog. Dedup is still worth doing: client-independent, behavior-neutral, and Cursor is the estate's heavy peer-work client.

---

## 6. Friction mode (auto-engaged)

**Steelman the "cut all don'ts" side:** MCP tool use is schema-constrained; wrong POSTs 400; invent-title fails resolve; set is refused. Runtime errors teach. Descriptions should only say what success looks like. System prompts already carry the morality play for Claude.

**Why that steelman fails on this estate:** (1) Cursor never sees the system morality play for citations; (2) empty-list JWT and Grep-on-citation fail *silently* or into a wrong tool loop — not a clean schema 400; (3) Tool Search means Claude often picks Grep *before* ever loading `inspect_peer`'s essay.

**Kill criteria before a big contrastive purge:**
- Cursor citation paste corpus: Grep/Glob/Read rate on `/sessions/` must not rise after cutting tool-level FS negatives.
- Invented peer titles in ping/spawn args must not rise after dropping "Never invent".
- MCP `session_job` `action=set` attempts must not rise after softening CRITICAL.

**Cheapest falsification:** one Cursor peer-stack session + one Claude Tool-Search session; 10 scripted citation pastes each; compare tool-choice histograms before/after a positive-only patch branch.

---

## 7. Files touched by any future implementation (not this peer)

- `shared/src/sessionCitation.ts` — shared strings / sys builder
- `cli/src/claude/utils/startHappyServer.ts` + `cli/src/codex/happyMcpStdioBridge.ts` — registration
- `cli/src/modules/common/displayImagePrompt.ts` — display flavors
- `cli/src/modules/sessionJob/sessionJobMcp.ts` — soup session_job
- Possibly `cli/src/cursor/utils/cursorNotifyRuleOverlay.ts` — if moving steers to Cursor rules

No product edit from this peer. Operator go-ahead required.

---

## 8. Direct answer to the operator

> "do these needlessly wordy contrastive don'ts need to live in the MCP tool if we care about tool usage?"

**Some don't — when they are pure duplication** (same paragraph already in system prompt *and*/or param `.describe()`). DELIVERY×3 and CONTACT on list+ping+sys are the clearest cases. Those cuts save **~353 anth/turn on Cursor**, and **~0 on Claude's standing Tool Search stub** until those tools are expanded.

**Some absolutely do — when they are unique scar content**, especially on Cursor (no citation system prompt), and especially when the failure mode is silent (Grep, empty JWT list) or the competing action is a different always-on tool. A tool description is not "post-decision only" on eager clients; on deferred Claude it *is* late, which is why the system prompt copy exists. The wordy "don't" is often scar tissue aiming at the *wrong* tool. Deleting it because the grammar is negative, without checking client coverage, is how you get the next #1373.

**Operator ask (Overseer recommendation):** approve §4.A duplication cuts; hold §4.B content cuts; keep §4.C scars. Investigation peer stays no-commit until that go-ahead.
