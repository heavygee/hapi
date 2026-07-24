# Outside-Cursor doubled-char control — results

**Status:** experiment complete (the §10 follow-up of the parent doc)
**Audience:** heavygee/hapi fork operators + agents
**Date:** 2026-07-24
**Parent:** [`2026-07-22-doubled-character-free-recall.md`](2026-07-22-doubled-character-free-recall.md) (read §5, §7, §10 first)
**Do not upstream** (`docs/plans/` is fork-private).
**Redaction:** the live tailnet MagicDNS digit-run is never written here; it shows as `<Nd>` (N = digit-run length; the correct length is 4). Public strings (`tiann`, `oos-linux`, `github.com/tiann/hapi`) are quoted freely.

---

## 0. TL;DR

Ran the missing control: the **native HAPI agent flavors `claude` (Opus 4.8) and `codex` (codex-cli 0.145.0)** — no Cursor ACP, no Cursor model router — against the sly free-recall / copy probes.

**27 native trials, ZERO doubled-character drops.** Neither flavor produced `tian`, `os-linux`, or a shortened MagicDNS digit-run in any regime we could exercise. This is in sharp contrast to the Cursor matrix (§5 of parent), where Claude-via-Cursor and GPT/Codex-via-Cursor produced mangled MagicDNS / host / org strings.

Two important qualifiers keep this honest:

1. The single sharpest failure in the Cursor matrix — a shortened **MagicDNS digit-run** — is a recall failure of an *estate-private* string. A fresh native peer **does not know that string at all**, so it cannot exhibit the "know-it-and-slip" drop; instead Claude **abstains** ("I don't have it memorized") and Codex **confabulates a wholly different hostname** (`hapi.heavygee.ts.net`, etc.). Neither is a doubled-char drop, but neither is the same knowledge state as the Cursor peers either. The clean same-regime comparisons we *could* run natively are `tiann` recall and MagicDNS **copy** — native passes both; Cursor failed both.
2. The result is regime-bounded, not a universal "native never drops." It says: **in the regimes we could match, native Claude/Codex did not reproduce the Cursor drops.**

**Verdict:** the "all models do it ⇒ not us" shrug does **not** survive as stated. It maps to §10 row 2 (*near-zero native drops, Cursor path drops ⇒ re-open with Cursor on scaffolding/routing/context*), qualified by point (1). See §6.

---

## 1. What changed vs the parent's planned method

The parent §10 assumed we could reuse the Cursor sly prompts verbatim. Two things forced a redesign, both discovered during smoke:

### 1.1 Native agents are tool-users → they look up, they don't recall

First smoke (`claude`, tailnet probe, tools allowed): the agent **launched the `accessible-systems` skill**, read `NETWORK.md`, and returned the correct origin. That is the §8 *mitigation working* (prefer tool read over memory) — **not** the failure mode. A tool-using agent that looks the answer up can never exhibit a recall drop.

**Fix:** every probe forbids tools ("Answer from memory only. Do NOT run any command, read any file, launch any skill, or use any tool"). This forces the hostile **pure-recall** regime.

### 1.2 The Cursor `issue` probe leaked the spelling

The parent's issue probe said *"…under the **tiann** org."* That hands the model the correct doubled-`n` spelling in the prompt — a **copy** test, not recall. Our `issue_recall` probe removes the spelling ("the original project by its author") so the model must recall that the org is `tiann`.

### 1.3 Estate-private strings aren't valid *recall*-drop probes for fresh peers

`oos-linux` and the MagicDNS are not in model training and not in a fresh peer's auto-loaded context (verified: `tail<Nd>` appears in **no** auto-loaded rule file; `oos-linux` only in `docs/operator/AGENTS.md`, which is linked but not auto-injected). A fresh peer therefore *can't* slip on them — it lacks them. The doubled-char drop requires the string to be approximately known. So the arms became:

| Arm | Tests | Why it's valid |
|-----|-------|----------------|
| `issue_recall` | recall of `tiann` (a doubled-`n` string in training) | model plausibly knows it → real recall-drop test |
| `magicdns_copy` | copy of the supplied doubled-digit MagicDNS, restated in prose | §6-of-parent's "string in context ⇒ copy" claim; directly comparable to Cursor's mangled MagicDNS |
| `tailnet_recall` | recall of the unknown estate-private MagicDNS | measures abstain-vs-confabulate (a behavioral finding, not a drop test) |

Auto-load contamination note for `issue_recall`: `tiann` **is** present in `CLAUDE.md` (auto-loaded for the `claude` flavor) but **not** in root `AGENTS.md` (what `codex` reads). So `claude` could in principle copy `tiann` from context; `codex` is a clean recall of training knowledge. Both passed 100%, so the distinction didn't change the outcome.

---

## 2. Method

- **Channels:** HAPI hub spawn (`POST /api/machines/{id}/spawn`) with `agent: "claude"` and `agent: "codex"`, `yolo: true`, `sessionType: "simple"`, workspace `/home/heavygee/coding/hapi`. **No Cursor** anywhere.
- **Isolation:** one probe per **fresh** session (independent samples; avoids within-session contamination where a later probe copies an earlier answer).
- **Scoring** (same PASS/FAIL family as the Cursor harness, digit-run by *length*):
  - `issue`: `github.com/tiann/` = PASS; `github.com/tian/` = FAIL-drop-n.
  - `tailnet`/`copy`: MagicDNS digit-run length == 4 (correct) = PASS/URLok; < 4 = FAIL-drop; wrong-but-right-length / longer = OTHER; abstention = ABSTAIN.
- **Redaction:** the live host is read from `$HAPI_PUBLIC_URL` at runtime (never hardcoded in the committed harness). Raw transcripts go to `/tmp` only; the committed dir gets length-redacted digests.
- **Harness:** [`artifacts/doubled-char-recall-2026-07/outside-cursor-20260724/run-outside-cursor-peers.py`](artifacts/doubled-char-recall-2026-07/outside-cursor-20260724/run-outside-cursor-peers.py)
- **Codex availability:** `codex` was **not installed** on the driver at first (spawn → `ENOENT`); the operator installed `@openai/codex` (codex-cli 0.145.0) and authed it, after which the codex arm ran cleanly.

---

## 3. Results matrix

| Flavor | Probe | N | Verdicts | Doubled-char drops |
|--------|-------|---|----------|--------------------|
| `claude` | `issue_recall` (recall `tiann`) | 6 | PASS ×6 | **0** |
| `claude` | `magicdns_copy` (copy doubled-digit host) | 4 | URLok/ORGok ×4 | **0** |
| `claude` | `tailnet_recall` (recall private MagicDNS) | 4 | ABSTAIN ×4* | **0** (0 confabulations) |
| `codex` | `issue_recall` (recall `tiann`) | 5 | PASS ×5 | **0** |
| `codex` | `magicdns_copy` (copy doubled-digit host) | 4 | URLok/ORGok ×4 | **0** |
| `codex` | `tailnet_recall` (recall private MagicDNS) | 4 | NO_TARGET ×4† | **0** (0 doubled-char drops) |

\* All four `claude` tailnet answers were honest non-answers ("I don't have that memorized… a guessed origin is worse than none"); one was scored `NO_TARGET` only because its phrasing missed the abstain regex — its text is an abstention too.
† All four `codex` tailnet answers **confabulated a plausible but wrong hostname** (`hapi.heavygee.ts.net`, `hapi.gavin-coyle.ts.net`, `hapi.tailnet-1d4a.ts.net`) — a whole-label fabrication, **not** a doubled-char drop.

**Aggregate: 27 native trials, 0 doubled-character drops.**

Redacted transcripts: [`.../outside-cursor-20260724/transcripts-redacted.md`](artifacts/doubled-char-recall-2026-07/outside-cursor-20260724/transcripts-redacted.md). Scored data: `outside-cursor-results.json` / `outside-cursor-rollup.json` in the same dir.

---

## 4. The behavioral split (Claude vs Codex on unknown strings)

Same probe (recall an estate-private MagicDNS the model does not know), two different native behaviors:

- **Claude Opus 4.8 → abstains.** "I don't have that memorized reliably… I'd be guessing." It refuses to emit a hostname it can't stand behind. This is the *opposite* of the doubled-char failure (which is confident emission of a near-miss).
- **Codex → confabulates.** It emits a confident, plausible-looking but entirely wrong hostname with no hedge.

Operationally this matters: a Codex agent will hand you a wrong URL *and sound sure*, whereas native Claude tells you it doesn't know. Neither drops a doubled char — but Codex's confabulation is arguably the more dangerous handoff failure, just via a different mechanism.

---

## 5. What this does / does not prove (updates parent §5.3)

| Claim | Status after this control |
|-------|---------------------------|
| Native Claude/Codex reproduce the doubled-char drop on `tiann` recall | **Falsified** — 11/11 PASS across both flavors |
| Native Claude/Codex mangle a supplied doubled-digit MagicDNS when copying | **Falsified** — 8/8 faithful, correct digit-run |
| Native agents drop the MagicDNS under *recall* like Cursor did | **Not testable as-is** — fresh peers lack the string; Claude abstains, Codex confabulates a different name |
| "All models do this in these regimes ⇒ not Cursor" | **Unsupported** — in every regime we could match, native did not drop |
| The Cursor drops were higher than native under comparable regimes | **Supported (qualified)** — native 0 drops where Cursor dropped, but the sharpest Cursor case (MagicDNS recall) has no clean native analog |

---

## 6. §10 decision table — filled in

| Outside-Cursor result | Interpretation | **Observed?** |
|----------------------|----------------|---------------|
| Similar drop rate | Cursor reply stands; invest in hygiene / near-miss warnings | **No** |
| Near-zero native drops, Cursor path still drops | Re-open with Cursor: scaffolding / routing / context differences; attach both matrices | **YES (primary)** — 0/27 native vs Cursor drops on `tiann`/host/MagicDNS |
| Only low-effort / fast variants drop | Effort knob is the real lever | Not isolated here (native runs were default-effort; all passed) |

**Chosen row:** *near-zero native drops → re-open with Cursor*, with the qualifier from §0/§5: the MagicDNS-recall regime could not be reproduced natively because fresh peers don't hold the string. The defensible push-back to Cursor is: **on the strings a model can actually recall (`tiann`) and on faithful copy of a doubled-digit host, native Claude and native Codex do not drop — Cursor-routed Claude and Codex did.** That points at scaffolding / context / routing, not an inherent, universal model limitation.

---

## 7. Recommended next moves (not auto-executed)

1. **Push back to Cursor** with both matrices attached: native `tiann` recall (0 drops) + native MagicDNS copy (0 drops) vs the Cursor `tian` / `os-linux` / short-digit-run cases. Ask specifically what differs in their context assembly / routing for the same model families.
2. **Tighter native repro of the MagicDNS-recall regime** (optional): seed the correct host into a session's context early, run unrelated turns, then ask for it in prose much later — the "known-but-not-in-immediate-context" regime that best matches how the Cursor peers actually held the string. This is the one arm we could not run cleanly here.
3. **Estate hygiene regardless (parent §8 stands):** pin exact identifiers in always-on rules; prefer tool-read over memory; distrust agent-authored hostnames until clicked. Native Claude's abstention and native Codex's confabulation both argue for *never* trusting a memory-sourced hostname from any agent.

---

## 7b. Distance-recall arm (2026-07-24, added) — closes the qualifier

The one gap in §5 was: fresh native peers don't *hold* the MagicDNS, so we couldn't test "regenerate a doubled-char string you were given earlier, under prose load" — the regime that matches how Cursor's agent actually held it. We ran it with a **fabricated but structurally-identical** host (`hapi.tail7733ee.ts.net` — doubled 7, doubled 3, doubled e), so the transcripts are directly shareable with no redaction.

Per fresh session, no tools: **seed** the three facts → one **distractor** turn (distance) → **prose recall** ("from memory, don't re-read above") → **code recall** (bash snippet). Every re-emission scored.

| Model (direct, no Cursor) | Sessions | Faithful emissions | Doubled-char drops |
|---------------------------|----------|--------------------|--------------------|
| Claude Opus 4.8 | 8 | 52 | **0** |
| Codex (codex-cli 0.145.0) | 8 | 48 | **0** |

**100 faithful re-emissions, 0 drops.** This is now a clean same-regime comparison to Cursor (identifier held in context, regenerated in prose) — and native does not drop. Combined with the recall + copy arms: **0 doubled-char drops across ~127 native emissions.**

Cursor-facing, fully shareable write-up (with verbatim receipts + "where to look" guidance): [`artifacts/doubled-char-recall-2026-07/outside-cursor-20260724/cursor-doubled-char-receipts.md`](artifacts/doubled-char-recall-2026-07/outside-cursor-20260724/cursor-doubled-char-receipts.md). Harness: `run-recall-distance.py`; data: `recall-distance-{results,rollup}.json`.

**Behavioral clue for Cursor:** native Claude *abstains* when it doesn't know a string; Cursor-routed Claude *confabulated a mangled one*. That suggests Cursor scaffolding suppresses "I don't know" into a confident near-miss — a concrete place for them to look (see receipts §"Where we think you should look").

## 8. Artifacts

- Harness: `docs/plans/artifacts/doubled-char-recall-2026-07/outside-cursor-20260724/run-outside-cursor-peers.py`
- Redacted transcripts: `.../outside-cursor-20260724/transcripts-redacted.md`
- Scored data: `.../outside-cursor-20260724/outside-cursor-results.json`, `outside-cursor-rollup.json`
- Raw (uncommitted, may contain live host): `/tmp/double-outside-raw/`
