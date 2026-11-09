# Slim big MCP tools — investigation findings

Fork-local follow-up to `docs/operator/2026-10-25-mcp-context-cost-audit.md`
(branch `docs/mcp-context-cost-audit`; not yet on this tip). Peer:
`fork/slim-big-tools`. Sibling `shrink-shared-prompts` owns
`SESSION_ID_PREFIX_PARAM_DESCRIPTION` / `PEER_IDENTITY_UUID_RULE` — not touched.

## Re-measure (description only)

Tokenizer: `@anthropic-ai/tokenizer` + `tiktoken` `cl100k_base` (same caveat as
the audit — no exact Claude 3+/4/5 public vocab; Anthropic's published package
is archived/legacy). No `ANTHROPIC_API_KEY` here for
`/v1/messages/count_tokens`.

| String | anthropic | cl100k |
|---|---|---|
| `SPAWN_PEER_TOOL_DESCRIPTION` before (incl. `PEER_IDENTITY_UUID_RULE`) | 349 | ~340 |
| after justified trim | 322 | ~313 |
| **saved** | **~27** | **~27** |

Full tool wire cost was not re-run through the audit's zod→JSON Schema harness
(driver `node_modules` still works under `/tmp/mcp-audit` but this peer did not
re-expand every tool). Description delta above is the honest bound for the
spawn prose cut.

## `SPAWN_PEER_TOOL_DESCRIPTION` clause pass

Entire constant landed as one squash on main (`7f5d6b17f` / #1922). Pre-squash
history (driver/soup tips) is where the failures live:

| Clause | Trace | Verdict |
|---|---|---|
| Remit required / fail if 0 user messages | #1509 / `b6c9b861b` — machine spawn left idle peers | **keep** |
| Do not POST `/api/machines/.../spawn` with message | #1509 — was "stripped", later hub **rejects** (`7f5d6b17f` copy fix) | **keep** |
| Optional `machine` + directory-on-target / no local check | #1931 / `7edf107a8` | **keep** |
| Omit `permissionMode` = yolo via peerSpawnDefaults | `44dcd3c98` — agents omitted and got approval-gated default | **keep** (merged into one sentence) |
| Do not clone parent mode / pass only to tighten | same incident lineage | **keep** |
| Parent auto-stamp fail-closed | #1922 remainder / `6a9f2a027` | **keep** |
| Prefer MCP/`hapi spawn-peer` over JWT+curl | no distinct incident; shell-escaping rationale in audit §3 | **keep** (product caveat, not dead weight) |
| "Returns the new sessionId + name" | no failure trace; return payload already shows this | **cut** |
| "Same hub/namespace as this session" | no failure trace; true of all hub MCP tools | **cut** |
| "(Settings → General → Agents)" UI path | no agent-facing failure; human settings chrome | **cut** |
| `PEER_IDENTITY_UUID_RULE` | sibling scope | **untouched** |

## Optional `spawn_peer` fields (`effort` / `sessionType` / `model`)

Strict Cursor transcript scan for `"type":"tool_use","name":"…spawn_peer"` with
JSON `input` (N=8 estate samples):

| Field | Present |
|---|---|
| directory / message / name | 8/8 |
| agent | 7/8 |
| machine | 1/8 |
| model | 1/8 |
| effort | 0/8 |
| sessionType | 0/8 |
| permissionMode | 0/8 |

**Not enough to drop schema fields.** CLI `--effort` / `--session-type` /
`--model` remain first-class (`cli/src/commands/spawnPeer.ts`) and unit tests
forward them. Hub/transcript FTS also did not yield a trustworthy call corpus.
**Could not verify estate-wide MCP unused** — leave schema intact.

## `session_job` (soup-only tip)

Lives on `driver/session-attached-jobs`, not fork `main`. Change shipped on
branch `driver/slim-session-job-mcp`:

- Say null-clears-a-field **once** in `SESSION_JOB_TOOL_DESCRIPTION`
- Drop the repeated "Pass null to clear…" from `done`/`total`/`remaining`/
  `unit`/`detail` `.describe()` strings
- Keep `startedAt` in schema (handler still rejects it with an explicit steer;
  dropping the field would silently strip under non-strict Zod)

Estimated describe-text savings ~13 cl100k tokens (small). Did **not** split
the tool or convert enums (audit §4 still holds; no new evidence).

## What this peer did **not** verify

- Exact Claude 4/5 token counts via Messages `count_tokens` (no API key)
- Full re-run of audit `/tmp/mcp-audit/measure.cjs` after edits
- Live Cursor eager-tool tax after soup promote
- Whether dropping "Prefer … JWT+curl" would increase raw curl misuse (kept)
- `ping_peer` / `inspect_peer` / `archive_peer` prose beyond the shared strings
  owned by the sibling peer

## Ship shape

1. `fork/slim-big-tools` — `SPAWN_PEER_TOOL_DESCRIPTION` trim + this write-up →
   fork PR to `heavygee/hapi` `main`
2. `driver/slim-session-job-mcp` — session_job null-hoist → soup tip-forward
   (replace / stack on `driver/session-attached-jobs` in
   `config/driver-manifest.yaml` when dogfooding)
