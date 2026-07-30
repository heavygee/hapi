# Overseer summary contract — delimiter-hardening contingency ("what-if")

Status: **DEFERRED / not needed unless triggered.** Captured on operator request 2026-07-29.
Owner concept: 🔁overseer prep. Companion to `docs/plans/2026-07-24-overseer-summary-emission.md`
(Half B design) and the invisible-contract work (fork PR #81).

## TL;DR

Today the contract is a **bare, human-readable ASCII token** — `AGENT_NOTIFY_SUMMARY {json}` —
detected robustly by structure, not by an exotic string. This doc records the agreed
**fallback plan** if that ever proves insufficient: wrap the token in an **atypical sequence
of un-exotic (pure-ASCII) characters** — "both, not either" — so machine detection keys on the
wrapper while the readable token stays inside for legibility.

**Do not implement now.** Only build if a trigger below actually fires.

## Why the bare token is fine today (context)

Current detection (`shared/src/messages.ts` `matchNotifySummaryLine` + `extractNotifySummary`)
is safe against prose collisions by **structure**, not obscurity:

1. **End-anchor** — only the last non-empty line of a turn is checked. A token mid-prose is
   never the last line.
2. **Token is the entire prefix before `{`** — `"see the AGENT_NOTIFY_SUMMARY docs"` fails.
3. **Valid JSON** — the trailing part must start `{` and end `}`.
4. **Corruption-tolerant** — `collapseRepeats` recovers Cursor's `SUMMARY`→`SUMARY` dup-drop.

Exotic/non-ASCII sentinels were **rejected** (operator "ascii ftw", 2026-07-14) because Cursor's
duplicate-letter dropping — and re-encoding across agent transports — makes exotic markers *more*
fragile, not less.

## Residual gap this contingency would close

Because the token is human-readable, it *can* legitimately appear in an agent's **prose body**
(observed only when an agent writes *about* this feature). Such a mention is:

- **never mis-parsed** (fails end-anchor / prefix / JSON guards), and
- **never mis-stripped** (strip only removes the end-anchored trailing line) — so it remains as
  visible content, which is correct.

So the gap is purely cosmetic/edge: (a) visible in-prose residue of the literal token, and
(b) the theoretical (JSON-guarded, very unlikely) false-positive if an agent's prose ever forms a
valid trailing summary line.

## The plan (atypical ASCII wrapper — "both, not either")

Wrap the existing readable contract in **begin/end sentinels made of atypical but pure-ASCII
character sequences**:

- **Vanishingly unlikely in normal prose** (a sequence nobody types by accident).
- **No adjacent repeated characters** in the sentinel, so `collapseRepeats` is a **no-op** on it
  (dup-drop-safe by construction) — this is the key design constraint.
- **Single-line-anchorable and trivially grep/sed-able** for out-of-band tooling.
- **Token kept inside** for human/debug legibility (`AGENT_NOTIFY_SUMMARY {json}`); the machine
  keys on the wrapper.

Illustrative only (finalize at implementation — verify no-repeat + collapse-norm invariants):

```
~%<HAPI-NS>%~ AGENT_NOTIFY_SUMMARY {"version":1,...} ~%</HAPI-NS>%~
```

### Detection changes
- `matchNotifySummaryLine`: match wrapper (collapse-normalized) + token + JSON.
- **Back-compat:** accept BOTH the bare-token form (legacy/rollout + historical store) and the
  wrapped form.
- `stripAgentContract`: remove the whole wrapped block (begin…end), not just the last line.

### Emission changes
- Cursor notify-rule overlay (`cursorNotifyRuleOverlay`) and the non-Cursor systemPrompt /
  first-turn inject emit the **wrapped** form.

### Migration
1. Ship detector that accepts both forms (no behavior change).
2. Flip emission to the wrapped form.
3. Keep bare-token parsing indefinitely for the historical store.

### Risk
- Sentinel corruption — mitigated by the **no-adjacent-repeat** design + collapse-norm backstop.

## Triggers to actually implement (until then: deferred)

- Measured in-prose collisions causing **false-positive parses** (should be ~0 given the JSON
  guard — watch the events stream).
- Operator annoyance at **visible in-prose residue** of the literal token.
- Any agent/transport defeating the **end-anchor** (content emitted *after* the summary line).

## References
- `docs/plans/2026-07-24-overseer-summary-emission.md` — Half B design + stealth rationale.
- `shared/src/messages.ts` — `NOTIFY_SUMMARY_TOKEN`, `collapseRepeats`, `matchNotifySummaryLine`.
- `shared/src/overseerEvents.ts` — `stripAgentContract`, `AGENT_NOTIFY_CONTRACT_INLINE_PREFIX`.
- Fork PRs: #81 (invisible strip), #86 (Cursor rule emission), #87 (deterministic fallback).
