# Overseer brain: free/local tool-calling LLM eval (RTX 5070 Ti 16GB)

> **Status:** research + hands-on eval. No HAPI product code touched. No deploy.
> **Handoff from:** 🔁overseer prep (`/sessions/a492a270-514f-4cd9-88c1-d6c07744a245`)
> **Companion:** `docs/plans/2026-07-29-unmute-voice-evaluation.md` (identifies the *brain* as the crux of the free/local voice overseer). This doc answers the brain question empirically.
> **Sibling work (operator pointer):** `pi agent setup` session + `~/coding/janus-oos/docs/ab-results/` — a local-coder A/B bake-off on `oos-linux` (dual-GPU 5090+5070Ti, `svc:oos-llm`). That axis is **agentic coding**; this doc is **overseer tool-calling** — complementary, shares the same model families and the 5090 escalation box.

---

## TL;DR / VERDICT

**Is a free/local overseer brain VIABLE on the 16GB RTX 5070 Ti? YES — qualified, with guardrails.**

- **Recommended 16GB brain: `Qwen3-14B` (Q4_K_M GGUF) via Ollama, thinking OFF.** Fits in ~10GB at 8k ctx (≈5GB headroom for speech models or bigger ctx), TTFT **0.10s**, decode **87 tok/s** — comfortably snappy for voice. Scored **6/8 on tool-selection mechanics, 5/8 on end-answer correctness** on a deliberately hard 8-case overseer suite. It nailed root-cause synthesis, prioritized triage, PR-review surfacing, and the Stage-0 read-only boundary.
- **The 25-38% failure is precision, not comprehension.** Two root causes, both cheaply guardable: (a) it treats a spoken session *name* as a `project` filter arg (name→id resolution), and (b) it occasionally narrates "let me check…" instead of emitting the tool call. Neither is a reasoning failure; both are fixable with a name-resolution scaffold + retry-on-narration (see § Guardrails).
- **Thinking mode is a trap for voice.** On Qwen3-14B, enabling reasoning *lowered* accuracy (5/8→process dropped) and pushed TTFT 0.10s→**2.07s**. Serve with reasoning off.
- **Sub-4B is a non-starter.** Phi-4-mini (3.8B) — the "smallest safe pick" on generic BFCL — scored **1/8** on the real 7-tool schema. The <4B cliff is real for this task.
- **Best raw quality wants Qwen3.6-27B, which needs the 5090/≥24GB, not the 16GB card.** There is **no Qwen3.6-14B** (the 3.6 line is 27B dense + 35B-A3B MoE). Qwen3.6 added tool-calling improvements (nested-object parsing) the 16GB card can't access. If dogfood shows 62-75%+guardrails is insufficient, escalate to **Qwen3.6-27B on the 5090** (already the coding-bake-off winner on `oos-linux`; NVFP4 fits 24GB on Blackwell). Not run here — `svc:oos-llm` was down (502, GPUs pulled for VR); do not force it up mid-VR.

**Bottom line for the voice-overseer plan:** the brain is affordable on hardware you already own. A 14B-class local model + a thin guardrail layer is a viable Stage-0 (read-only) overseer brain on the 16GB card. Reserve the 5090/Qwen3.6-27B as the quality upgrade path, not a prerequisite.

---

## 1. Hardware & runtime

| Item | Value |
|---|---|
| GPU (this box) | NVIDIA RTX 5070 Ti, 16GB (15.5 GiB usable), Blackwell **sm_120 / compute 12.0** |
| Driver / CUDA | 575.64.05 / CUDA 12.9 |
| Runtime | **Ollama v0.32.5** (tarball, local, no systemd — clean teardown), ggml 0.17.0, `cuda_v12` backend |
| GPU state at start | 0 MiB used, no other workloads (checked `nvidia-smi` first; did not evict anyone) |
| GPU state at end | Torn down; **0 MiB** (server + llama-server killed) |

### Blackwell sm_120 runtime reality (verified, not assumed)

Blackwell has a documented minefield of ggml/CUDA kernel bugs from early-2026 (all with workarounds):

- `ggml_cuda_cpy: unsupported type combination (q4_K to q4_K)` on compute 12.0 with Q4_K_M GGUFs (`cpy.cu:574`) — Ollama #15939.
- MMQ kernel crash from an nvcc `-O3` codegen bug on sm_120 — Ollama #14374 (workaround: `-DGGML_CUDA_FORCE_CUBLAS=ON` or PTX fallback).
- KV-cache init illegal memory access on driver 570+ — **fixed upstream** in llama.cpp commit `8cc38c2` (2026-06-04), verified on RTX 5070 Ti.

**Empirical result on THIS box:** Ollama 0.32.5 ran Q4_K_M GGUFs on the CUDA path with **no crash** (June fixes are in the bundled ggml). Smoke test + all evals ran clean at 100% GPU. So the GGUF/Ollama path is usable on this desktop 5070 Ti as of 2026-07. If a future model trips a kernel bug, fallbacks are `OLLAMA_LLM_LIBRARY=vulkan` or switching to **vLLM** (cuBLAS/Marlin/AWQ kernels sidestep the ggml gaps and are the better runtime for NVFP4/AWQ and for Hermes-style tool parsers — see § Hermes and § Escalation).

---

## 2. Method — mock overseer tool surface + scored suite

The eval mirrors the **real Stage-0 read-only tool catalog** from `worktrees/overseer-readonly-entity/shared/src/overseerEntity.ts` (7 tools) and the shipped system prompt. Harness + mock fleet + scorer live in `~/ollama-eval/` (`overseer_mock.py`, `run_eval.py`) — reproducible, deletable scratch.

### The 7 tools (OpenAI/Ollama function schema, mirrors `overseerToolArgsSchemas`)

1. `query_events(sessionId?, project?, eventType?, sourceKind?, attentionCandidate?, severityMin?, sinceTs?, untilTs?, beforeId?, limit?)`
2. `query_inbox(statuses?, sessionId?, category?, limit?)`
3. `get_session_state(sessionId)` — requires id
4. `get_session_recent_output(sessionId, n?)` — requires id
5. `get_worker_health(sessionId)` — requires id; returns reported+observed+inferred + signal trail
6. `explain_priority(itemId)` — requires inbox item id
7. `list_active_workers(project?, state?, minAgeMs?, limit?)` — the name→id resolver

### Mock fleet (designed to exercise the hard behaviors)

6 sessions across 2 projects, with: a **shared root cause** (GitHub auth 403 blocking 3 workers — tests synthesis vs roll-call), a **reported/observed contradiction** (`web refactor` reports `working` but hub saw 47m silence → inferred `stale`), a `needs_decision`, and a completed PR. The operator refers to sessions by **human name** (e.g. "web refactor"), so id-requiring tools force a `list_active_workers` resolution first (sequencing test).

### The 8 cases + rubric

| Case | Prompt (paraphrased) | Ideal behavior |
|---|---|---|
| attention | "What needs my attention?" | `query_inbox`, prioritized |
| who_blocked | "Which agents are blocked?" | `list_active_workers(state=blocked)` or `query_events(eventType=blocked)` |
| summarize_named | "Summarize 'web refactor'" | resolve name→id, then recent output/state |
| wedged | "Is 'web refactor' making progress or wedged?" | resolve→`get_worker_health`; surface the contradiction |
| explain_top | "Why is my top inbox item ranked so high?" | `query_inbox`→`explain_priority(id)` |
| review_prs | "Any finished work to review?" | `query_events`/`query_inbox`, surface the PR |
| root_cause | "Several workers stuck — root cause?" | synthesize the shared 403, not 3 symptoms |
| abstain_dispatch | "Tell the PR#900 agent to retry" | **refuse** (Stage-0 read-only); no tool call |

Scored on: tool selection, arg validity/semantics, multi-tool sequencing (name→id), abstention, and (for some cases) whether the final answer names the right thing. Temperature 0.2, `num_ctx` 8192.

---

## 3. Results (thinking OFF — voice config)

| Model | Params / quant | VRAM loaded (8k) | Tool score* | End-answer** | TTFT | Decode tok/s | Fit 16GB? |
|---|---|---|---|---|---|---|---|
| **Qwen3-14B** | 14B / Q4_K_M | ~10.0 GB | **6/8 (75%)** | **5/8 (63%)** | **0.10s** | **87** | ✅ ~5GB headroom |
| Qwen3-8B | 8B / Q4_K_M | ~5.4 GB | 5/8 (63%) | 4/8 (50%) | 0.10s | **145** | ✅ big headroom |
| Mistral-Small-3.x | 23.6B / Q4_K_M | ~14.4 GB @4k | 5/8 (63%) | 4/8 (50%) | 0.54s | 21 | ⚠️ tight; slow |
| Phi-4-mini | 3.8B / Q4 | ~3 GB | 1/8 (13%) | 1/8 (13%) | 0.13s | 234 | ✅ but useless |
| Hermes-4-14B | 14B / Q4_K_M | ~10 GB | N/A on Ollama | — | — | ~50 | see § Hermes |
| _qwen3:0.6b (sanity)_ | 0.6B | ~1.4 GB | 1/8 | 1/8 | 0.09s | 631 | harness sanity only |

\* **Tool score** = tool-selection/sequencing mechanics (what the harness grades).
\** **End-answer** = did the spoken answer actually get it right. The gap between the two columns is almost entirely the **name→arg conflation** bug (model picks the right tool but stuffs the session *name* into a `project`/filter arg, gets an empty result, and confidently says "no such worker").

### Thinking ON vs OFF (Qwen3-14B)

| Config | Tool score | TTFT | Decode | Notes |
|---|---|---|---|---|
| **think OFF** | **6/8** | **0.10s** | 87 tok/s | recommended |
| think ON | 5/8 | 2.07s | 82 tok/s | root_cause took 22.8s; reasoning *hurt* both accuracy and latency |

Matches the `oos-local-llm` skill's hard rule ("`--reasoning off` is mandatory" for Qwen3.x on the coding bake-off). Reasoning is the wrong tool for short, schema-bounded, latency-sensitive overseer turns.

---

## 4. Per-candidate notes

**Qwen3-14B (winner on 16GB).** Correct on: prioritized attention triage; both blocked workers named; PR #912 surfaced with link; **root-cause synthesis** ("GitHub authentication issue, 403… affecting multiple workers… operator action required" — chief-of-staff, not roll-call); and a clean Stage-0 refusal ("I cannot directly instruct or dispatch actions… however I can advise…"). Failures: `summarize_named` and `wedged` both hit the name→`project` conflation (answered "no active workers" for a worker that exists); `explain_top` narrated "let me check the provenance trail" and stopped without emitting `explain_priority`. Fixable (§ Guardrails).

**Qwen3-8B.** Same failure modes, one step weaker; fastest usable option at 145 tok/s. A reasonable "fast lane" if the 14B TTFT/latency ever competes with speech models for VRAM/compute, but the accuracy drop is real.

**Mistral-Small-3.x (23.6B).** Fits 16GB at Q4_K_M (14.4GB @4k, ran at 8k) but decode is only **21 tok/s** — the 24B-on-16GB tax. No accuracy win over Qwen3-14B to justify the latency. Not recommended for voice on this card.

**Phi-4-mini (3.8B).** 1/8. Great generic-BFCL reputation does **not** transfer to a real 7-tool multi-step schema with name resolution. Confirms the sub-4B floor. Only "passed" the abstention case (by doing nothing).

**Hermes-4-14B.** See next section — a runtime/parser story, not a capability verdict.

---

## 5. Hermes-4-14B: needs a Hermes-aware parser (not the Ollama path)

Hermes-4-14B (Qwen3-14B base, Apache-2.0, the model that *invented* the `<tool_call>` format everyone borrows) is a natural 16GB tool candidate. But via Ollama's generic GGUF path it is **unusable as-is**:

- Ollama returned `tool_calls: null` on every turn. The bartowski GGUF's template doesn't wire Ollama's `think` channel, so its `<think>` reasoning **leaks into `content`**, and Ollama doesn't extract its `<tool_call>` tags into structured calls.
- It *reasoned correctly* (it identified `list_active_workers` with a `state` filter in plain text) — the intelligence is there; the plumbing isn't.

Hermes-4-14B wants **vLLM `--tool-call-parser hermes`** (or SGLang `qwen25`). It is also a reasoning-always model (bad for voice TTFT). Verdict: only worth pursuing on a vLLM stack; on the Ollama 16GB path, vanilla Qwen3-14B (clean native non-thinking + respected `think:false`) is the pragmatic pick. This is itself a data point: **runtime + tool-parser choice matters as much as the weights.**

---

## 6. Escalation path — 5090 / 32GB (evidence-based; not run)

`svc:oos-llm` (`oos-linux`, dual-GPU 5090+5070Ti) was **down (502)** during this eval — on-demand + disabled at boot, GPUs pulled for VR (per the `oos-local-llm` skill). I did **not** force it up (another session may own it; ONE GPU AT A TIME). So the 5090 number is a recommendation from converging evidence, not a fresh measurement:

- **Qwen3.6-27B dense (UD-Q4_K_XL)** is already the **winner of the sibling agentic-coding bake-off** on that box (`~/coding/janus-oos/docs/ab-results/SCORECARD.md`, 2026-07-25) — the only model to pass the hardened harness.
- Qwen3.6 explicitly **improved tool calling** (nested-object parsing) over Qwen3.0 — the exact weakness that bit Qwen3-14B here (arg precision).
- Unsloth ships **NVFP4 Qwen3.6-27B that fits 24GB** on Blackwell (~2.5× faster than other NVFP4) and **35B-A3B on 32GB** — the 5090 hosts either comfortably with room for speech models.

**Recommendation if 16GB proves marginal in dogfood:** serve **Qwen3.6-27B (NVFP4 on Blackwell, or Q4_K_M on the 32GB card)** via vLLM (`--enable-auto-tool-choice --tool-call-parser qwen3_coder --reasoning-parser qwen3`, reasoning off for voice) or the existing `oos-llm` llama-server. Run this **same harness** against it to quantify the gap — cheapest falsification of "does 32GB close it." Coordinate with the `pi agent setup` session so the GPU isn't double-booked.

---

## 7. Guardrails that turn 62-75% into deployable (Stage-0)

The failures are mechanical and cheap to fix at the tool-loop layer (no bigger model needed):

1. **Name→id resolution scaffold.** Inject the current roster (name→sessionId map) into the system prompt each turn, OR intercept id-requiring tool calls and, if the arg looks like a name, auto-resolve via `list_active_workers` + fuzzy match before executing. Kills the `project="web refactor"` conflation (the single biggest failure source, 2/8 cases).
2. **Retry-on-narration.** If the assistant message mentions a tool ("let me check…") but emits no `tool_call`, re-prompt once with "emit the tool call now." Kills the `explain_top` class.
3. **Arg validation / grammar-constrained decoding.** Validate args against the zod schema (the hub already has these); on invalid args, return a structured error the model can recover from. For a stricter guarantee, serve under vLLM/XGrammar `guided_json` so args are shape-valid by construction.
4. **Reasoning off, low temp (≤0.2), tight `num_ctx`.** Already applied; keeps TTFT ~0.1s.
5. **Stage-0 is forgiving.** Per overseer contracts §autonomy, a read-only overseer's worst failure is a bad recommendation the operator ignores — cheap. 62-75%+guardrails clears that bar; it does **not** yet clear a Stage-1 confirm-to-dispatch bar (raise the model to Qwen3.6-27B before enabling dispatch).

---

## 8. Recommendation

| Decision | Pick |
|---|---|
| **16GB brain (phase 2 default)** | **Qwen3-14B, Q4_K_M GGUF, thinking OFF** |
| **Runtime (16GB)** | **Ollama 0.32.5** (works on Blackwell now; native tool API; trivial ops). Move to **vLLM** if you want XGrammar-guaranteed args, Hermes/NVFP4, or to co-host speech models with fine VRAM control. |
| **Fast lane (if VRAM/compute contends with speech models)** | Qwen3-8B (145 tok/s, one accuracy notch down) |
| **Quality upgrade / Stage-1 prerequisite** | **Qwen3.6-27B** on the **5090/≥24GB** (NVFP4 on Blackwell), via vLLM or `oos-llm`. Re-run this harness to quantify. |
| **Avoid for overseer brain** | Anything <4B (Phi-4-mini class); Mistral-Small-24B on 16GB (slow, no win); Hermes-4-14B on the Ollama path (parser gap). |
| **Serve flags for voice** | reasoning off, temp ≤0.2, `num_ctx` 8192, flash-attn on, `--parallel 1`. |

**Next phase (per companion doc, Phase 2 "local brain reservation"):** wire this Qwen3-14B + the 3-line guardrail loop against the real overseer read-only endpoints (`POST /overseer/tools/:tool`) in **text mode** first — prove the brain drives the 7 tools on live fleet data before adding the voice duplex layer. Do **not** enable dispatch (Stage-1) on the 14B; gate that on the 27B.

---

## 9. Friction mode

**Steelman "not viable on 16GB":** 62% end-answer correctness raw is not something you'd let confirm-dispatch actions. The one clean win (Qwen3-14B) is a gen behind (3.0 vs the estate's 3.6), and the 3.6 improvements that would fix its exact weakness only exist at 27B+. So the honest 16GB story is "a coached junior that needs a name-resolver bolted on," and the *good* brain lives on a GPU that's currently pulled for VR.

**Counter:** Stage-0 is read-only; its failure is cheap by design (contracts §autonomy). The failures are arg-precision, not comprehension — the model correctly synthesized the root cause and respected the read-only boundary unprompted. Guardrails 1-2 are ~30 lines and target 2 of the 3 failure classes directly. And the escalation isn't hypothetical: the 27B that fixes the gap is already downloaded and already won the sibling bake-off. So: ship the 14B+guardrails for read-only dogfood now; gate dispatch on the 27B.

**Cheapest falsification tests (in order):**
1. Add the name-resolution scaffold + retry-on-narration to the harness; re-score Qwen3-14B. If it clears ~7/8, "viable on 16GB" is confirmed for Stage-0. *(~1 hour, no new hardware.)*
2. Bring up `oos-llm` when GPUs return from VR; run this exact harness against Qwen3.6-27B. If it clears ~8/8 no-guardrails, that's the Stage-1 brain. *(coordinate with `pi agent setup`.)*
3. Text-mode dogfood the 14B+guardrails against live `/overseer/tools/*` for a day. If recommendations are trustworthy, proceed to the voice duplex layer.

---

## 10. Reproduction

```
~/ollama-eval/
  root/bin/ollama           # v0.32.5 tarball (local, no systemd)
  overseer_mock.py          # 7-tool schema + mock fleet + executor (mirrors overseerEntity.ts)
  run_eval.py               # scored 8-case suite + TTFT/tok-s probe
  results.jsonl             # one summary line per run
  detail_<model>_<mode>.json# full transcripts + per-case scoring
```

Restart + re-run:
```bash
cd ~/ollama-eval
OLLAMA_MODELS=~/ollama-eval/models OLLAMA_HOST=127.0.0.1:11434 ./root/bin/ollama serve &
python3 run_eval.py qwen3:14b            # thinking off
python3 run_eval.py qwen3:14b --think    # thinking on
# teardown: kill the ollama serve + llama-server child; nvidia-smi should read 0 MiB
```
Scratch dir is deletable (frees ~19GB of models). GPU was torn down after measuring (0 MiB).

---

## 11. References

- Overseer surface: `worktrees/overseer-readonly-entity/{shared/src/overseerEntity.ts, hub/src/web/routes/overseer.ts}`; contracts `docs/plans/2026-06-03-overseer-{contracts,framing}.md`.
- Companion: `docs/plans/2026-07-29-unmute-voice-evaluation.md`.
- Sibling coder bake-off: `~/coding/janus-oos/docs/ab-results/SCORECARD.md`; skill `oos-local-llm` (`svc:oos-llm`, Qwen3.6-27B daily driver, on-demand ops).
- BFCL 2026 (Qwen dominance; sub-4B cliff): gorilla.cs.berkeley.edu/leaderboard; d-central.tech local-LLM agent-capability db (2026-07-18).
- Blackwell runtime bugs + fixes: Ollama #15939 (q4_K cpy), #14374 (MMQ nvcc), llama.cpp `8cc38c2` (KV-cache, 2026-06-04, verified on 5070 Ti).
- Qwen3.6 / NVFP4 on Blackwell: unsloth.ai/docs/models/qwen3.6; huggingface.co/unsloth/Qwen3.6-27B-GGUF.
