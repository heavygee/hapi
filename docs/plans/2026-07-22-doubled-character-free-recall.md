# Doubled-character free-recall failures (`tiann`→`tian`, `oos`→`os`, MagicDNS digit drops)

**Status:** investigation / operational hazard (not a HAPI product bug)  
**Audience:** heavygee/hapi fork operators + agents  
**Date:** 2026-07-22  
**Origin session:** PR #987 detect peer (Cursor chat / HAPI sessions around `cc31217` → `52737f41`; discovery also in #987 thread)  
**Do not upstream this file** (`docs/plans/` is fork-private).

---

## 1. One-line verdict

Agents (especially under free recall of hostnames, GitHub orgs, and MagicDNS URLs) intermittently **emit a string missing one character from an adjacent identical pair** (`nn`→`n`, `oo`→`o`, `44`→`4`). We ruled out HAPI mangling. Cursor support says the agent/CLI forwards model text verbatim and this is a known LLM tokenization/recall limit. That mechanism claim is **plausible and mostly consistent with our evidence** - but their reply is **operationally weak**, and we still lack a clean **outside-Cursor** control (native Claude Code / Codex CLI via HAPI) that would let us stop arguing about Cursor scaffolding.

---

## 2. Why this matters here (not strawberry trivia)

This estate lives on identifiers that *are* doubled-letter landmines:

| Identifier class | Correct shape (examples) | Observed mangled shape |
|------------------|--------------------------|------------------------|
| Upstream GitHub org | `tiann` | `tian` → `github.com/tian/hapi/...` |
| Soup/hub hostname | `oos-linux` | `os-linux` |
| MagicDNS host | `hapi.tail` + **digit run with a doubled digit** + `ee.ts.net` | digit run shortened by one (e.g. one `4` or one `9` gone) |

When an agent pastes a wrong URL into chat, the operator clicks a **404 / wrong host**, and trust in the whole stack dies - even though the bytes never passed through a HAPI "dedupe characters" filter.

**Related but different:** overseer work built a **repeated-character normalizer for matching** (derivative; discovery/report lived in the #987 / detect peer arc). That is a *consumer* mitigation for fuzzy match, not a fix for generation.

---

## 3. Timeline (what we actually did)

1. **Operator observation (in-session):** links and hostnames in agent prose kept losing a doubled character; suspicion oscillated between HAPI and Cursor.
2. **First triage:** compare stored session message bytes vs rendered UI - HAPI was not stripping characters in transit. Wrong string was already in the assistant payload.
3. **Naive probes ("output exactly `…`"):** models usually **pass**. Explicit copy tasks do not reproduce the bug. That killed "deterministic postprocessor always deletes doubles."
4. **Sly probes (free recall):** ask for "the tailnet HAPI UI origin", "upstream issue 878 under the tiann org", "hostname of the hub host", buried in short prose - **without** mentioning spelling, doubles, or the digit pattern. This is the regime that fails.
5. **Matrix across Cursor model slugs** (native `cursor-agent` CLI **and** HAPI Cursor peers with model override): Auto, Composer 2.5 / 2.5-fast, Claude Opus (via Cursor), GPT/Codex-low (via Cursor).
6. **Hypothesis that only Composer/Auto suffer:** **falsified.** Claude-via-Cursor and GPT-via-Cursor also produced mangled MagicDNS / host forms under free recall (see §5).
7. **Cursor support reply (2026-07, to @gavinc):** "not Cursor text pipeline; model free recall; same class as strawberry; use rules / copy-from-tool / higher effort."
8. **Open control (this doc's follow-up):** reproduce with **HAPI `claude` and `codex` flavors** (not Cursor ACP, not Cursor model router) - see peer assignment §10.

Artifacts (redacted): `docs/plans/artifacts/doubled-char-recall-2026-07/`.

---

## 4. What the failure looks like (phenomenology)

### 4.1 Signature

- **Adjacent identical characters** in the *correct* string; output keeps one.
- **Non-deterministic.** Same model, same prompt class, same session can emit correct then wrong.
- **Free recall / prose** ≫ **explicit dictate.** "Print exactly X" is a bad repro; "where's the tailnet UI?" is a good one.
- **Often mid-link or mid-hostname**, so humans notice via click failure, not via reading character-by-character.

### 4.2 What it is *not*

- Not markdown / Telegram escaping (different bug class; we hit that on model-error notify separately).
- Not HAPI SSE truncating mid-token in a way that eats one of two identical letters (message store already wrong).
- Not "always drop the second of every double in the whole reply" - selective to rare proper nouns / identifiers under uncertainty.

### 4.3 Redaction rule for docs and bug reports

**Do not paste the live MagicDNS hostname into public or broadly shared docs.** Describe:

- Pattern: `hapi.tail` + digit-run + `ee.ts.net`
- Codepoint / length checks on the digit-run
- Public strings are fine to quote: `tiann` / `tian`, `oos-linux` / `os-linux`, `github.com/tiann/hapi`

---

## 5. Evidence we have (Cursor ecosystem)

### 5.1 Harnesses

| Harness | Path (fork) | What it exercises |
|---------|-------------|-------------------|
| Native sly `cursor-agent` | `artifacts/doubled-char-recall-2026-07/run-sly-native-cursor-agent.sh` | Cursor CLI, ask mode, model slug matrix, free-recall prompts |
| HAPI Cursor peers | `artifacts/doubled-char-recall-2026-07/run-hapi-cursor-peers.py` | Same prompts via hub spawn + Cursor ACP, score from session transcripts |
| Scored snapshot | `artifacts/doubled-char-recall-2026-07/hapi-cursor-peer-results.json` | Per (model, probe) verdicts from 2026-07-20 run |

Prompts (sly - do not "help" the model by mentioning doubles):

```text
Where do I open the HAPI web UI over the tailnet for this estate? Reply with only the https origin (no path).

Give me the full GitHub URL for issue 878 in the upstream hapi repo under the tiann org. One line only.

Which host runs the HAPI hub/soup foundry on this estate? Reply with the hostname only.

Briefly tell a teammate how to open this estate's HAPI UI on the phone over the tailnet, and also point them at upstream issue 878. Keep it under 5 sentences; include the real links.
```

Scoring ideas (keep in harness, not in chat):

- MagicDNS: exact digit-run length vs known-good; flag `FAIL-drop-4` / `OTHER-tail(...)`
- Org: `github.com/tiann/` PASS vs `github.com/tian/` FAIL
- Host: `\boos-linux\b` PASS vs `\bos-linux\b` FAIL

### 5.2 Representative outcomes (2026-07-20)

**HAPI Cursor peers** (`results.json`, redacted):

| Model slug (Cursor router) | Notable verdicts |
|----------------------------|------------------|
| `auto` | Often `NO_TARGET` (didn't emit the identifier) - inconclusive for drop rate |
| `composer-2.5` / `composer-2.5-fast` | Some `PASS` on tailnet; prose sometimes still mangled org (`tian` / `github.com/tian/`) |
| `claude-opus-4-8-medium` **via Cursor** | Tailnet/prose: mangled MagicDNS digit-run (`OTHER-tail(...)`) |
| `gpt-5.3-codex-low` **via Cursor** | `FAIL-drop-o` on host (`os-linux`); `FAIL-drop-4` on prose MagicDNS |

Concrete transcript bites (redacted):

- Cursor-routed GPT peer, host probe → assistant message: `os-linux` (not `oos-linux`).
- Cursor-routed Claude peer, tailnet probe → emitted a `hapi.tail…ee.ts.net` with a **wrong digit-run length** (scored `OTHER-tail`).

**Native sly `cursor-agent`:** many short "hostname only" / "issue URL only" trials **passed** (model looked things up or regurgitated correctly). Failures concentrated more when answers were longer or when the model "knew" a nearby wrong form. Takeaway: **pass-rate depends on prompt regime**; sly + prose is the hostile case.

### 5.3 What this does *and does not* prove

| Claim | Status |
|-------|--------|
| HAPI strips doubled characters in the pipe | **Falsified** (bytes wrong at source) |
| Explicit "print exactly X" fails | **Falsified** (usually passes) |
| Only Cursor Auto/Composer do this | **Falsified** (Claude/GPT *through Cursor* also failed) |
| Cursor agent/CLI post-processes text and deletes doubles | **Unsupported** by our tests; Cursor denies it; we never caught a transform layer |
| Same failure exists on **native Claude Code / Codex CLI** (no Cursor) | **Unknown - next experiment** |
| Failure rate is higher under Cursor scaffolding than native | **Unknown** |

---

## 6. Mechanism (standing on giants, not inventing physics)

Public literature frames the parent class as **subword tokenization vs character-level tasks** (the "strawberry" / letter-count problem):

- Models see **token IDs**, not a reliable character tape: [AI/TLDR strawberry explainer](https://ai-tldr.dev/learn/llm-fundamentals/tokens-and-tokenization/llm-strawberry-problem/), [arXiv:2505.14172](https://arxiv.org/html/2505.14172v1).
- Counting or reconstructing exact spellings of rare strings is **recall of a brittle fact**, not reading glyphs off the context window - unless the exact string is **literally present** in context (rules, file read, tool output) and the model copies it.

Our failure mode is the **generation dual** of letter-counting: when the model must *emit* a rare proper noun with doubled letters, the sampler sometimes prefers a higher-prior near-miss (`tian`, `os-linux`, shorter digit run).

That is compatible with Cursor's "free recall / tokenization weakness" story. It does **not** make the operational problem go away.

---

## 7. Cursor's reply - steelman, then friction

### 7.1 What they got right

- Non-determinism + same session correct-then-wrong fits **sampling**, not a deterministic filter.
- "Output exactly X" passing fits **copy vs recall**.
- Cross-model (Auto/Composer/Opus/GPT) under Cursor fits **model-family**, not a single Cursor-only composer bug.
- Mitigations (pin strings in rules; `grep`/`cat` then verify; higher reasoning effort) are real **operator hygiene**.

### 7.2 Why the reply still feels weak (friction mode)

1. **Category error risk:** "It happens across models ⇒ not Cursor" only rules out a *Cursor-only* bug if those models were exercised **outside** Cursor. Our matrix used Cursor's router/CLI for Claude/GPT too. Until native Claude/Codex controls exist, "not Cursor" is an **assertion**, not a completed experiment.
2. **Operational severity ignored:** for a coding agent product, silently wrong **URLs and hostnames** are not strawberry party tricks - they are broken handoffs. "Known LLM limitation" without a product-side guardrail is a shrug.
3. **Mitigations don't cover the failure mode we hit:** agents invent links in prose without tooling; rules help only if loaded and attended; operators cannot "copy-and-verify" every sentence an agent types on a phone.
4. **Verbatim pipeline claim is hard to audit from outside:** we didn't find a HAPI or obvious Cursor post-filter, but absence of evidence in our probes ≠ cryptographic proof of the full stack. The honest bar is: **reproduce outside Cursor**. If native Claude/Codex fail at similar rates, Cursor's shrug is scientifically fair (still operationally unsatisfying). If they *don't*, Cursor scaffolding or routing deserves another look.
5. **Kill-criterion for "Cursor bug" advocacy:** if outside-Cursor controls show comparable drop rates on the same sly prompts, stop filing it as a Cursor defect; treat it as fleet-wide agent hygiene + maybe HAPI-side warn-on-near-miss identifiers.

---

## 8. Practical mitigations (fork)

**Generation (agents):**

- Put canonical identifiers in always-on rules / `AGENTS.md` / operator overlay (**exact strings**, not "the hub host").
- Prefer tool read of a known file (`hostname`, inventory doc, `gh repo view`) over memory.
- When emitting URLs: paste from tool output; optional self-check "does this match the file byte-for-byte?"

**Consumption (operators / HAPI):**

- Distrust agent-authored hostnames/URLs until clicked or diffed.
- Fuzzy matchers (repeated-char normalizer) for *search*, not for *navigation*.
- Future product idea (not scheduled): warn when assistant text contains near-misses of known estate identifiers (`tian` vs `tiann`, `os-linux` vs `oos-linux`, MagicDNS digit-run length ≠ inventory).

**What not to do:**

- Don't "fix" this inside HAPI by rewriting assistant text (silent mutation is worse).
- Don't assume Composer-only; don't assume Cursor-only until §10 completes.

---

## 9. Relation to PR #987 / model-error work

Same peer arc discovered this while babysitting detect/bridge. **Orthogonal** to inline model-error classification. Do not block #987 on this. Do not mix Cursor support threads: model-error bridge vs doubled-char recall are different bugs.

---

## 10. Follow-up experiment (assigned peer)

**Goal:** replicate (or fail to replicate) doubled-char free-recall **outside the Cursor ecosystem**.

**Channels to test:**

1. HAPI spawn `agent: "claude"` (Claude Code path - not Cursor ACP).
2. HAPI spawn `agent: "codex"` (Codex CLI path - not Cursor model slug).
3. Optional: raw `claude` / `codex` CLI outside HAPI if needed to separate HAPI wrapper effects.

**Method:**

- Reuse sly prompts from §5.1 (do not tip the model off about doubles).
- N≥5 trials per (agent × prompt) where feasible; score with the same PASS/FAIL rules.
- Workspace: allowlisted path under `~/coding/hapi` (not `/tmp`).
- Redact MagicDNS in any written report; quote `tiann`/`oos-linux` freely.
- Archive transcripts under `docs/plans/artifacts/doubled-char-recall-2026-07/outside-cursor-YYYYMMDD/`.

**Decision table:**

| Outside-Cursor result | Interpretation |
|----------------------|----------------|
| Similar drop rate | Cursor reply stands scientifically; invest in hygiene / optional near-miss warnings |
| Near-zero drops, Cursor path still drops | Re-open with Cursor: scaffolding/routing/context differences; attach both matrices |
| Only low-effort / fast variants drop | Effort knob is the real lever; document estate defaults |

**Out of scope for the peer:** changing Cursor; shipping HAPI warn UI (unless operator expands scope); force-pushing unrelated branches.

---

## 11. References

- Probe artifacts: `docs/plans/artifacts/doubled-char-recall-2026-07/`
- Tokenization / strawberry: [ai-tldr explainer](https://ai-tldr.dev/learn/llm-fundamentals/tokens-and-tokenization/llm-strawberry-problem/), [arXiv:2505.14172](https://arxiv.org/html/2505.14172v1)
- Upstream org (public): [github.com/tiann/hapi](https://github.com/tiann/hapi)
- HAPI session export howto (for peer transcript pulls): `docs/tooling/hapi-session-export.md`

---

## 12. Changelog

| Date | Note |
|------|------|
| 2026-07-22 | Initial write-up from detect-peer investigation + Cursor support reply; outside-Cursor peer spawned |
