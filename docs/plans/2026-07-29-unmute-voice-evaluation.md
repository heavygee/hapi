# Free/local agentic voice overseer — Unmute & peers evaluation

> **Status:** research / recommendation only (revised 2026-07-29 after operator framing correction). No deploy, no product code.
> **Handoff from:** 🔁overseer prep (`/sessions/a492a270-514f-4cd9-88c1-d6c07744a245`)
> **Correction:** Prior draft wrongly treated ElevenLabs as the destination benchmark ("stay on paid"). Wrong axis. This revision compares **free/local candidates against each other** toward an **agentic voice-enabled overseer**. Cloud/paid (ElevenLabs, Gemini Live, DashScope/Qwen-cloud, OpenRouter-paid) appear only as **temporary bridges**, never as the end state.

**Sources:** unmute README + Mintlify (2026-07-29), issue [#77](https://github.com/kyutai-labs/unmute/issues/77), [delayed-streams-modeling](https://github.com/kyutai-labs/delayed-streams-modeling), arXiv [2509.08753](https://arxiv.org/abs/2509.08753), arXiv [2603.05413](https://arxiv.org/html/2603.05413v2) (self-hosted realtime voice agents), HAPI plans + branches `remotes/overbaker/feat/pluggable-voice-backend`, `feat/overseer-stt-tts-endpoints`, estate `~/coding/local-speech-agent`, `local-voice-agent-pre-overseer.md`.

---

## TL;DR

**End goal:** a **free, local, agentic** overseer you can talk to — tool-using, conversational, full-duplex barge-in — not "good enough paid TTS for summaries."

| Part | Free/local status |
|------|-------------------|
| **Ears (STT)** | Nearly solved (Speaches already; Kyutai STT available) |
| **Mouth (TTS)** | Nearly solved (Chatterbox already; Kyutai TTS available) |
| **Turn-taking / VAD / barge-in** | Partially solved locally (estate realtime-gateway; Unmute shell is stronger/proven; DIY orchestrators exist) — **still an engineering decision, not a research unknown** |
| **Brain (tool-using local LLM + hub mode-machine + overseer tools)** | **The real crux.** Biggest VRAM chunk. Free weights + vLLM/Ollama exist; fitting a tool-capable overseer brain on contended GPUs is the hard free/local problem |

**Honest fork for agentic full-duplex (free/local):**

| Option | What | Trade |
|--------|------|-------|
| **X (compose)** | Free STT/TTS + local agent-LLM + **HAPI builds** VAD/barge-in/mode-machine (reuse / extend estate realtime-gateway or DIY) | Max control; most eng; no Unmute fork tax |
| **Y (Unmute shell)** | Plug HAPI overseer-agent in as Unmute's LLM (#77 tool proxy); get Kyutai STT/TTS + turn-taking/VAD/barge-in "for free" | Less duplex eng; live inside Unmute's model + maint + GPU + #77 |

**Recommendation under free/local lens:** Prefer **X with estate Speaches+Chatterbox(+realtime-gateway)** as the default path; treat **Y (Unmute)** as a credible alternate once the local brain is reserved and you want to buy duplex maturity instead of building it. Do **not** treat Unmute as "wrong ownership" if the LLM slot *is* the HAPI overseer — that CursorVox concern largely dissolves. Do **not** pay ElevenLabs as destination; burn the bridge as soon as local mouth covers readback.

---

## 1. Correct framing (operator intent)

```text
DESTINATION (non-negotiable):
  Free + local agentic voice overseer
  = ears + mouth + full-duplex loop + tool-using brain
  wired to hub mode-machine + overseer tools

NOT the framing:
  "Is Unmute better than ElevenLabs?"
  "Should we stay on paid?"

BRIDGES ONLY (temporary):
  ElevenLabs TTS readback (live today)
  Gemini Live / DashScope Qwen-realtime (pluggable cloud backends in #401-shaped work)
  OpenRouter-paid LLM in an Unmute compose (demo only — not free destination)
```

Compare candidates **against each other** for that destination. Paid cloud is scaffolding you intend to tear down.

---

## 2. Decompose the agentic overseer

```text
┌─────────┐   ┌─────────┐   ┌──────────────────────┐   ┌─────────────────────────────┐
│  EARS   │→→│  BRAIN  │→→│  MOUTH               │   │  TURN-TAKING / VAD / BARGE  │
│  STT    │   │  LLM +  │   │  TTS                 │   │  (full-duplex session loop) │
│         │   │  tools  │   │                      │   │                             │
└─────────┘   │  + hub  │   └──────────────────────┘   └─────────────────────────────┘
              │  mode   │
              └─────────┘
```

| Layer | Job | Free/local candidates | Status |
|-------|-----|----------------------|--------|
| **Ears** | Speech → text (streaming preferred for duplex) | **Speaches** (estate, OpenAI HTTP); **Kyutai STT** via moshi-server (~2.5GB); Whisper.cpp / faster-whisper | **Nearly solved** |
| **Mouth** | Text → speech (streaming preferred) | **Chatterbox** (estate, ~4.5–5GB, cloned voices); **Kyutai TTS** (~5.3GB); Piper/Kokoro (lighter, lower quality) | **Nearly solved** |
| **Turn-taking** | VAD, end-of-utterance, interrupt TTS/LLM mid-flight, barge-in | Estate **realtime-gateway** (`server_vad`, `assistant.interrupted`); **Unmute** backend (ORA + semantic VAD); DIY (voice-agent-starter, Logica Voice, Pipecat-class); HAPI hub mode silence policy | **Partially solved / build-or-adopt** |
| **Brain** | Tool-using overseer LLM + hub mode-machine + overseer query/edict tools | Local **vLLM / Ollama / llama-server** with OpenAI tools; HAPI overseer entity + tools (in progress); #77-style tool proxy if using Unmute | **Unsolved as a free/local *system*** — pieces exist, integration + VRAM are the crux |

### What is actually hard

1. **Mouth/ears are not the bottleneck.** Estate already runs Speaches + Chatterbox; Kyutai is an alternate parts bin with strong streaming claims. Wiring them into `VoiceTransportShim` is engineering, not invention.
2. **Full-duplex turn-taking** is real work if you build it (Option X), or a maintained dependency if you adopt Unmute (Option Y). Estate gateway already does server VAD + barge-in for speech sessions — closer to X than cold-start.
3. **The free/local tool-capable brain is the crux.**
   - A useful overseer model (tool calling, multi-step inbox reasoning) wants **far more VRAM than STT+TTS combined** — often 8–24GB+ depending on size/quant, *on top of* speech models if concurrent.
   - Contended studio GPUs (ComfyUI, vision, Win11 passthrough, existing local LM) make a **sticky agentic brain** the scarcest resource.
   - Without a local tool-capable LLM reserved for the overseer, "free agentic voice" is theater: you get a free mouth reading cloud-or-stub brains.

**Kill criterion for "free agentic":** cannot dedicate a tool-capable local LLM (even quantized 7–14B class) without destroying daily GPU workloads. Until that is solved (second GPU, schedule windows, or smaller proven tool model), agentic duplex stays aspirational and phases 0–1 (local mouth/ears) still ship value.

---

## 3. Free/local candidate field

Drop cloud/paid from the destination set. Bridges noted in italics.

| Candidate | Covers | Free/local? | Notes |
|-----------|--------|-------------|-------|
| **Speaches + Chatterbox + realtime-gateway** (estate `local-speech-agent`) | Ears, mouth, partial duplex (VAD/barge-in), optional Ollama | **Yes — already operated** | Best default X substrate. OpenAI HTTP → fits `VoiceTransportShim`. Gateway has `/v1/realtime`, server VAD, barge-in. LLM optional / points at desktop host |
| **Kyutai delayed-streams / moshi-server** | Ears and/or mouth only | **Yes** | STT ~2.5GB, TTS ~5.3GB; msgpack WS (glue cost). Same models Unmute uses |
| **Full Unmute** | Ears + mouth + duplex shell; LLM pluggable | **Yes if LLM is local free** | #77 tools not native. x86_64 Linux. Compose ≥16GB with tiny local LLM; speech-only ~8GB if LLM elsewhere |
| **Local text LLM (vLLM/Ollama)** | Brain | **Yes (weights + runtime free)** | *The* VRAM hog. Tool calling supported in modern stacks. Size vs quality trade is the decision |
| **HAPI hub mode-machine + overseer tools** | Brain policy / agency | **Yes (our code)** | Must exist on every path; Unmute does not replace this |
| **Qwen3-Omni / CosyVoice local** | Partial E2E or TTS | **Weights open; realtime E2E not really** | [2603.05413](https://arxiv.org/html/2603.05413v2): DashScope realtime ~702ms but **not self-hostable**; local vLLM serves Thinker only; full Transformers ~146s. **HAPI's `qwen-realtime` backend today = DashScope cloud = bridge, not destination.** CosyVoice can be local TTS alternate |
| **Logica Voice / voice-agent-starter / Pipecat-class** | Duplex orchestrator + tools | **Yes (immature / BYO models)** | Option X reference implementations; less proven than Unmute; tool passthrough sometimes native |
| *ElevenLabs ConvAI / TTS* | Bridge mouth (+ paid duplex brain) | **No — bridge only** | Live readback today; **exit ASAP** |
| *Gemini Live* | Bridge duplex + tools | **No — bridge only** | In pluggable switcher; cloud |
| *OpenRouter / paid OpenAI* | Bridge brain in Unmute demos | **No — bridge only** | Fine for latency spikes; not destination |

---

## 4. What Unmute is (facts retained)

Unmute wraps any OpenAI-compatible **text** LLM in Kyutai STT + TTS:

```text
Client  ←ORA-ish WS→  Unmute backend
                         ├─ Kyutai STT  (~2.5GB)
                         ├─ LLM slot    (YOU choose — local vLLM/ollama for free destination)
                         └─ Kyutai TTS  (~5.3GB)
```

| Fact | Detail |
|------|--------|
| Protocol | `/v1/realtime`, subprotocol `realtime`; ORA-inspired + `unmute.*` extensions |
| Latency | TTS ~450ms (3-GPU) → ~750ms (1 GPU); STT ~6-token delay |
| Platforms | x86_64 Linux/WSL only |
| Deploy | Compose / dockerless / Swarm |
| Separable | delayed-streams STT/TTS without Unmute |
| Tools | **Not built-in** — #77: FastAPI wrap / Agent SDK / dual talker-reasoner so Unmute only sees spoken text stream |

Under the **corrected** lens: Unmute's duplex/VAD/interrupt is a **feature we'd otherwise build** (Option X). Conversation "ownership" is not a CursorVox trap **if the LLM slot is literally the HAPI overseer agent** (tools + mode policy live in that slot / hub). Unmute then owns the **audio session physics**, not the **fleet agency**.

---

## 5. HAPI interfaces (still hold)

### A. Realtime conversational — `feat/pluggable-voice-backend`

`VoiceBackendType = elevenlabs | gemini-live | qwen-realtime` today (cloud/bridge). Free destination needs a local backend type (`local-openai`, `unmute`, or `local-gateway`) implementing `VoiceSession` + tool bridge to overseer tools (not only `messageCodingAgent`).

### B. Standalone STT/TTS — `feat/overseer-stt-tts-endpoints`

`VoiceTransportShim { transcribe, synthesize }` — correct home for **phase 0–1** free mouth/ears (Speaches/Chatterbox or Kyutai). Agentic duplex is **not** this shim; it is a realtime session + brain.

### C. Estate Layer E substrate

`local-speech-agent`: Speaches + Chatterbox + realtime-gateway already on proxmox / Tailscale `svc:local-voice`. This is the strongest free/local starting point for Option X.

---

## 6. Option X vs Option Y (agentic free/local)

### Option X — Compose (HAPI owns the loop)

```text
Mic → [HAPI or estate gateway: VAD / barge-in]
    → Speaches or Kyutai STT
    → Local overseer LLM (vLLM/Ollama) + hub tools + mode-machine
    → Chatterbox or Kyutai TTS
    → Headset
```

| Pros | Cons |
|------|------|
| Max control; hub mode states (`executing_async` silence, `await_confirm`) are first-class | You build/maintain duplex orchestration (or harden estate gateway into overseer-grade) |
| Reuses estate speech stack + OpenAI HTTP shims | Duplex quality may lag Unmute until invested |
| No Unmute Python/ORA fork tax | Tool loop is yours end-to-end (good) but eng cost is real |
| Swap STT/TTS vendors independently | |

**Eng sketch:** Extend realtime-gateway (or new hub WS) with overseer tool registry; point LLM at local vLLM; wire mode-machine events to mute/speak policy; pluggable `VoiceTransportShim` for non-duplex readback/dictation.

### Option Y — Adopt Unmute shell (HAPI owns the LLM)

```text
Mic → Unmute (STT + VAD + barge-in + TTS)
         → KYUTAI_LLM_URL = HAPI overseer tool-proxy
              → local vLLM/Ollama + overseer tools + mode-aware prompting
         ← spoken token stream only
```

| Pros | Cons |
|------|------|
| Proven low-latency duplex + Kyutai speech | Live inside Unmute's session model + ORA deviations |
| #77 pattern matches "we want to own the agent loop anyway" | Fork/maint when Unmute drifts; x86_64 CUDA ops |
| Frontend can be discarded; HAPI PWA is client | Sticky STT+TTS VRAM (~8GB) **plus** brain VRAM |
| Faster path to "talk to overseer" UX | Mode-machine must still drive the LLM proxy (silence fillers, confirm gates) — Unmute won't know hub states alone |

**Eng sketch:** Thin FastAPI OpenAI-compatible proxy: chat messages in → run overseer tools → stream speakable text out. Hub injects mode into system prompt / rejects speak during `executing_async`. HAPI web speaks ORA-ish WS to Unmute (or Unmute's Python client patterns).

### Weighing X vs Y under free/local

| Criterion | Edge |
|-----------|------|
| Free/local purity | Tie (both can be 100% local) |
| Duplex maturity now | **Y** (Unmute) |
| Estate reuse / ops familiarity | **X** (Speaches/Chatterbox/gateway) |
| Hub mode-machine fidelity | **X** slightly; **Y** OK if proxy is strict |
| Tool calling | **X** native; **Y** via #77 proxy (doable, not free) |
| Eng cost to first agentic duplex | **Y** lower if speech+VAD already "good"; **X** lower if gateway already almost enough |
| Long-term maint | **X** (our code) vs **Y** (upstream Unmute + our proxy) |
| VRAM | Similar speech floor; **brain dominates either way** |

**Provisional pick:** Start **X** on estate stack for phases 0–1 and early duplex experiments (gateway already has VAD/barge-in). **Re-open Y** when (a) local brain GPU is reserved and (b) gateway duplex feels worse than Unmute after a timeboxed bake-off. Do not pick Y to avoid building a brain — the brain is unavoidable.

---

## 7. GPU / VRAM realities (unchanged physics, corrected goals)

| Bundle | Approx VRAM | Role |
|--------|-------------|------|
| Speaches STT (typical) | low–mid (model-dependent; verify on box) | Ears |
| Chatterbox TTS | ~4.5–5GB | Mouth |
| Kyutai STT | ~2.5GB | Ears alt |
| Kyutai TTS | ~5.3GB | Mouth alt |
| Unmute speech only (STT+TTS) | ~8GB | Y shell without local LLM |
| Tiny local LLM (1–3B) | ~6GB | Demo brain only — **weak for toolful overseer** |
| Tool-capable overseer LLM (7–14B quant) | ~8–16GB+ | **Real brain — the crux** |
| Full Unmute compose default | ≥16GB | Speech + small LLM on one card |

**Homelab:** Contended GPUs. Agentic free/local implies either (1) a dedicated card for overseer brain (+ speech), (2) schedule windows (gardening hours = overseer; ComfyUI hours = art), or (3) accept smaller/quantized brain with measured tool quality. Speech-only local (phases 0–1) is affordable; **agentic is a GPU product decision**, not a README install.

---

## 8. Phased plan: unclear → clearer

ElevenLabs = **bridge only** in phase 0; exit criterion is local mouth on the overseer summary path.

### Phase 0 — Free readback bridge (mouth)

**Goal:** Overseer summaries speak via **local free TTS**; stop depending on paid ElevenLabs.

- Wire `VoiceTransportShim` → Speaches/Chatterbox (preferred) or Kyutai TTS.
- Keep summary → inbox pipeline; swap synthesizer only.
- *Bridge:* ElevenLabs until this ships; no new paid spend as strategy.

**Exit:** One real `AGENT_NOTIFY_SUMMARY` heard on headset from local TTS.

### Phase 1 — Free dictation (ears)

**Goal:** Operator speech → text into overseer / composer without cloud STT.

- `VoiceTransportShim.transcribe` → Speaches (or Kyutai STT).
- PTT or Quest/post-play paths already point at local-voice; unify on hub.

**Exit:** Dictated overseer query lands as hub text without cloud STT.

### Phase 2 — Local brain reservation (the crux)

**Goal:** Decide and reserve a **free local tool-capable LLM** for overseer.

- Pick size/quant vs quality (dogfood overseer 7 tools).
- GPU schedule or dedicated device; measure TTFT under speech load.
- Implement tool loop against overseer APIs **without** requiring duplex yet (text chat to overseer proves brain).

**Exit:** Text-mode overseer with local LLM + tools is usable; VRAM budget written down.

**If Phase 2 fails kill criterion:** Agent remains free mouth/ears + weaker/offline brain; duplex waits. Do not paper over with paid LLM and call it "local voice."

### Phase 3 — Agentic full-duplex (X vs Y decision)

**Goal:** Talk to overseer with barge-in; tools mid-conversation; hub mode-machine respected.

1. Timebox bake-off: estate realtime-gateway duplex **vs** Unmute shell (same local LLM URL).
2. Choose **X or Y** with evidence (interrupt latency, false barge-ins, tool round UX, ops pain).
3. Integrate chosen shell with mode states (`executing_async` = silence / no filler spam; `await_confirm` = short prompts).

**Exit:** Operator can garden: ask "what's next?", interrupt, confirm edict, hear report — all free/local.

---

## 9. Recommendation (revised)

1. **Destination is free/local agentic overseer.** Paid voice is a temporary bridge, not a strategy.
2. **Mouth/ears:** ship Speaches+Chatterbox via `VoiceTransportShim` first (estate). Kyutai STT/TTS is a peer alternate (streaming quality / one-vendor with Y), not the default.
3. **Brain is the crux:** treat local tool-capable LLM VRAM as the make-or-break decision for "free agentic." Speech models are secondary.
4. **Duplex:** prefer **Option X** (compose on estate gateway) as default; keep **Option Y** (Unmute shell + overseer as LLM) as a strong alternate once brain exists — Unmute's VAD/barge-in is a real feature, and ownership is fine if HAPI owns the LLM slot.
5. **Do not** recommend staying on ElevenLabs. Exit Phase 0 ASAP.
6. **Do not** spin Unmute GPU until Phase 2 brain budget is decided — Y without a local brain is either unpaid demo LLM (useless) or paid bridge brain (violates destination).

---

## 10. Friction mode

**Steelman Y now:** Unmute is the only battle-tested free cascaded duplex stack with Kyutai speech; #77 explicitly wants the agent outside Unmute — which is exactly HAPI overseer. Building duplex again on the gateway is NIH if Unmute works.

**Counter:** Estate already paid for Speaches/Chatterbox/gateway. Adopting Unmute adds a second speech stack + ORA client before the **brain GPU** problem is solved. Cheapest falsification order: local mouth → local ears → local tool LLM (text) → then duplex bake-off X vs Y. Skipping to Unmute compose burns the scarce resource (VRAM) on speech+shell while the crux (brain) is still hand-waved.

**Falsification tests (cheap):**

1. Phase 0: one summary via Chatterbox. Fail → try Kyutai TTS only.
2. Phase 2: 7B–14B local model runs overseer tools in text with acceptable latency. Fail → agentic voice waits; do not buy duplex.
3. Phase 3: 2-hour barge-in bake-off gateway vs Unmute with **same** local LLM. Winner gets the shell.

---

## 11. Mapping matrix (free/local destination)

```text
                 Ears     Mouth    Duplex loop    Brain (tools+mode)
Speaches+CB+GW   ●        ●        ◐ estate GW    ○ needs local LLM
Kyutai moshi     ●        ●        ○              ○
Full Unmute      ●        ●        ●              ○ via #77 + local LLM
Local vLLM/Oll.  ○        ○        ○              ● (crux)
HAPI overseer    ○        ○        mode policy    ● tools+state
Qwen local E2E   ◐        ◐        ✗ realtime     ◐ thinker-only local
Cloud bridges    — temporary only; not destination —
```

● covered  ◐ partial  ○ not this component  ✗ not free-local realtime yet

---

## References

- https://github.com/kyutai-labs/unmute + Mintlify docs + [#77](https://github.com/kyutai-labs/unmute/issues/77)
- https://github.com/kyutai-labs/delayed-streams-modeling · arXiv 2509.08753
- arXiv 2603.05413 — self-hosted realtime; Qwen3-Omni local gap
- `~/coding/local-speech-agent` · `docs/design/local-voice-agent-pre-overseer.md`
- HAPI: `2026-05-23-voice-agent-state-integration.md`, `2026-06-03-overseer-framing.md`, pluggable-voice + overseer-stt-tts branches
- Option X refs: estate realtime-gateway; Logica Voice; voice-agent-starter (immature peers)
