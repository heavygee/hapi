# Handoff — AGENT_NOTIFY_SUMMARY near-miss handling (upstream PR)

**Parent (originator) HAPI session:** `/sessions/cbd1073e-4fd3-4f4a-bff8-cf9ba97bca6d` — tooling/meta seat
**Worktree:** `/work/coding/hapi/worktrees/notify-summary-near-miss`
**Branch:** `fix/notify-summary-near-miss`, based on **`upstream/main`** (`37446bcf5`)
**Target:** an **upstream** PR to `tiann/hapi`. Prepare only.

---

## The defect

`AGENT_NOTIFY_SUMMARY` is the contract every HAPI agent appends to its final
turn. The consumer is `shared/src/messages.ts`. When the footer is a *near
miss* — token present, JSON invalid — two things go wrong at once:

1. **The raw machine line is shown to the human.**
   `stripNotifySummaryFooter()` (`shared/src/messages.ts:892-894`) ends
   `splitNotifySummary(text)?.visibleText ?? text`. No match → original text
   returned → the `AGENT_NOTIFY_SUMMARY {...` line renders in chat.
   This violates the product's own stated intent: `e2e/notify-summary.spec.ts`
   asserts the raw token must never be visible to the user.
2. **The status is dropped with no diagnostic.** `extractNotifySummary()`
   returns `null` "on any deviation" — no log, no counter, no warning. The only
   detector is a human noticing. That is how this was found.

The strict gate is `matchNotifySummaryLine()` at **`shared/src/messages.ts:787`**:

```ts
if (!jsonPart.startsWith('{') || !jsonPart.endsWith('}')) continue
```

A truncated footer (missing the closing `}`) fails here and falls through both
paths above.

### This is not an instruction bug — do not "fix" the contract

`cli/src/modules/common/sessionSummaryInstruction.ts` emits a correct,
well-formed `SESSION_SUMMARY_CONTRACT_LINE`. Nothing instructs agents to emit
the wrong shape. **Do not change the contract text or the parser's strictness
about what counts as a valid footer.** The fix is in how a near miss is
*handled*, not in loosening what is accepted as valid.

### Observed in the wild

This session emitted five truncated footers in one day (each ending `..."`
with no closing brace). All five were dropped silently and all five leaked the
raw line into the operator's chat. The operator saw the leak; the status was
simply lost.

Precedent that this class is worth fixing: the **fork** already diverges in this
exact function with `collapseRepeats()`, added because Cursor drops one of a
doubled letter in roughly 1 in 7 turns, mangling the token
(`AGENT_NOTIFY_SUMMARY` → `AGENT_NOTIFY_SUMARY`) — heavygee/hapi#322. Same
family: a near miss that silently destroys the status.

---

## Suggested shape (yours to design — argue if you disagree)

Introduce a near-miss notion: the last non-empty line *begins with* the token
but does not yield a valid summary. On that condition:

1. **Still strip it from display.** The user should never see the machine line,
   valid or not. This is the user-visible half and the most defensible on its
   own.
2. **Surface a diagnostic** — a warn-level log naming the reason (unterminated
   JSON / trailing content / not an object). Cheap, and turns an invisible
   failure into a greppable one.
3. Consider whether a near miss should be *recoverable* — e.g. a single missing
   closing brace is unambiguous. **Weigh this carefully**: silently repairing
   malformed machine input can mask upstream breakage. If you propose repair,
   it must be narrow, logged, and separable from (1) and (2) so a reviewer can
   take the safe parts alone.

Keep (1) and (2) as the core. Land them even if (3) is rejected.

---

## Constraints — read these before you push anything

- **NEVER merge on `tiann/hapi` from an agent shell.** Agents prepare only.
  Even with write access, even if someone says "babysit to merge". The operator
  with a TTY decides.
- Branch is from `upstream/main` **only**. Never include `docs/operator/`,
  `docs/plans/`, `docs/handoffs/`, or `CLAUDE.md` in the PR diff — the leak
  scanner enforces this. **This handoff file lives on the fork's `main`, not on
  your branch. Do not commit it.**
- Nothing about this estate, its hosts, its operators, or any third party goes
  in the PR text. `heavygee/hapi` is public and `tiann/hapi` more so. Describe
  the defect generically — "agents occasionally emit a truncated footer" is the
  whole story a stranger needs.
- Install deps **in the worktree** (`bun install` there) or `@hapi/*` resolves
  against the main checkout and you will debug a phantom.
- Do not `git stash` in this repo — the stash ref is shared across worktrees.
  Temp-edit and `git checkout` instead.

---

## Proof expected

- Unit tests in `shared/src/messages.test.ts` (or the colocated suite) covering:
  truncated footer (missing `}`), trailing prose after a valid footer, two
  footer lines, non-object payload, and the **happy path unchanged**.
- A regression test that a near-miss footer is **not** visible in rendered
  output — the natural companion to `e2e/notify-summary.spec.ts`.
- `bun typecheck` and the relevant package suites green. Paste real output; do
  not assert green without it.
- Lead with the positive control: prove your test fails against unpatched code
  before claiming it passes against patched code.

---

## Fork port (secondary, after upstream is open)

The fork's matcher differs (`collapseRepeats`, exported
`NOTIFY_SUMMARY_TOKEN`), so this will not cherry-pick cleanly onto
`driver/integration`. Open the upstream PR first; port to the fork as a
separate soup layer once the upstream shape settles. Do not start with the
fork — that is how the two diverge further.

Related fork-side work, for context only, not yours: heavygee/hapi#335
(release notes gated behind upgrade subscription) is owned by
`/sessions/7d55ed21-8a9f-4309-b4f8-30069df36b4b`.

A fork-local Stop-hook guard already exists at
`scripts/tooling/hapi-notify-summary-guard.sh` — it blocks a Claude turn that
emits a malformed line. That is a local band-aid for one agent flavour on one
repo; it is **not** a substitute for this fix and should not be offered
upstream.

---

## Close the loop (mandatory when done or blocked)

1. `hapi ping-peer cbd1073e` (or MCP `ping_peer`) — **the originator only**.
   Do not CC Meta or the PR watcher. Open the message with:
   ```
   From: /sessions/<your-hapi-session-id>
   Name: <your metadata.name>
   ```
   then a one-paragraph verdict, the PR link, and where the detail lives.
2. Then emit `AGENT_NOTIFY_SUMMARY` on your final turn — **and check it ends
   with `}`**, given the subject matter.

Ping me when the PR is open, or sooner if you disagree with the framing. I am
babysitting this one, so I would rather hear an objection early than read a
merged assumption later.
