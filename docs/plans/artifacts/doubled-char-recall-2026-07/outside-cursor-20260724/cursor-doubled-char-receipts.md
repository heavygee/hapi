# Doubled-character drop: it reproduces in Cursor, not in the same models run directly

**Prepared for:** Cursor support / eng
**Date:** 2026-07-24
**Note on identifiers:** the tailnet hostname below (`hapi.tail7733ee.ts.net`) is a **fabricated stand-in** with the same doubled-character shape as our real one (a doubled digit pair + doubled `e`). We can't share the live host; the fabrication reproduces the identical hazard. `tiann` and `oos-linux` are real, public strings.

---

## The claim (precise)

Your support reply was, in effect: *"agents forward model text verbatim; dropping a character from a doubled pair (`tiann`→`tian`, `oos-linux`→`os-linux`, a shortened MagicDNS digit-run) is a known LLM tokenization/recall limit — all models do it, so it isn't Cursor."*

We ran the **same underlying models directly, outside Cursor**, on the same class of prompts. We could **not** reproduce the drop:

- **Native Claude (Opus 4.8)** and **native Codex (codex-cli 0.145.0)**, via the Anthropic/OpenAI CLIs — no Cursor router, no Composer, no ACP.
- Across recall, copy, and distance-recall regimes: **0 doubled-character drops in ~127 emissions.**

The model family is held constant. If this were purely "how the model works," native Claude should drop at a similar rate to Claude-via-Cursor. It doesn't. **That points at something in the Cursor layer, not the model.**

---

## The strongest experiment: distance-recall (fully reproducible, receipts below)

This is the regime that matches how your agent actually holds an identifier — given earlier in the session (rules / chat history), then re-emitted later in prose. Per fresh session, no tools:

1. **Seed:** "Note these exactly, I'll ask later: UI `https://hapi.tail7733ee.ts.net`, upstream `github.com/tiann/hapi`, hub host `oos-linux`. Reply `ack`."
2. **Distractor:** one unrelated arithmetic turn (adds distance + working-memory load).
3. **Prose recall:** "From memory, don't re-read above, no tools — write a 4-6 line onboarding note giving the UI URL, the hub host, and the upstream repo URL."
4. **Code recall:** "Still from memory — a 3-line bash snippet that curls the UI, echoes the hub host, echoes the upstream URL."

Every re-emission in turns 3 & 4 is counted faithful vs mangled.

### Result

| Model (run directly, no Cursor) | Sessions | Faithful emissions | **Doubled-char drops** |
|---------------------------------|----------|--------------------|------------------------|
| Claude Opus 4.8 (Claude Code CLI) | 8 | 52 | **0** |
| Codex (codex-cli 0.145.0) | 8 | 48 | **0** |

100 faithful re-emissions of `hapi.tail7733ee.ts.net` / `tiann` / `oos-linux`, zero drops.

### Verbatim receipts (unedited model output)

**Claude, prose turn:**
```
**Onboarding note — HAPI quick start**
- **Web UI (tailnet):** Open https://hapi.tail7733ee.ts.net in your browser while connected to the tailnet.
- **Hub host:** The hub runs on **oos-linux**.
- **Upstream project:** Lives at **github.com/tiann/hapi** — that's where upstream `main` and PRs live (our fork tracks it).
```
**Claude, code turn:**
```bash
curl -sSf https://hapi.tail7733ee.ts.net
echo "oos-linux"
echo "github.com/tiann/hapi"
```

**Codex, prose turn:**
```
Open the HAPI UI over the tailnet:
https://hapi.tail7733ee.ts.net
The hub runs on host `oos-linux`.
Upstream project:
https://github.com/tiann/hapi
```
**Codex, code turn:**
```bash
curl https://hapi.tail7733ee.ts.net
echo oos-linux
echo https://github.com/tiann/hapi
```

Both models reproduce `7733` (doubled 7, doubled 3), `ee`, `tiann` (doubled n), and `oos` (doubled o) correctly, repeatedly, in two different generative modes.

---

## Supporting arms (same conclusion)

| Arm (native, no Cursor) | N | Result |
|-------------------------|---|--------|
| Recall of `tiann` (no spelling given) | 11 | 11/11 correct `tiann`, 0 `tian` |
| Copy of the doubled-digit host into prose | 8 | 8/8 correct digit-run |
| Distance-recall (above) | 16 sessions | 100/100 emissions faithful |

One behavioral note that we think is a direct clue for you (next section): when we asked native **Claude** to recall an identifier it genuinely did **not** know, it **abstained** — *"I don't have that memorized reliably; a guessed origin is worse than none."* It refused to emit a near-miss. Native **Codex** instead **confabulated a plausible wrong hostname**. Neither dropped a doubled character.

---

## Contrast with Cursor (our earlier matrix, same prompts)

Running the *same model families through Cursor* (Composer/Auto, Claude-via-Cursor, GPT/Codex-via-Cursor), on the same sly prompts:

- Composer prose: `github.com/tian/…` (dropped the doubled `n`).
- GPT/Codex-via-Cursor: `os-linux` (dropped a doubled `o`) and a MagicDNS with a **short digit-run** (dropped a doubled digit).
- Claude-via-Cursor: MagicDNS emitted with a **wrong digit-run length**.

Same models. The drop appears through Cursor and not when the model is driven directly.

---

## Where we think you should look

Because the *model is constant*, the delta is in Cursor's layer. Concrete places, roughly in order of our suspicion:

1. **Context assembly / compaction.** If the identifier lives in project rules or earlier chat and your pipeline **summarizes, truncates, or re-tokenizes** that context before the model regenerates from it (rather than the model copying from a verbatim live buffer), a doubled character is exactly what gets lost. Check whether the exact string survives byte-for-byte into the prompt the model actually sees at generation time.
2. **Scaffolding that suppresses "I don't know."** Native Claude *abstains* when unsure; the Cursor-routed Claude *confabulated a mangled string*. That strongly suggests your system prompt / agent harness pressures a confident, terse answer and discourages abstention — turning "I'm not sure" into a near-miss. Compare your Composer/Auto system prompt against this behavior.
3. **Sampling params.** Confirm the temperature / top-p / reasoning-effort you pass for "Claude via Cursor" and "Codex via Cursor" match the providers' defaults. Higher temperature increases near-miss substitution of rare tokens (a doubled-pair token vs its single-char neighbor). Our native runs were default-effort.
4. **Routing/version drift.** Verify the exact model + version you route to is the one you name in the UI, with the same tokenizer.

## The apples-to-apples ask

Please run the **distance-recall protocol above** inside Cursor (Composer, Auto, Claude, and your Codex route), N≥8 each, and report the per-emission drop rate. Our harness and full data are attached. If your rate is ~0 too, we'll happily close this. If it isn't, the gap is in one of the four places above — and we'd like to fix the operator experience together.

---

*Reproduction harness and machine-readable results accompany this note (`run-recall-distance.py`, `recall-distance-results.json`, `recall-distance-rollup.json`). All runs used fresh, isolated sessions that were deleted after scoring.*
