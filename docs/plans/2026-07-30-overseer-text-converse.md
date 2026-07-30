# Overseer text conversation (debug-settings surface) — plan

> **Status:** implementing (2026-07-30). Branch `feat/overseer-text-converse` off `feat/overseer-readonly-entity`.
> **Companions:** `2026-07-29-unmute-voice-evaluation.md` (modality-agnostic framing), `2026-07-29-overseer-brain-llm-eval.md` (brain viability).

## Goal

Let the operator have a **text conversation with the Overseer** in a **debug/settings** surface, driven by a real local LLM brain calling the read-only overseer tools. This is the cheapest way to exercise the brain + tools + conversation loop **before** any voice / duplex / STT-TTS engineering.

## Framing (resolves the "first-class citizen" worry)

The Overseer conversation is a **modality-agnostic hub core**: `messages in → brain reasons + calls read-only tools → reply out`. **Text, voice, XR are all transports** over that one core. Text is built first only because it is the cheapest to test — it is **not** privileged:

- It lives in **Settings (debug)**, not a top-level nav tab. No persistent chat panel in the app shell.
- When voice/XR land they call the **same** `/api/overseer/converse` core. Text stays a harness.

## Brain runtime (live)

Provided by janus-oos GPU ops (`2026-07-30-overseer-brain-endpoint.md`):

- OpenAI-compatible: `https://oos-llm.tail9944ee.ts.net/v1`, model **`main`** = Qwen3.6-27B (Q4_K_M, 64k ctx), no API key (tailnet ACL).
- Tool-calling verified (emits OpenAI `tool_calls`). This is the eval's top pick (27B > the 14B fallback).
- **Contention:** shared testing window. VR (Win11 2001/2006) reclaims the GPUs later → brain goes offline. The converse endpoint must **fail gracefully** ("overseer brain offline") not error.

Config via env (soup-only, fork): `OVERSEER_BRAIN_URL`, `OVERSEER_BRAIN_MODEL`, `OVERSEER_BRAIN_API_KEY?`.

## The question archetypes to design for

Real gardening questions (all covered by the existing 7 read-only tools):

| Archetype | Example | Tool path |
|---|---|---|
| Triage | "What needs my attention?" | `query_inbox` (prioritized) |
| Blockers | "Who's blocked / stuck / waiting on me?" | `list_active_workers(state=blocked)` / `query_events(eventType=blocked)` |
| Fleet status | "What's everyone doing right now?" | `list_active_workers` + `query_events` |
| Named summary | "Summarize 'web refactor'" | `list_active_workers` (name→id) → `get_session_recent_output`/`get_session_state` |
| Health / progress | "Is X healthy or stalled?" | `get_worker_health` (reported vs observed vs inferred) |
| Priority provenance | "Why is that flagged?" | `explain_priority` |
| Since-away | "What happened while I was gone?" | `query_events(sinceTs=…)` |
| Errors | "Any failures across the fleet?" | `query_events(eventType=failed/error)` |
| Root cause | "Why are 3 things stuck?" | synthesis over `query_events` (shared cause, not roll-call) |
| Dispatch (Stage 0) | "Restart X" | refuse: advise, cannot dispatch yet |

The existing `buildOverseerSystemPrompt()` already orients for these (lead with the answer, show receipts, surface conflicts, prioritize root cause, refuse dispatch). Reuse it; adjust the "Voice output" section to be modality-neutral.

## Architecture / files

**Shared (`shared/src/overseerConverse.ts`, new):**
- `buildOverseerOpenAiTools()` → the 7 tools as OpenAI function schemas (names+descriptions from `OVERSEER_TOOL_CATALOG`, params hand-mapped from `overseerToolArgsSchemas` — no new dep).
- Request/response types: `OverseerConverseRequest { messages }`, `OverseerConverseResponse { reply, toolTrace, model, brainOnline }`, `OverseerConverseMessage`.

**Hub:**
- `hub/src/overseer/runOverseerTool.ts` — extract the existing `runTool` dispatcher (reused by route + converse).
- `hub/src/overseer/brainClient.ts` — POST `/chat/completions`; typed `BrainUnavailableError` on fetch/timeout/non-200.
- `hub/src/overseer/converse.ts` — the tool-calling loop: system prompt + messages + tools → brain; while `tool_calls`, execute read-only via `runOverseerTool`, append `role:tool` results, re-call (cap ~5 iters); return `{reply, toolTrace}`.
- `hub/src/web/routes/overseer.ts` — add `POST /overseer/converse`; record a `convo_turn` event per exchange (attention 0, memory-bearing). Reads brain env; returns `brainOnline:false` + friendly reply when `BrainUnavailableError`.

**Web:**
- Settings debug panel "Overseer (text · debug)": message box + transcript + a collapsible **tool trace** (which tools it called, args) so dogfooding shows the reasoning. Calls `apiClient.overseerConverse(...)`. No top-level nav entry.

## Guardrails (thin — 27B fixed the 14B weaknesses)

- Loop cap + read-only enforcement (only the 7 tools are dispatchable; nothing mutates).
- Graceful brain-offline.
- Name→id: rely on the system prompt + `list_active_workers`; the 27B handles nested args. Revisit only if dogfood shows misfires.

## Phases

- **This:** text converse in debug settings (Stage 0 read-only).
- Next: voice transport over the same core (Chatterbox readback already ticketed #97; STT dictation later).
- Later: Stage 1 dispatch-with-confirm (activates the one-boss invariant) — separate branch.

## Soup / dogfood

Add `feat/overseer-text-converse` as a manifest layer after `feat/overseer-readonly-entity`; rebuild; set `OVERSEER_BRAIN_URL/MODEL` in the soup hub env; dogfood a text conversation on `:3006`.
