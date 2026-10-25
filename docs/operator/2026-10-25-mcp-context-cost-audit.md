# HAPI MCP context-cost audit

Fork-local. Measurement + findings only — no product change made. Scope: the
MCP tool surface HAPI's own CLI serves at `mcp__hapi__*` (`driver/cli/src/claude/utils/startHappyServer.ts`,
driver checkout, read 2026-10-25). Does not cover Claude Code's own built-in
tools (Bash, Read, Edit, …) or any third-party MCP servers a user might also
have connected — those are not HAPI's to account for.

Requested by the operator via peer handoff: "what context weight does HAPI
impose on the people who install it, every turn, forever."

## TL;DR

- HAPI registers **14–16 MCP tools** depending on how the session is launched.
  Fully expanded (name + description + JSON Schema, the format that actually
  reaches the model), that's **~3,935–4,328 tokens** of standing tax per turn,
  every turn, for the life of the session — before the user types a word.
- One tool, `spawn_peer`, is **751 tokens** on its own — 19% of the whole
  default-install tax, 8.6× the cost of the cheapest tool.
- A large share of that tax (≈61% of the default install, see below) belongs
  to tools whose own description text says "prefer this... (or `hapi
  <cmd>`)" — i.e. tools that already have a CLI shell equivalent. That's the
  single biggest lever, with a real capability caveat (see §4).
- **The eager, pay-every-turn number above is not what Claude Code users
  actually pay today.** Claude Code ships a client-side feature called Tool
  Search (on by default, model-dependent) that defers MCP tool schemas —
  including HAPI's — to name-only stubs and fetches full schemas on demand.
  This session's own system prompt proved it: HAPI's 14 tools arrived as a
  bare comma-separated name list (~141 tokens), not full schemas. See §5 —
  this is the most important finding in this report and changes who the
  ~4k-token number actually hits.
- **That split is not even. Cursor does not do this by default.** A current
  Claude Code session pays ~4% of the eager cost (the deferred stub); a
  Cursor session, on current published behavior, pays the full ~4,328 tokens
  every turn, unconditionally. Any token-reduction work proposed here
  benefits Cursor users far more than it benefits this estate's Claude
  sessions — say that plainly before prioritizing anything off this report.

## 1. Methodology

**Tool enumeration.** Read `driver/cli/src/claude/utils/startHappyServer.ts`
directly (the live daily-driver checkout, which is materially ahead of the
`~/coding/hapi` mirror's copy of the same file — the mirror is missing 6 of
the 16 tools entirely). Cross-checked every `.describe()` string, enum, and
constant against its source file (`shared/src/sessionCitation.ts`,
`shared/src/modes.ts`, `shared/src/schemas.ts`, `cli/src/modules/sessionJob/*`,
`cli/src/modules/common/displayImagePrompt.ts`).

**Schema conversion.** Reconstructed each tool's Zod schema verbatim in a
scratch script and converted it with the *actual* `zod` (v4.6.5) and
`@modelcontextprotocol/sdk` (v1.25.1) packages resolved exactly as
`driver/cli` resolves them — i.e. the real `toJsonSchemaCompat()` /
`zodToJsonSchema()` call the SDK makes when it answers a `tools/list` request,
not a hand-rolled approximation. Verified the output against the SDK's own
`ListToolsRequestSchema` handler source. This means the JSON Schema in this
report is byte-identical to what HAPI's server actually emits.

**What "the tool costs N tokens" means.** Two shapes were measured per tool:

- **wire**: `{name, title, description, inputSchema}` — the literal
  `tools/list` response shape.
- **model-facing**: `{name, description, parameters}` — `title` dropped.
  This is what the Anthropic Messages API `tools` param and the `<function>`
  block format (visible at the top of this very conversation) actually
  carry; `title`/`annotations`/`_meta` are MCP-wire-only furniture most
  clients strip before building the model's tool list. The delta is small
  (title added ~99 tokens across 14 tools, ~2.5%) but model-facing is the
  number that matters and is used throughout this report unless stated.

**Tokenizer.** No Anthropic token-counting endpoint was available to this
session (no API key in the environment), so three independent, real,
published tokenizers were run side by side rather than a chars/4 guess:

| Tokenizer | What it is | Caveat |
|---|---|---|
| `@anthropic-ai/tokenizer` (npm) | Anthropic's own published BPE vocab | Legacy — built for Claude 1/2 era models. Anthropic has not published a tokenizer for Claude 3/4/5. Closest official artifact that exists, not a confirmed match to current Claude models. |
| `gpt-tokenizer` default (o200k_base) | OpenAI's real GPT-4o/GPT-5-family BPE | Different vendor/vocab; used as a modern cross-check, not a Claude stand-in. |
| `tiktoken` `cl100k_base` (Python) | OpenAI's real GPT-4-family BPE | Same caveat as above. |

All three agreed within ~5% of each other on every measurement in this
report (e.g. the 14-tool default install: 3,935 / 3,777 / 3,730). That
agreement is the best available confidence signal given no exact-match
tokenizer for current Claude models is public. Anthropic's number is quoted
as primary throughout; the other two are included in every table as the
cross-check.

## 2. The numbers

### 2.1 Which tools exist, and when

`startHappyServer()` is called from two places with different options, so
real installs differ:

- `cli/src/claude/runClaude.ts` (plain `claude`-flavor launch): no
  `skillLookup`, no Cursor flag → **14 tools**, no `skill_lookup`.
- `cli/src/agent/runners/runAgentSession.ts` (the generic agent runner used
  for peer-spawned sessions and non-Claude flavors, including this one):
  always passes `skillLookup` → **15 tools**; adds `display_links` as a 16th
  only when `agentType === 'cursor'`.

| Install | Tools | Model-facing tokens (anthropic / o200k / cl100k) | % of a 200k window |
|---|---|---|---|
| Bare (4: `change_title` + 3 display tools) | 4 | 610 / 581 / 576 | 0.30% |
| Default (`claude` via `runClaude.ts`) | 14 | **3,935 / 3,777 / 3,730** | 1.97% |
| Typical (+ `skill_lookup`, peer/agent-runner path) | 15 | 4,033 / 3,869 / 3,820 | 2.02% |
| Heaviest (Cursor, + `display_links`) | 16 | 4,328 / 4,153 / 4,103 | 2.16% |

Expressed against windows people actually run on, using the default
14-tool install (3,935 anthropic tokens):

| Context window | % consumed by HAPI's tool definitions, every turn |
|---|---|
| Claude 200k (Sonnet/Opus/Haiku, standard) | **1.97%** |
| Claude 1M (long-context beta) | 0.39% |
| GPT-4o / GPT-4.1 (128k) | 3.07% |
| GPT-5 (272k input) | 1.45% |
| A 32k local/edge model | 12.30% |
| An 8k local/edge model | **49.19%** |

That last row is not a throwaway number — HAPI explicitly supports small
local models for some flavors (`oos-local-llm` territory). On an 8k model,
HAPI's own tool definitions alone eat *half the window* before any
conversation happens.

### 2.2 Per-tool cost, ranked (model-facing, anthropic tokenizer; o200k/cl100k in parens)

| Rank | Tool | Tokens | Description % | Schema % |
|---|---|---|---|---|
| 1 | `spawn_peer` | **751** (723/724) | 46% | 52% (11 fields incl. a 5-field permission enum, a 10-flavor agent enum) |
| 2 | `session_job` | **650** (630/617) | 30% | 68% (10 fields, half nullable-optional) |
| 3 | `ping_peer` | 366 (353/350) | 55% | 42% |
| 4 | `inspect_peer` | 317 (307/304) | 45% | 51% |
| 5 | `archive_peer` | 299 (288/284) | 53% | 43% |
| 6 | `display_links` (Cursor-only) | 295 (284/284) | 45% | 50% |
| 7 | `search_content` | 272 (262/258) | 49% | 46% |
| 8 | `search_peers` | 217 (209/207) | 47% | 47% |
| 9 | `display_image` | 210 (202/202) | — | — |
| 10 | `display_media` | 169 (161/159) | — | — |
| 11 | `list_peers` | 167 (159/158) | — | — |
| 12 | `set_voice_mode` | 158 (146/145) | — | — |
| 13 | `display_video` | 142 (136/135) | — | — |
| 14 | `link_issue` | 127 (119/117) | — | — |
| 15 | `skill_lookup` | 98 (92/91) | — | — |
| 16 | `change_title` | **87** (80/81) | — | — |

`spawn_peer` and `session_job` together are **1,401 of the 3,935**
default-install tokens — 36% of the entire tax from 2 of 14 tools.

## 3. Where the fat actually is

**`spawn_peer` (751 tokens, #1 offender).** Roughly half is an 11-field
schema (directory, message, name, machine, agent-enum-of-10, model, effort,
sessionType-enum, permissionMode-enum-of-13), the other half a dense prose
description covering remit semantics, default permission mode, machine
resolution, and a repeated-verbatim 54-token "never invent peer titles" rule
(see below). Nothing here is obviously deletable without losing real
capability — this is a legitimately complex operation (cross-host spawn with
agent/model/permission overrides) — but it is the clearest candidate for
Tool Search deferral (§5): it's explicitly user-triggered ("spawn a peer"),
never called spontaneously, so deferring it costs nothing in reliability.

**`session_job` (650 tokens, #2 offender).** 68% of its cost is schema: 10
fields (action, jobKey, label, status, done, total, remaining, unit, detail,
expectedRunId, startedAt), several nullable+optional with their own
"pass null to clear" sentences. This is a legitimately wide action-oriented
tool (set/update/clear/list in one schema) — collapsing it into 4 tools
would likely cost *more* total tokens (4× the name+title+wrapper overhead),
so this is not a clear win to split. It is, however, a strong deferral
candidate: it only matters for sessions actually running a long job.

**Duplicated prose across tools (not fixable by trimming one file — it's
copy-pasted into N tool descriptions by construction):**

| Shared text | Token cost (anthropic) | Repeated in | Total paid |
|---|---|---|---|
| `PEER_IDENTITY_UUID_RULE` | 54 | `spawn_peer`, `ping_peer` descriptions (2×) | 108 (54 of which is pure duplication) |
| `SESSION_ID_PREFIX_PARAM_DESCRIPTION` | 82 | `sessionIdPrefix` param in `ping_peer`, `archive_peer`, `inspect_peer` (3×) | 246 (164 of which is pure duplication) |

MCP tool definitions can't `$ref` a shared fragment across *separate* tool
schemas in a way clients are guaranteed to dedupe, so this duplication is
structural, not a bug — but it means **halving either shared string roughly
halves 2–3× its token cost**, not 1×. These two strings are the best
shrink-for-effort target in the whole surface: tightening
`SESSION_ID_PREFIX_PARAM_DESCRIPTION` from ~82 to ~40 tokens would save
~126 tokens total across 3 tools for one edit.

**A real bug, not just waste: `display_image`/`display_video`/`display_media`
descriptions carry the wrong tool name, unconditionally, for every flavor.**
`startHappyServer.ts` builds each of these three tools' `description` by
unconditionally appending the `*_PROMPT_CURSOR` variant of the hint text
(`displayImagePrompt.ts`), regardless of agent flavor:

```ts
description: `Display a local image file to the human user inline in the
current HAPI chat session. ${DISPLAY_IMAGE_PROMPT_CURSOR}`,
```

`DISPLAY_IMAGE_PROMPT_CURSOR` reads: *"...call the tool `display_image`..."*
— the bare name, correct for Cursor's own tool namespacing, **wrong for
Claude Code**, where the callable name is `mcp__hapi__display_image`. Worse:
for the Claude flavor, the *correct* instruction
(`DISPLAY_IMAGE_PROMPT_CLAUDE`, using the right `mcp__hapi__` name) is
*also* injected separately into the Claude system prompt
(`cli/src/claude/utils/systemPrompt.ts:13-15`). So on every Claude-flavor
turn, near-identical content (~91 anthropic tokens for the image variant
alone, ×3 for video/media ≈ 170 combined) is paid for **twice** — once
correctly in the system prompt, once with the wrong tool name inside the
tool's own description. This looks like `*_PROMPT_CURSOR` was reused as a
"generic enough" default when the per-tool descriptions were written,
without branching on flavor the way `enableDisplayLinks` already does for
`display_links`. Fix is mechanical: branch `display_image`/`display_video`/
`display_media`'s description on flavor the same way `display_links` is
gated, picking the `_CLAUDE`/`_CODEX`/`_HAPI_MCP`/`_CURSOR` variant to match
— saves the duplicated tokens for every non-Cursor flavor and removes an
actively wrong tool-name instruction.

**Duplicate CLI/MCP surfaces — the largest lever, with a real caveat.**
Every peer-management tool's own description names a CLI shell equivalent:

| MCP tool | Tokens | CLI equivalent named in its own description |
|---|---|---|
| `spawn_peer` | 751 | `hapi spawn-peer` |
| `ping_peer` | 366 | `hapi ping-peer` |
| `search_content` | 272 | `hapi search-content` |
| `inspect_peer` | 317 | `hapi inspect-peer` |
| `archive_peer` | 299 | `hapi archive-peer` |
| `list_peers` | 167 | `hapi ping-peer --list` |
| `search_peers` | — (no CLI named in description, but `hapi search-peers` exists) | `hapi search-peers` |

Sum: **2,389 of the default install's 3,935 tokens (61%)** belong to tools
with a documented CLI fallback, for an agent that already has Shell/Bash
access (true of every flavor HAPI runs — Claude Code, Codex, Cursor-as-agent
all ship with shell tools). In principle, an agent with Bash could do
everything these 7 tools do by shelling out, paying ~0 standing context
cost (the CLI command text only appears in the transcript the turn it's
actually run).

**This is not a free win, and the descriptions themselves explain why**: they
each say "prefer this **or** `hapi <cmd>`" — not "prefer the CLI over this."
The MCP form exists because (a) it gives structured, validated args instead
of shell-quoting a `message` string that may contain quotes/newlines/unicode
— models get shell-escaping wrong at a real, nonzero rate — and (b) HAPI
explicitly also serves the Cursor flavor, and this audit could not confirm
Cursor's CLI-equivalent story is identical to Claude Code's. Cutting these
to CLI-only would trade a measured, constant token tax for an unmeasured
shell-injection/escaping failure rate — a product decision, not a drive-by
deletion. Flagging it as the biggest lever by number, with the honest
caveat attached, per the operator's brief.

**Nothing found that looked like simple dead weight**: no deprecated-but-
still-advertised tool, no obviously-copy-pasted example blocks inside a
description, no enum that should obviously be free text. `session_job`'s
`action` enum and `spawn_peer`'s `agent`/`permissionMode` enums are all
small, real, validated value sets — narrowing them to free text would move
validation failures from schema-reject-time to runtime, not save meaningful
tokens (enums in JSON Schema are cheap; `"enum":["a","b","c"]` costs barely
more than the string `"a free-text hint describing the same choices"` would).

## 4. Concrete, estimated-savings proposals

1. **Fix the `display_image`/`display_video`/`display_media` flavor bug**
   (§3). Branch the description on flavor like `display_links` already does.
   Estimated saving: ~91 tokens/turn (anthropic) for Claude-flavor sessions
   specifically (the `_CURSOR` variant is the longest of the three per-flavor
   variants); smaller for Codex/other flavors. Low risk — this is a
   correctness fix (wrong tool name) that happens to also save tokens.
2. **Shrink `SESSION_ID_PREFIX_PARAM_DESCRIPTION`** (currently 82 tokens,
   repeated in 3 tools = 246 tokens paid). A ~40-token version covering "full
   UUID preferred, from a `/sessions/<id>` citation; no invented titles"
   would save ~126 tokens/turn across the 3 tools for a single string edit.
   Needs a pass to confirm no agent behavior currently depends on the
   trimmed clauses (the `agentSessionId` hub-row-churn explanation in
   particular looks load-bearing for a real failure mode — verify before
   cutting, not just trim by feel).
3. **Mark low-risk, frequently-and-proactively-needed tools `alwaysLoad`,
   leave the rest deferred** (§5) — not a text cut, a metadata addition
   (`_meta: {"anthropic/alwaysLoad": true}` on the tool registration). Good
   candidates: `change_title` (87 tokens, called once early, cheap to keep
   resident), `display_image`/`display_video`/`display_media` (the model
   must *spontaneously remember* these exist with no user prompt — deferral
   risk is real for these in particular, see §5 caution). Bad candidates for
   `alwaysLoad`: `spawn_peer`, `archive_peer`, `session_job`,
   `search_content`, `search_peers` — all explicitly user/citation-triggered,
   so the trigger text itself primes the model to go looking for the right
   tool via Tool Search. This doesn't reduce HAPI's *advertised* schema size,
   but it directly controls what Claude Code actually keeps resident once
   Tool Search engages, and costs nothing to ship since the SDK already
   plumbs `_meta` through untouched today. No tokens "saved" in the eager
   number, but this is the single highest-leverage, lowest-regret change
   available given §5.
4. **(Needs a product decision, not a code change) CLI-only for the 7
   peer-management tools.** Biggest number (2,389 tokens, 61% of the default
   install) but carries the shell-escaping/Cursor-parity caveat above. Not
   recommending it outright — flagging it as the thing worth a real decision
   given the size of the number.

Not recommending: splitting `session_job`'s action-oriented schema into 4
tools (adds overhead, doesn't remove it), converting any enum to free text
(enums are already cheap), trimming `spawn_peer`'s description further
without a capability review (it's dense but every clause maps to a
documented failure mode from the file's own comments — e.g. the "Do not call
POST /api/machines/.../spawn..." sentence exists because agents were
observed doing exactly that).

## 5. Looking outward: does the ecosystem already solve this?

**What the MCP spec itself supports:** cursor-based pagination of
`tools/list` only (`modelcontextprotocol.io/specification/2025-06-18`) — a
server with a huge catalog can split it across pages. That's it. There is no
spec-level mechanism for a client to receive partial/stub tool definitions
and fetch full schemas later; pagination still delivers full schema per
page, just across multiple round trips. **The spec does not solve this
problem.**

**What at least one real client does, verified by direct observation in this
session, not just documentation:** Claude Code ships a client-side feature
called **Tool Search**, on by default for current-generation models
(Opus 4.5 / Sonnet 4.5 / Haiku 4.5 and later; off for older models or when
`ENABLE_TOOL_SEARCH=false`). When a session's total tool-definition payload
exceeds an auto-threshold (default **~10% of the active context window**),
most tools are deferred: the model's context gets **name only**, plus a
single `ToolSearch` meta-tool it can call to fetch full schemas for
specific names on demand. This conversation's own system prompt is live
proof: all 14 of HAPI's MCP tools (plus a long list of Claude Code's own
built-ins) arrived as a bare comma-separated name list —
`mcp__hapi__archive_peer, mcp__hapi__change_title, ...mcp__hapi__spawn_peer`
— not full schemas, and this report's author had to call `ToolSearch` before
any of them became callable.

Measured: that stub list for HAPI's 14 tools is **141 anthropic tokens**
(128 o200k / 128 cl100k) versus **3,935** fully expanded — a **96.4%**
reduction, in the same ballpark as the ~85–98.7% figures reported publicly
for this feature on other workloads. Once fetched via `ToolSearch` in this
session, a tool's full schema stayed resident for the rest of the
conversation (observed directly: `WebSearch`/`WebFetch`, fetched once above,
needed no re-fetch for a second call) — the marginal cost looks like a
one-time `ToolSearch` round trip per tool actually used, not a per-turn
re-payment, though this report did not run a long enough session to rule out
re-deferral after extended idle/compaction.

**Important qualifications, each verified rather than assumed:**

- **This is Claude Code's own client-side policy, not an MCP protocol
  feature.** The MCP server (HAPI's CLI) still answers `tools/list` with
  full eager schemas exactly as measured in §2 — it has no say over whether
  the client defers them. HAPI benefits from Tool Search only insofar as the
  *client* its users happen to be running implements it.
- **Server/tool-level opt-out exists and HAPI doesn't use it.** A tool can
  be exempted from deferral via `_meta: {"anthropic/alwaysLoad": true}` on
  that tool's registration (or `alwaysLoad` at the server level in
  `.mcp.json`, which is user/client config, not something HAPI ships).
  HAPI's `registerTool()` calls never set `_meta` today — every HAPI tool is
  deferred-by-default once the session's total tool payload crosses
  Claude Code's threshold, with no per-tool tuning. See proposal 3 above.
- **The threshold is global across the whole session's tool corpus, not
  per-MCP-server.** Whether HAPI's tools actually get deferred for a given
  user depends on how many *other* tools (built-ins + other MCP servers)
  that user has connected, not on HAPI alone. A user with few other tools
  connected may never cross the ~10%-of-window threshold and will pay
  HAPI's full eager cost every turn regardless of this feature existing.
- **Cursor does not appear to do this by default.** Per Cursor's own
  published behavior, every connected MCP server's tool definitions "consume
  tokens on each request before any tool is called" — Cursor's documented
  mitigation is a hard **40-tool cap across all connected servers** (past
  which tools silently stop being available, a worse failure mode than a
  token tax) plus an opt-in "Dynamic Tools" pattern that a *user* must
  configure, not something a server like HAPI can trigger unilaterally.
  HAPI's Cursor-flavor install (16 tools) sits comfortably under that cap,
  but a Cursor user pays the full ~4,328-token measured cost every turn
  unless they've personally opted into dynamic tool discovery. This was
  not verified against Cursor's current shipped behavior directly (no
  Cursor instance available to this session) — stated at the confidence
  level the published documentation supports, flagged for operator
  verification if it becomes decision-relevant.
- **No evidence found of standard behavior for other clients** (Claude
  Desktop, generic MCP clients). Treat "most clients still eagerly inline
  everything" as the honest default assumption for any client not
  specifically confirmed otherwise above.

**Bottom line for this axis:** HAPI cannot make other clients defer its
tools, but it can (a) stop leaving a free, zero-cost lever on the table —
set `_meta` `alwaysLoad` hints per tool so that *when* a client does defer,
the right tools stay resident — and (b) keep the eager-cost numbers in this
report as the true worst-case, since that's what a meaningful fraction of
real installs (older-model Claude Code sessions, Cursor without dynamic
tools, any client that hasn't shipped this pattern) are actually paying,
every turn, forever, exactly as the operator suspected before asking for
numbers.

**Say plainly who any of this work is actually for.** Today's Claude Code
sessions on current models — which is most of this estate's own traffic —
already pay roughly 4% of the eager number, because the client did the work
unilaterally. Cursor sessions pay the full number, unconditionally, with no
mitigation available short of the user manually opting into dynamic tool
discovery. A token-shrinking change proposed off this report (trimming
descriptions, splitting schemas, cutting the CLI-duplicate tools) overwhelmingly
benefits Cursor users and any client that hasn't shipped tool deferral —
not this estate's own day-to-day Claude sessions, which have already had the
problem solved out from under them by the client. That should shape
prioritization, not just be a footnote.

## Appendix: raw data

Full per-tool JSON (wire + model-facing, all three tokenizers) and the
scratch scripts that produced every number in this report (built against the
*real* `zod`/`@modelcontextprotocol/sdk` resolved from `driver/cli`'s own
`node_modules`, not a hand-rolled approximation) are on this machine at
`/tmp/mcp-audit/` (`build-tools-v4.cjs`, `measure.cjs`, `breakdown.cjs`) —
not copied into the repo since they're throwaway measurement scaffolding,
not product code. Re-run `node /tmp/mcp-audit/measure.cjs` to reproduce.
