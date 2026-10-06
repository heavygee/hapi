# Trace graph + fleet file-contention — first slice

> **Status:** design / first slice. Operator-fork idea note, **not** upstream canon.
> **Date:** 2026-07-16
> **Inspired by:** [Agent Flow](https://github.com/patoles/agent-flow) by Simon Patole (Apache-2.0).
> **Relationship to source:** clean-room reimplementation of *ideas/UX only*. No code copied, **no fork**. See "Attribution & naming" below before writing any code.

---

## Attribution & naming (read first — legal/courtesy constraints)

Agent Flow is **Apache-2.0**, but the name **"Agent Flow"** and its logos are **trademarked** by Simon Patole (`TRADEMARK.md` in the source repo). Consequences for us:

- **We are not forking and not copying code.** We reimplement the *concepts* (execution graph, timeline, file-attention heatmap) against HAPI's own data model. Ideas aren't copyrightable; a clean reimpl carries no Apache obligations, but we credit anyway as a courtesy.
- **Do not name our feature "Agent Flow"** or anything confusingly similar, and **do not use their logo.** Nominative credit ("inspired by Agent Flow by Simon Patole") is explicitly permitted by their trademark policy and is the *only* thing we take.
- **Where the credit goes:** a one-line inspiration note in the feature's doc + the PR description. Not in root `AGENTS.md` (upstream-verbatim), not in the product UI unless the operator wants a small "inspired by" in an about/credits surface.
- **Our names (proposed):** per-session view = **"Trace graph"** (extends the existing `TraceSection` / `tracer.ts` vocabulary — no new brand). Fleet signal = **"file contention"** event. Both neutral, both already-native HAPI words.

Why this is the right posture and not a fork: **HAPI already owns the event capture.** Agent Flow's whole engine is *tailing* Claude hooks + Codex `rollout-*.jsonl` because it's a bystander to the agent. HAPI's CLI **is** the wrapper and already emits the authoritative stream into the hub (`cli/` → Socket.IO → hub → SSE → web). We need Agent Flow's *views*, not its plumbing — and the views are ~200 lines of rendering over data we already normalize in `web/src/chat/`.

---

## Upstream vs fork — what goes where (confirmed classification)

The operator goal is to move "flow" (execution-flow observability) into the product across all three modes. Only the **session** mode is exposable to regular users pre-Overseer; that is also the piece that belongs **upstream**. The rest are fork.

> **On the word "flow":** *"flow"* is a generic English word and safe to use freely in our own multi-word names (e.g. "trace flow", "session flow"). The trademark is the exact two-word mark **"Agent Flow"** + its logo — those we never reuse. Nominative credit ("inspired by Agent Flow by Simon Patole") is permitted anywhere, including an upstream PR *description*; it just must not be the fork's plan doc (which never enters an upstream diff).

| Piece | Mode | Upstream or fork | Branch base | Rationale |
|---|---|---|---|---|
| **File-touch extractor** (`collectFileTouches`, tool-input path picker lifted to `shared/`) | substrate for all 3 | **Upstream** | `upstream/main` | Mode-agnostic, no fork deps. Build once → session renders it, Overseer aggregates it, XR draws it. This is the single lever that gives "movement on all three areas." |
| **Trace graph + file-attention panels** | Session | **Upstream** | `upstream/main` | General-purpose session observability; useful to every `tiann/hapi` user; `web/` only; derives from data the CLI already emits. The one mode regular users see now. |
| **`file_contention` cross-session event** | Overseer | **Fork** | `main` | Depends on the Overseer `events`/`event_links` substrate, which is explicitly fork vision (not upstream canon). Detection *input* is the upstream shared extractor; *emission + inbox promotion* is fork. Lives with `feat/overseer-*`. |
| **Orb file-overlap cross-links + trace-graph-on-focus payload** | XR | **Fork** | `main` (garden branches) | The XR garden is explicitly operator-fork vision (`garden/r3f-poc`, `feat/garden-route`). Consumes the same hub API + shared extractor; rendering is fork. |
| **Hub "focus contract"** (`focusedSessionId` broadcast) *(optional, later)* | XR/session | **Possibly upstream** | `upstream/main` | A generic capability upstream *might* want; separable from the garden. Speculative — do not build until a mode needs it. |
| **This plan doc + attribution note** | — | **Fork** | `main` | `docs/plans/` never enters an upstream PR diff (leak scanner enforces). |

### How each slice gets movement on all three areas

The first push is not "session only, defer the rest." It builds the **shared substrate mode-agnostic**, which is simultaneous movement on all three:

- **Track A — shared** (`shared/`): the file-touch model. Upstream. *Feeds S, O, X.*
- **Track S — session** (`web/`): renders Track A + trace graph. Upstream. **Shippable to regular users now.**
- **Track O — Overseer** (`hub/`): aggregates Track A cross-session → `file_contention`. Fork. Gated on the events substrate (branches exist and are in flight).
- **Track X — XR** (`web/` garden): renders Track A overlap as orb cross-links + trace-graph on gaze-focus. Fork. On the garden branches.

Build Track A once, upstream-clean; S ships on it; O and X are thin adapters over the same substrate as their gates open. That is the discipline that keeps "I want them all" from becoming three divergent implementations of the same idea.

## Two slices

| Slice | Tier | Surface | Reuses | New |
|---|---|---|---|---|
| **1. Trace graph** | per-session (general users) | `web/` session view | `tracer.ts`, `trace.tsx`, `subagentTool.ts`, `ChatBlock` tree | one pure derive module + one canvas component |
| **2. File contention** | fleet (Overseer) | hub events table | Overseer `events`/`event_links` schema (contracts §1) | one `event_type`, one derivation pass |

Slice 1 is the **2D falsification** the XR-garden vision doc already asks for — prove the graph/heatmap is useful on desktop before anyone embodies it as an orb. Slice 2 turns the per-session file-attention idea into the cross-session collision signal this repo actually bleeds from (soup/stack contention).

---

## Slice 1 — Trace graph (per-session)

### Goal

Give a session an optional **graph + file-attention** view alongside the existing linear chat. Three panels, in priority order of value-for-effort:

1. **File-attention list** (cheapest, highest signal) — which files this session read/edited, ranked by touch count. "This session has been thrashing `sessionCache.ts` for 20 turns" without reading every card.
2. **Execution graph** — nodes = agent turns / tool-calls / subagents; edges = parent→child (sidechain) + sequential flow. Branch/return visible at a glance.
3. **Timeline** — horizontal lane per (sub)agent, tool-calls as spans by `createdAt`/`durationMs`. (Optional, ship last.)

### Data — all already present

Everything derives from the `ChatBlock[]` tree that `tracer.ts` + the reducer already build. No new capture, no hub change.

- Subagent tree: `isSubagentToolName()` + `ToolCallBlock.children` (already nested by the reducer).
- Timing: `ToolCallBlock.createdAt`, `.durationMs`, `ChatToolCall.startedAt/completedAt`.
- Tokens: `UsageData` on blocks + the `totalTokens/totalDurationMs/totalToolUseCount` summary `trace.tsx` already reads.
- **File paths:** extract from `tool.input` for path-bearing tools. HAPI **already** solves the field-name variation with `getInputStringAny(input, ['file_path','path','filePath','file'])` (`web/src/components/ToolCard/knownTools.tsx:562`, also used by `WriteView`, `_results.tsx`). Reuse that helper — don't invent a new mapping. We only need to classify each path-bearing tool as read vs write:

```ts
// web/src/chat/fileAttention.ts  (new, pure, unit-tested)
import type { ChatBlock, ToolCallBlock } from '@/chat/types'
import { getInputStringAny } from '@/components/ToolCard/knownTools' // existing helper

const PATH_KEYS = ['file_path', 'path', 'filePath', 'file'] as const
const NOTEBOOK_KEYS = ['notebook_path'] as const
const WRITE_TOOLS = new Set(['Edit', 'Write', 'StrReplace', 'MultiEdit', 'NotebookEdit'])
const READ_TOOLS = new Set(['Read', 'NotebookRead'])

export type FileTouch = { path: string; reads: number; writes: number; total: number }

export function collectFileTouches(blocks: ChatBlock[]): FileTouch[] {
    const acc = new Map<string, FileTouch>()
    const walk = (bs: ChatBlock[]) => {
        for (const b of bs) {
            if (b.kind !== 'tool-call') continue
            const tc = b as ToolCallBlock
            const isWrite = WRITE_TOOLS.has(tc.tool.name)
            const isRead = READ_TOOLS.has(tc.tool.name)
            if (isWrite || isRead) {
                const keys = tc.tool.name.startsWith('Notebook') ? NOTEBOOK_KEYS : PATH_KEYS
                const path = getInputStringAny(tc.tool.input, [...keys])
                if (path) {
                    const cur = acc.get(path) ?? { path, reads: 0, writes: 0, total: 0 }
                    if (isWrite) cur.writes++; else cur.reads++
                    cur.total++
                    acc.set(path, cur)
                }
            }
            if (tc.children.length) walk(tc.children) // subagent file touches count too
        }
    }
    walk(blocks)
    return [...acc.values()].sort((a, b) => b.total - a.total)
}
```

> Note: `getInputStringAny` currently lives in `knownTools.tsx` (a `.tsx`). For the shared extractor (slice 2), lift the pure string-picker into a plain `.ts` (e.g. `shared/src/toolInput.ts`) so hub can import it without pulling React.

Graph nodes derive similarly from the same tree — a second pure function `buildTraceGraph(blocks): { nodes, edges }` where a node is `{ id, kind: 'turn'|'tool'|'subagent', label, state, tokens?, durationMs? }` and edges come from `ToolCallBlock.children` (subagent fan-out) plus sequential ordering within a lane.

### UI shape

- **Entry point:** a segmented toggle on the session view header — `Chat | Graph` (and later `| Timeline`). Reuse the existing `TraceSection` open/close idiom; this is the same content, spatial instead of nested-list.
- **Rendering:** the file-attention list is plain React (bars = `total`, split read/write). The graph needs a lightweight canvas. **Do not add a heavy dep for slice 1** — start with an SVG/DOM layout (dagre-style layered layout is ~1 small dep, or hand-roll a column-per-depth layout since the subagent tree is shallow). Only reach for React Flow / r3f if slice 1 proves out. The XR garden already owns the 3D story (`garden/r3f-poc` branch); keep the desktop graph 2D and cheap.
- **i18n:** all strings via `web/src/lib/locales/en.ts` + `use-translation` (existing pattern), keys under `tool.trace.graph.*` / `tool.trace.files.*`.

### Non-goals for slice 1

- No replay scrubber (slice 1 renders current session state; replay is a later slice — HAPI already persists messages, so it's tractable but out of scope now).
- No new event capture. If a value is not already in `ChatBlock`, it's out of scope.
- No cross-session anything (that's slice 2).

### Tests

- `fileAttention.test.ts` — read vs write counting, subagent recursion, unknown tools ignored, path-key variants.
- `buildTraceGraph` — subagent fan-out produces child edges; sequential edges within a lane; orphan handling matches `tracer.ts` behavior.
- No web render tests (repo has none); logic lives in pure modules by design.

---

## Slice 2 — Fleet file-contention signal (Overseer)

### Goal

Agent Flow's file-attention heatmap is per-session. The signal this repo actually needs is **cross-session**: "three agents are all writing `syncEngine.ts`" — a collision risk that maps directly onto the soup/stack-contention pain (`driver-soup.md`, worktree discipline). Promote per-session file attention to a **fleet edict candidate** for the Overseer.

### Where it slots (Overseer contracts §1 taxonomy)

New `event_type = 'file_contention'` in the `events` table (schema already defined, `2026-06-03-overseer-contracts.md`). Field values:

- `attention_candidate = 1` — it's an inbox candidate (unlike raw `tool_call` which is `0`/captured-only).
- `operator_action_required = 1`, `risk_detected = 1`.
- `source_kind = 'system'` (derived by the hub, not claimed by a worker).
- `sink_kind = 'fleet'`.
- `summary`: `"3 sessions writing shared file: hub/src/sync/syncEngine.ts"`.
- `artifact_refs`: one `{ kind: 'file_path', ref: '<path>' }` plus one `{ kind: 'session_id', ref: '<id>' }` per contending session — so the Overseer can carry the operator straight to each session (the "handles enable action, not narration" rule).
- `dedupe_key`: `file_contention:<normalized_path>` — so re-detection updates rather than spams.
- `event_links`: a `blocks`/`duplicates`-style edge is overkill here; instead link the contributing per-session activity via `related_session_id` on the artifact refs. (If we later want root-cause synthesis — "all three blocked on the same rebase" — that's `event_links`, out of scope now.)

### Derivation (hub-side, cheap)

The hub already has every session's messages (`messages` table, 72k+ rows) and the `sessionCache`. A periodic pass (or piggyback on message ingest) maintains a rolling **write-set per active session** over a recent window (e.g. last N minutes of `Edit/Write/StrReplace/...` tool inputs — same `FILE_PATH_KEYS` map as slice 1, so **share the extractor**: lift `collectFileTouches` into `shared/` so hub + web both consume it). When ≥2 active sessions' *write*-sets intersect on a non-trivial path (exclude lockfiles, `dist/`, generated), emit/update a `file_contention` event.

Guardrails so it stays a chief-of-staff signal, not a narrating log file:

- **Writes only** (or write-vs-write / write-vs-read). Two sessions *reading* the same file is not contention.
- **Debounce + dedupe_key** so it fires once per contended path, updates severity as more sessions pile on, and auto-`expires_at` when the overlap clears.
- **Path allowlist/denylist** — ignore `bun.lock`, `web/dist/**`, `*.bak.*`, generated files (this repo has plenty; contention on those is noise).
- Respect the same worktree layout truth the repo already tracks — two sessions writing "the same relative path in different worktrees" is *not* contention (different files on disk). Key on absolute path.

### Why this is the right Overseer citizen

- It's exactly the `attention_candidate=1` case the taxonomy reserves for blockers/anomalies, distinct from the `attention_candidate=0` mechanical `tool_call` stream that Agent Flow-style drill-down consumes.
- It's *pull-safe*: even if prioritization buries it, `artifact_refs` make "why didn't you tell me X" answerable with the exact files+sessions.
- It generalizes cleanly to the XR garden's "thin lines between orbs that share files" cross-link idea (`2026-05-25-garden-mindmap-agent-layout-idea.md`) — same signal, spatial rendering.

### Non-goals for slice 2

- No auto-resolution, no auto-pausing sessions. Detect + surface only. Any dispatch goes through the normal one-boss confirmed edict path.
- No `event_links` root-cause graph yet.
- Ships **after** the Overseer `events` table exists (build-sequence Step 2/2.5). Until then, slice 2 is a spec; slice 1 is independently shippable today.

---

## Build discipline (this repo)

- **Slice 1 touches `web/` = HAPI product code** → must be done in a worktree (`hapi-worktree-create trace-graph --branch feat/trace-graph`), off `main` (operator-fork feature, not obviously upstream-bound — decide at PR time). File an issue first (`gh issue list -R heavygee/hapi`).
- **Slice 2 touches `hub/` + `shared/`** → same worktree discipline; gated on the Overseer events table landing.
- **Shared extractor:** put `collectFileTouches` / `FILE_PATH_KEYS` in `shared/src/` so web + hub agree on what "a file touch" is (single source of truth).
- **No driver-soup shortcuts** — normal lifecycle (`feature-work-lifecycle.md`), dogfood on `:3006` via manifest layer after operator approves, `bun typecheck && bun run test` before push.
- **PR-diff hygiene:** this plan doc + the inspiration credit stay operator-fork-only; never in an upstream PR diff.

## Kill criteria

- Slice 1: if the **file-attention list alone** (panel 1) delivers the value, skip the graph canvas — don't build the heavy view nobody scrubs.
- Slice 2: if `file_contention` fires mostly false positives after the denylist tuning, it's noise; cut it rather than let the Overseer cry wolf.
- Overall: if the desktop 2D graph doesn't earn its toggle, the XR garden orb-drill-down premise is unproven — good to learn cheaply before headset work.
