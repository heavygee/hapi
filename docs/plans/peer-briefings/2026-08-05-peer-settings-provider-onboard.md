# Peer briefing: settings onboarding for dictation (and voice/agent) providers

**Spawned:** 2026-08-05  
**Worktree:** `/home/heavygee/coding/hapi/worktrees/settings-provider-onboard`  
**Branch:** `feat/settings-provider-onboard` (from `upstream/main`)  
**Not in scope as "the feature":** voice *assistant* / ConvAI agent mode. Target is **dictation** provider onboarding, with the same gap called out for assistant backends and agent credentials.

## What landed (dictation, not voice agent)

| Artifact | Role |
|----------|------|
| [Issue #462](https://github.com/tiann/hapi/issues/462) | *Add selectable realtime dictation modes* (Shujakuinkuraudo) - closed |
| [PR #1327](https://github.com/tiann/hapi/pull/1327) | *Add provider-backed dictation mode* (@swear01) - merged 2026-08-02 |
| [PR #1329](https://github.com/tiann/hapi/pull/1329) | *Add realtime dictation providers* (@swear01) - merged 2026-08-03; closed #462 |
| [PR #463](https://github.com/tiann/hapi/pull/463) | Earlier attempt (closed stale); superseded by 1327/1329 |

#1327 explicitly chose: **credentials live in Hub startup environment**; browser only uploads audio through authenticated Hub. Discovery is env-gated (`OPENAI_API_KEY`, `ELEVENLABS_API_KEY`, `DEEPGRAM_API_KEY`, `GROQ_API_KEY`, `TRANSCRIPTION_BASE_URL` / `TRANSCRIPTION_MODEL`). See `hub/src/web/routes/voice.ts` + test *discovers only providers configured at hub startup*.

## Operator problem (the dumb invisible feature)

1. Settings → Voice → switch to **Dictation**.
2. If hub was started with no transcription env keys: UI shows  
   `settings.voice.noTranscriptionProvider` → *"No transcription provider is configured on the hub."*
3. Provider list is empty. There is **no** settings field to paste an API key, pick OpenAI/Deepgram/Groq/local, or save config.
4. Docs (`docs/guide/voice-assistant.md`, installation env table) tell you to `export …` / stick keys in systemd `EnvironmentFile` / ini-style hub env and **restart the hub**.
5. Result: dictation looks broken / missing unless you already knew to edit server env files. Feature is invisible to normal users.

Same pattern for **voice assistant backends** (e.g. `ELEVENLABS_API_KEY`) and broadly **agent / provider credentials** - picker UIs only list what the process already has. Operator want: **onboard these details in Settings**.

## Desired direction

- Settings UI to **add / edit / clear** hub-side provider credentials for at least dictation providers (OpenAI, ElevenLabs, Deepgram, Groq, OpenAI-compatible base URL + model).
- Keys must **stay on the hub** (never round-trip plaintext to unrelated clients long-term; mask in UI; write via authenticated settings/secrets API).
- After save: providers appear in the dictation picker **without** requiring the user to SSH-edit `hub.env` / ini (restart policy: prefer live reload if safe; document if restart still required for v1).
- Empty state should teach the path: "Add a provider…" not just "not configured on the hub."
- Call out / share shape with voice-assistant backend keys and agent provider onboarding (may be one secrets surface, multiple settings pages).

Appreciate #1327/#1329 for shipping dictation correctly on the transport side; this is the missing **first-run / onboarding** layer, not a rejection of env-based ops for power users (env can remain override / bootstrap).

## Your job

1. **Confirm** the gap on current `upstream/main` (settings empty-state, env discovery). Screenshot if useful.
2. **File upstream issue** on `tiann/hapi`:
   - Title idea: `Settings: onboard dictation (and voice) provider credentials in UI`
   - Cite #462, #1327, #1329; explain invisible-feature failure mode
   - Propose hub secrets/settings API + Settings Voice (and related) UI
   - Note agent-provider parity as follow-on or same umbrella
3. **Design + implement** (or land a focused first slice): settings onboarding for dictation providers at minimum. Prefer smallest safe slice that makes providers appear after a UI paste+save.
4. Peer-stack proof PNG + `display_image`; soup dogfood when ready (Meta `05d9f0f2` if rebuild needed; no agent stack-switch).
5. **Do NOT open upstream PR until operator OK.**

## Intake ownership

| Step | Status |
|------|--------|
| Archaeology cited above | DONE (orchestrator) |
| Upstream issue | **YOU** |
| Design + implement settings onboard | **YOU** |
| Proof + dogfood | **YOU** |
| Upstream PR | **YOU** only after operator OK |

## Hard rules

- Product edits only in this worktree.
- No `docs/operator/`, `docs/plans/`, `CLAUDE.md` in upstream PR diff.
- Session title = workstream only; never merge `tiann/hapi`.
- Secrets: do not log keys; do not commit `.env` / hub.env.

Canonical: `docs/tooling/feature-work-lifecycle.md`.
