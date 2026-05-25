# Handoff: voice picker dynamic list + broader voice vision

**Date:** 2026-05-25  
**Branch:** `feat/voice-picker`  
**Session ended due to:** usage limit  
**Next agent: pick up from "Immediate fix needed" below**

---

## 2026-05-25 follow-up update (post-handoff continuation)

### Final resolution (same-day)

- Root cause identified: runtime `overrides.tts` path was unstable in this environment (post-connect SDK/runtime failure); it was not specific to clone IDs.
- Implemented stable architecture:
  - client no longer sends runtime TTS voice override
  - `/api/voice/token` now accepts `voiceId`
  - hub resolves/creates a **voice-specific ElevenLabs agent** (named `Hapi Voice Assistant [voice:<id>]`) and requests token for that agent
- Added hub regression coverage:
  - `hub/src/web/routes/voice.test.ts` now validates voice-specific agent creation and token issuance path for a provided `voiceId`.
- Observed result in manual validation:
  - default voice works
  - non-default selected voices (including clone voices) route through distinct agent IDs and speak as selected.

### What was implemented

- Fixed and stabilized settings voice-picker tests:
  - `web/src/routes/settings/index.test.tsx`
  - Added `useAppContext` + `fetchVoices` mocks
  - Added voice picker behavior tests (dynamic voices, preview button, localStorage save)
  - Added cleanup between tests to avoid cross-test DOM contamination
- Added hub route tests:
  - `hub/src/web/routes/voice.test.ts`
  - Covers 401/no-auth, empty list when no key, and field mapping (`voice_id` → `id`, `preview_url` → `previewUrl`)
- Added plan update section to main plan doc:
  - `docs/plans/2026-05-23-voice-agent-state-integration.md` §16.11 (Phase 0.5 / #401 alignment / local stack framing / fleet vision)
- Added telemetry + resilience for voice startup:
  - `hub/src/web/routes/voice.ts`
    - Structured logs for `/api/voice/token` and `/api/voice/voices`
    - New `POST /api/voice/telemetry` endpoint for client-side startup events
  - `web/src/api/client.ts`
    - Added `sendVoiceTelemetry(...)`
  - `web/src/realtime/RealtimeVoiceSession.tsx`
    - Emits startup telemetry at key stages (mic, token, override-fail, fallback, success/fail)
    - Retries session start without `tts.voiceId` override if override path fails

### What was discovered

- The observed user failure path is **not** token issuance:
  - Hub returns `POST /api/voice/token` `200` and issues token successfully.
- Failure occurs **after** token issuance in client/ElevenLabs session startup path.
- Prior debugging confusion came from restarting/replacing the live hub process used by active sessions; this caused socket drops and inconsistent telemetry windows.
- Production-safe debugging approach must avoid killing the control-plane process used by current sessions.

### Current known state for next agent

- Hub/runner can be healthy while voice startup still fails post-token.
- Telemetry plumbing now exists to identify exact failing stage on next repro (`[Voice][Telemetry]` + `[Voice][Token]` logs).
- If testing UI on systemd-served hub, remember embedded web asset pipeline caveat (systemd serves embedded assets, not arbitrary local dev dist unless regenerated and restarted).

---

## What was completed this session

### Feature: dynamic ElevenLabs voice list with preview (Phase 1)

All code written, TypeScript clean, web built and deployed to hub.

| File | Change |
|------|--------|
| `hub/src/web/routes/voice.ts` | Added `GET /voice/voices` — proxies `${ELEVENLABS_API_BASE}/voices`, maps to `{id, name, previewUrl, category}`, returns `{voices:[]}` gracefully when no API key |
| `web/src/api/client.ts` | Added `fetchVoices()` method |
| `web/src/api/voice.ts` | Added `VoiceInfo` interface and `fetchVoices(api)` function |
| `web/src/realtime/RealtimeVoiceSession.tsx` | Fixed `voice_id` → `voiceId` in ElevenLabs SDK override (was a TypeScript error) |
| `web/src/routes/settings/index.tsx` | Dynamic voice loading on mount, `▶`/`◼` preview buttons per voice, "clone" badge for cloned voices, falls back to static VOICES if API returns empty |

**Proof of concept**: user's cloned voice "jessicax" (id: `CnROpAg4bG2UJRg7cykD`) should appear with "clone" badge in the picker.

**Committed as:** `feat(voice): dynamic voice list with preview from ElevenLabs API` (4970e75)  
**Draft PR on fork:** https://github.com/heavygee/hapi/pull/2  
**Upstream issue filed:** https://github.com/tiann/hapi/issues/686 (via sterlingchad)

---

## Immediate fix needed: broken tests

**All 13 existing settings tests are failing.** Root cause: we added `const { api } = useAppContext()` to `SettingsPage` but the test file has no mock for it.

Error: `AppContext is not available` thrown at `web/src/lib/app-context.tsx:26`

### Fix required in `web/src/routes/settings/index.test.tsx`

1. **Add mock for `@/lib/app-context`** — needs a mock `api` object with a `fetchVoices` method:

```typescript
vi.mock('@/lib/app-context', () => ({
    useAppContext: () => ({
        api: {
            fetchVoices: vi.fn().mockResolvedValue({
                voices: [
                    { id: 'voice-1', name: 'Alice', previewUrl: 'https://example.com/alice.mp3', category: 'premade' },
                    { id: 'voice-2', name: 'MyClone', previewUrl: 'https://example.com/clone.mp3', category: 'cloned' },
                ]
            })
        },
        token: 'test-token',
        baseUrl: 'http://localhost:3006'
    })
}))
```

2. **Add mock for `@/api/voice`** — the settings page imports `fetchVoices` from there:

```typescript
vi.mock('@/api/voice', () => ({
    fetchVoices: vi.fn().mockResolvedValue([
        { id: 'voice-1', name: 'Alice', previewUrl: 'https://example.com/alice.mp3', category: 'premade' },
        { id: 'voice-2', name: 'MyClone', previewUrl: 'https://example.com/clone.mp3', category: 'cloned' },
    ])
}))
```

3. **Add new test cases** for the voice picker section:

```typescript
it('renders the Voice Assistant section with voice picker', () => {
    renderWithProviders(<SettingsPage />)
    expect(screen.getAllByText('Voice Assistant').length).toBeGreaterThanOrEqual(1)
    expect(screen.getAllByText('Voice').length).toBeGreaterThanOrEqual(1)
    expect(screen.getAllByText('Default').length).toBeGreaterThanOrEqual(1)
})

it('uses correct i18n keys for voice picker', () => {
    const spyT = renderWithSpyT(<SettingsPage />)
    const calledKeys = spyT.mock.calls.map((call) => call[0])
    expect(calledKeys).toContain('settings.voice.voice')
    expect(calledKeys).toContain('settings.voice.voiceDefault')
})

it('shows voice list with clone badge when picker is open', async () => {
    renderWithProviders(<SettingsPage />)
    // Open the voice picker
    const voiceButtons = screen.getAllByRole('button')
    const voicePickerButton = voiceButtons.find(b => b.textContent?.includes('Voice') && b.textContent?.includes('Default'))
    // ... click and check for dynamic voices
})
```

4. **Verify** `localStorage.getItem` mock returns null for `hapi-voice-id` in `beforeEach` (currently returns `'en'` which is wrong for voice ID).

### Also: no hub route tests exist

`hub/src/web/routes/voice.test.ts` does **not** exist (it's in PR #401 which hasn't merged). Should add:
- `GET /api/voice/voices` returns 401 without auth
- Returns `{voices:[]}` when no `ELEVENLABS_API_KEY`  
- Returns mapped voice list when API key set (mock the fetch)
- Maps `voice_id` → `id`, `preview_url` → `previewUrl` correctly

Run tests with: `cd web && npx vitest run src/routes/settings/index.test.tsx`

---

## Pending work: plan update

The main voice integration plan at `docs/plans/2026-05-23-voice-agent-state-integration.md` needs a new section (append to §16 or create §17) capturing:

1. **Phase 0.5 completed (this session):**
   - Voice picker with static fallback → dynamic ElevenLabs list including clones
   - Hub proxy route `GET /voice/voices`
   - Preview audio via ElevenLabs CDN `preview_url`
   - Fork draft PR #2, upstream issue #686

2. **Phase 2 framing:** VoiceTransportProvider abstraction — coordinate with upstream PR #401 author (Overbaker), do not reinvent. See PR #401 assessment below.

3. **Phase 3 framing:** Local TTS via Pipecat → Speaches/Chatterbox. Pipecat is preferred over raw OpenAI-compatible endpoints because it handles the pipeline orchestration.

4. **Fleet command center vision (new §):** The broader goal is a "voice-first command center" where ONE voice conversation can orchestrate ALL active agents across sessions — an attention economy that routes incoming agent notifications to the operator's earbuds. This enables true hands-free operation (gardening, walking) where the operator fields agent requests without touching their phone. Cost-prohibitive with cloud TTS/LLM per agent → local stack (Speaches + Chatterbox) is load-bearing for viability.

---

## Pending work: GitHub Discussion

The user wants to open a GitHub Discussion in tiann/hapi's Ideas section, authored as heavygee (voice: diffident, helpful, journeyman coder — NOT authoritative, inviting collaboration).

**Identity:** Use `gh` (heavygee account, not gh-chad) since this is the user speaking, not AI automation.

**How to create a GitHub Discussion via API:**
```bash
# Get the repository node ID and category ID first
gh api repos/tiann/hapi --jq '{id: .node_id}'
gh api repos/tiann/hapi/discussions/categories 2>/dev/null || \
  gh api graphql -f query='{ repository(owner:"tiann",name:"hapi") { discussionCategories(first:10) { nodes { id name } } } }'
```

Then use GraphQL mutation:
```bash
gh api graphql -f query='
mutation {
  createDiscussion(input: {
    repositoryId: "REPO_NODE_ID",
    categoryId: "CATEGORY_NODE_ID",
    title: "Voice roadmap ideas: from voice picker to fleet command center",
    body: "BODY_HERE"
  }) {
    discussion { url }
  }
}'
```

**Discussion body to write** (in heavygee's voice — journeyman, slightly tentative, genuinely enthusiastic):

Cover these points in order:
1. **What prompted this** — just shipped a voice picker (issue #686) that shows your ElevenLabs clones, got thinking about where voice could go
2. **Phase 1 (done):** dynamic voice list + preview — simple quality-of-life
3. **Phase 2: provider abstraction** — hat tip to PR #401 (Overbaker's excellent work on Gemini Live/Qwen), want to make sure we end up with a clean interface that local providers can implement too. Question for community: what's the right interface shape?
4. **Phase 3: local TTS/STT** — Pipecat as orchestrator, Speaches for STT, Chatterbox for TTS. Anyone else running local speech stacks?
5. **Phase 4: fleet command center** — the bigger dream: one voice conversation that spans ALL agents. You're doing other things (gardening example), agents call you when they need something. Attention economy — which agent needs you RIGHT NOW vs which can wait. Cost only works with local providers.
6. **Explicit asks from community:**
   - Anyone else want to implement their preferred provider once the interface exists?
   - Is the fleet/attention model something others want?
   - Should this be a separate "voice mode" UI or integrated into existing session view?
   - Any concerns about the abstraction approach vs what #401 already does?

**Tone notes:** Don't claim this is definitely the right approach. Use "I've been thinking about...", "not sure if others want this", "happy to be talked out of it". Reference #401 positively. Acknowledge this is ambitious.

---

## Upstream PR assessment (for the discussion)

### PR #401 — pluggable voice backend (Gemini Live & Qwen) by Overbaker
**Status:** OPEN, CHANGES_REQUESTED, has merge conflicts  
**Verdict: EMBRACE AND HELP MERGE, don't fork**

The architecture is exactly right: `VOICE_BACKEND` env var, `GET /api/voice/backend` for runtime discovery, lazy-loaded alternative sessions, zero change to ElevenLabs default. This is what we'd build for Phase 2 anyway.

**Open issues that need fixing before merge (per §16.5.1 of main plan):**
- Gemini unmutes user mic after `turnComplete` (barge-in mute ≠ user mute)
- `AudioContext` leak on failed session starts
- Composer Enter-to-send regression — needs tiann ruling on whether this is intentional or split to separate PR
- Gemini setup message dropped under proxy backpressure
- Qwen stuck in `connecting` after setup error
- Merge conflicts with current main

**Our role:** We should offer to help rebase + fix the open bot findings. Do NOT build a parallel abstraction. Once #401 merges, our local provider (Phase 3) slots in cleanly.

### PR #640 — relay Codex responses to voice by PeterDraex
**Status:** OPEN, no review from tiann yet  
**Verdict: GOOD PR, coordinate to avoid duplication**

Fixes Codex message formatting for voice context and moves ready trigger to live SSE only (not history replay). This overlaps with our `fix/voice-flavor-labels` and `fix/voice-readback` work.

**Key:** HAPI Bot flagged that the ready detection in `SessionChat.tsx` fires on historical/hydrated messages — needs to move to the SSE `message-received` path only.

**Our role:** If our flavor-labels PR and #640 both touch `contextFormatters.ts`, coordinate. Ideally #640 merges first for the Codex parts, then our PRs build on top.

### PR #463 — realtime dictation modes by Shujakuinkuraudo
**Status:** OPEN  
**Verdict: TANGENTIAL, no conflict**

Adds STT/transcription modes (browser speech API, ElevenLabs Scribe). Interesting for input but doesn't touch our voice assistant output path. Relevant later when thinking about the local speech stack.

### PR #464 — ElevenLabs tools before agent setup by Shujakuinkuraudo  
**Status:** OPEN  
**Verdict: SHOULD MERGE FIRST — it's a compatibility fix**

Replaces deprecated `prompt.tools` with `prompt.tool_ids`. If ElevenLabs has actually deprecated the old format, this is blocking functionality for some users. Advocate for merging quickly ahead of the others.

---

## Branch state summary

```
feat/voice-picker (current)
  742434a feat(web): add voice picker to settings          ← static VOICES list
  4970e75 feat(voice): dynamic voice list with preview     ← dynamic + preview (this session)

Unstaged (DO NOT include in voice-picker PR):
  M hub/src/web/routes/machines.ts   — resumeSessionId in SpawnSessionRequest (separate feature WIP)
  M shared/src/apiTypes.ts           — same, adds resumeSessionId to schema
```

The `machines.ts` / `apiTypes.ts` changes are unrelated work-in-progress. Do not stage them into voice picker commits.

---

## Key file paths for next agent

| Purpose | Path |
|---------|------|
| Hub voice routes | `hub/src/web/routes/voice.ts` |
| Web API voice functions | `web/src/api/voice.ts` |
| Web API client | `web/src/api/client.ts` |
| Settings page | `web/src/routes/settings/index.tsx` |
| Settings tests (broken!) | `web/src/routes/settings/index.test.tsx` |
| Voice context (localStorage reads) | `web/src/lib/voice-context.tsx` |
| Static voice fallback list | `web/src/lib/voices.ts` |
| ElevenLabs session | `web/src/realtime/RealtimeVoiceSession.tsx` |
| Main voice integration plan | `docs/plans/2026-05-23-voice-agent-state-integration.md` |

## Priority order for next agent

1. **Fix broken tests** — `settings/index.test.tsx` needs `useAppContext` and `fetchVoices` mocks. All 13 tests fail right now. This blocks the PR being submittable.
2. **Add new voice picker tests** — dynamic loading, play button, clone badge, localStorage save.
3. **Add hub route tests** — `hub/src/web/routes/voice.test.ts` for `GET /voice/voices`.
4. **Update plan doc** — append fleet command center vision to `2026-05-23-voice-agent-state-integration.md`.
5. **Open GitHub Discussion** — see body outline above. Use `gh` (heavygee), GraphQL mutation. Get category IDs first.
6. **Push updated tests** to `feat/voice-picker` branch and update draft PR #2.
