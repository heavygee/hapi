# Reply to Mohit — AS POSTED 2026-07-24

> Sanitized. The tailnet hostname used in the proof set (`hapi.tail7733ee.ts.net`) is a **fabricated stand-in** with the same doubled-character shape as our real one; `tiann` and `oos-linux` are real public strings.
> Receipts (harness + data) were **not** attached to the post — held back until Cursor asks. Send-on-request bundle staged (see `SEND-BUNDLE.md`).

------

Hey Mohit - appreciate the detailed reply. I conced you're right on several points, I'll try and be fair about them before I push back:

- **Non-determinism** (same session correct-then-wrong) and **"output exactly X" passing** are both consistent with sampling/recall. Yep, agreed.
- I'm **not** claiming Cursor's code edits or de-dupes bytes. I accept the model generates the wrong string; nothing in the CLI/agent path is rewriting text.

But the core of your argument — *"it happens across Auto/Composer/Opus/GPT alike, and a Cursor-side bug wouldn't vary by model, therefore it's the model, not Cursor"* - that doesn't really hold, in my day to day experience, so I "know" it's not right, so I went away to make a control experiment to show why.

## The logic gap

"Varies across models ⇒ not Cursor" only rules out a bug in a **model-specific** code path (e.g. a Composer-only bug). I believe it does **not** rule out a factor in the **shared layer that sits in front of every model you route** - context assembly, the agent/system scaffolding, and your default sampling/effort settings. Those apply uniformly to Auto/Composer/Opus/GPT, so they'd produce exactly the "model-agnostic" pattern you're pointing at. Basically, cross-model variance is evidence against a *per-model* bug - not evidence against a *Cursor-layer* cause.

The only test that separates "the model does this regardless" from "Cursor's shared layer induces it" is running **the same models outside Cursor**. That was the missing control, so I went ahead and ran the thing.

## The data (same models, driven directly - without Cursor)

Claude Opus 4.8 (Anthropic's CLI) and OpenAI's Codex (`codex-cli 0.145.0`), driven directly with no Cursor router/Composer/ACP, on the same class of sly prompts:

| Regime | Trials | Doubled-char drops |
| :--- | :--- | :--- |
| Free recall of a known doubled-letter string (`tiann`) | 11 | **0** |
| Copy a doubled-character host into prose | 8 | **0** |
| **Distance-recall** (string given earlier in session → distance → regenerate in prose from memory) | 100 emissions | **0** |

**Over 125 emissions of `tiann` / `oos-linux` / a doubled-digit hostname, zero drops.** The distance-recall arm is the important one: it reproduces the exact situation the agent is in - the identifier lives earlier in the session (rules/history) and the model regenerates it later in prose under load. Verbatim, unedited receipts (fabricated host so I can share):

**Claude:** `https://hapi.tail7733ee.ts.net` … `oos-linux` … `github.com/tiann/hapi`
**Codex:** `https://hapi.tail7733ee.ts.net` … `oos-linux` … `https://github.com/tiann/hapi`

Both models reproduce the doubled `7`, `3`, `e`, `n`, and `o` faithfully, repeatedly, in both prose and code. Through Cursor, the same model families gave us `github.com/tian/…`, `os-linux`, and a MagicDNS with a short digit-run.

Model held constant. The drop appears through Cursor and not when the model is driven directly.

## On the "strawberry" framing

I believe 'Strawberry' is a **counting** task (how many r's) - a hard character-level operation. **Reproducing a string you were just given is not that** tho - and your observation that "output exactly X" passes proves the model represents these characters fine. If this were the strawberry tokenization weakness, exact-copy would fail too. Since it doesn't, I reckon that means the failure isn't "the model can't handle doubled characters"; it's "under some condition, the string the model regenerates isn't faithful to the one it was given." That condition is what differs between native and Cursor.

## Your suggested mitigations turned out to be clues

- **"Keep identifiers in a rule/AGENTS.md so they sit where the model generates."** I do - and my distance-recall test literally seeds the string in-context and asks the model to regenerate it. Native reproduces it 100/100. So "the string is in context" is **not** sufficient to cause the drop natively. What happens to that string inside Cursor's context pipeline before the model generates from it?
- **"Higher reasoning-effort variants are less prone."** This is the tell. If a knob **you** control (effort / model-variant defaults) changes the drop rate, it isn't an immutable tokenization limit - it's a configuration outcome. Our native runs were **default effort** and still hit zero. That squarely implicates Cursor's defaults.
- **copy-and-verify** helps an operator, but it concedes the raw output isn't trustworthy and can't be applied to every sentence an agent emits.

## Where I'd request your folks to have a look (given the model is constant)

1. **Context assembly / compaction** - does the exact identifier survive byte-for-byte into the prompt the model actually sees at generation time, or is it summarized/truncated/re-tokenized first? A dropped doubled char is exactly what that loses.
2. **Scaffolding that suppresses "I don't know."** Direct clue: native **Claude abstains** when it isn't sure ("a guessed origin is worse than none"); Cursor-routed Claude **confabulated a mangled string** instead. That suggests your harness/system prompt pressures a confident, terse answer over abstention - turning "unsure" into a near-miss.
3. **Sampling defaults** - confirm temperature/top-p/effort for your Claude and Codex routes match provider defaults; higher temperature increases near-miss substitution of rare tokens.
4. **Routing/version "drift"** - is the routed model+version+tokenizer the one named in the UI?

## The request

Run this exact distance-recall protocol inside Cursor (Composer, Auto, Claude, your Codex route), N≥8 each, and share your per-emission drop rate. I can send the harness and full data - just ask. If you come back at ~0 too, I'll happily close this. If you don't, the gap is in one of the four places above - and I'd genuinely like to fix the operator experience with you vs argue the point, it's a constant annoyance on my side.

Thanks,
Gavin
