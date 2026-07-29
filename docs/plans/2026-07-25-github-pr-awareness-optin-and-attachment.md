# ADR: GitHub PR awareness is opt-in; session↔PR attachment is explicit

> **Status:** IN PROGRESS — upstream issue [tiann/hapi#1162](https://github.com/tiann/hapi/issues/1162); draft PR [tiann/hapi#1163](https://github.com/tiann/hapi/pull/1163). **Operator dogfood:** thin soup tip `driver/github-pr-awareness` (`88481771c`) on `:3006`; toggle on via settings file; Meta `--backfill-refs` for estate bootstrap. Events/inbox remain fork-local / future.
> **Date:** 2026-07-25
> **Audience:** whoever implements the toggle + link affordance; Meta PR watcher; Overseer peers
> **Companions:**
> - [`2026-07-25-contrib-state-event-ingest-spec.md`](./2026-07-25-contrib-state-event-ingest-spec.md) — the sensor that consumes these links (`related_session_id`)
> - [`2026-07-25-contribution-state-as-overseer-sensor.md`](./2026-07-25-contribution-state-as-overseer-sensor.md) — observe-vs-actuate principle
> - Upstream PR **tiann/hapi#1161** (`feat/session-external-refs`) — ships `metadata.externalRefs`, `GET /sessions/:id/external-refs`, and the session-list PR chip. This ADR is the write path and the gate on top of it.
> - Upstream issue **tiann/hapi#1162** — opt-in + attach.

---

## 0. Problem

#1161 gave HAPI a place to *store* a session↔PR link and a chip to *show* it. Two holes remain, both raised by the operator:

1. **Nothing writes it.** Today the only thing that associates a session with a PR is Meta scraping `PR #1160` out of the session title. Title scraping is a hack: it is ambiguous across repos (`#1160` in whose repo?), it breaks on rename, and it silently cross-wires when an internal workstream number collides with a PR number (we already had to floor the regex at 3-4 digits to stop exactly that).
2. **It assumes a GitHub estate.** Most HAPI users have no fork/upstream dance, may have no `gh` installed, may not use GitHub at all. Shipping PR chips, PR polling, or a PR inbox class *on by default* is us exporting our workflow to everyone else's sidebar.

So: gate the whole capability behind an explicit opt-in, and make attachment a first-class action that both agents and users can perform.

## 1. Decisions

### D1 — One operator-facing toggle: `githubPrAwareness`, default **off**

Stored in the hub's existing settings file (`hub/src/config/settings.ts` read/write), with the established `env > file > default` precedence used by `serverSettings.ts` (`HAPI_GITHUB_PR_AWARENESS=1|0`). Reported with a `source` like the other settings so the UI can render the row read-only with "set by environment" when an env var pins it.

**Off means:** no `link_pr` tool registered, no PR chip rendered, no link dialog in the session menu, write endpoint returns `403 github_pr_awareness_disabled`, no detection, Meta's event emitter treats PR state as fork-local noise. Nothing on the machine reaches out to GitHub because of HAPI.

**On means:** all of the above light up. Existing `externalRefs` rows are **retained, not deleted**, when the toggle flips back off — turning the feature off should not destroy data the user typed.

*Rejected:* a client-local (`localStorage`) toggle like the display prefs. The capability must gate hub behavior (ingest, promotion) and CLI behavior (tool registration), and neither reads the browser.

*Rejected:* per-session opt-in as the primary gate. Per-session is what `externalRefs` already is — presence of a ref *is* the per-session opt-in. A second per-session boolean is ceremony.

### D2 — Policy (hub) and ability (machine) are separate facts

The toggle is **policy**: "this operator wants PR awareness."
Whether `gh` exists and is authenticated is **ability**, and it is per-machine — the repo and the credentials live on the CLI host, not on the hub. The CLI already advertises `metadata.capabilities` (see `MACHINE_CAPABILITIES` / `machine-update-metadata`), so it reports `github-cli` there at connect time.

Consequence, and this is the part that keeps the feature honest for people without `gh`:

| | Needs `gh` | Works with toggle on and no `gh` |
|---|---|---|
| Paste/agent-supplied link, chip, unlink | no | yes |
| Link validation (PR exists, title, state) | yes | degrades to URL-shape validation only |
| Branch→PR suggestion | yes | row shows "auto-detect unavailable on this machine" |
| Meta contribution-state events | yes | fork-local anyway |

So the manual path never depends on `gh`. That is the whole point of splitting the two facts.

### D3 — `metadata.externalRefs` is the sole attachment authority

Title text is a **mirror**, never a source. The human-visible glance is the **PR chip** (`externalRefs` identity + optional `status` — D8). `pec_extract_pr_numbers` survives only as a *backfill suggester* (D6), never as the binding used for `related_session_id`. Do **not** encode CI/health in the session title.

Identity is always the full `owner/repo#number`. #1161's `superRefine` already forces `url` to be exactly `https://github.com/{repo}/pull/{number}`, so a chip can't say `#1160` and link somewhere else.

### D4 — Three write paths, one contract

All three converge on `PUT /api/sessions/:id/external-refs` (full replace; unlink is `[]`, which the #1161 merge fix already treats as an explicit intent rather than a sparse omission). Hub-side it lands in a new `sessionCache.setSessionExternalRefs()` modelled line-for-line on `renameSession()` — same metadata-version retry loop, same 409-on-contention semantics.

**(a) Agent, spontaneous — the primary path.**
- MCP tool `link_pr` on the HAPI MCP bridge, registered under its own `enableLinkPr` option (independent of `enableChangeTitle`, which several flavors deliberately pass `false`).
- Args: `{ url }` **or** `{ repo, number }`, plus optional `role` (default `primary`). Canonicalized server-side. Idempotent — relinking the same PR is a no-op success, so an agent that calls it every turn costs nothing.
- **The bridge instance is per-session, so the tool can only write its own session.** A rogue or confused agent cannot re-point a peer's session at its PR. Non-negotiable; do not add a `sessionId` argument.
- Tool description carries the behavioral ask: *"Call this as soon as you open, adopt, or are handed a pull request for this session's work."* That is how "agents connect spontaneously" becomes real rather than aspirational.
- **Fallback for flavors without the MCP bridge** (cursor ACP, kimi, opencode today): `HAPI_SESSION_ID` is already exported into agent shells, so `hapi link-pr <url|owner/repo#N>` self-targets over REST with no tool plumbing at all. Ship the CLI subcommand first — it is the universal path and the MCP tool is sugar for the flavors that can take it.

**(b) User, override or request.**
- `SessionActionMenu` gains "Link pull request…" opening a dialog that accepts a URL or `owner/repo#N`, shows the resolved PR title/state when `gh` is available on that machine, and lists branch-derived suggestions (D5) as one-tap accepts.
- The PR chip itself gets a change/unlink action, so an incorrect link costs one tap to fix.
- "Request it" needs no code: the user asks the agent in chat and the agent uses (a). That is the intended lazy path.

**(c) Meta / automation.** Backfill and repair (D6), through the same REST endpoint with the same validation. No privileged side door.

### D5 — Detection ladder: suggest, do not silently write (yet)

Ranked by trust:

1. **Explicit link** (agent tool / user dialog) — authoritative, `source: 'user' | 'agent'`.
2. **Branch → PR.** The session's cwd is on the CLI host, so this runs CLI-side over RPC (same shape as the existing `git-status` route): `git rev-parse --abbrev-ref HEAD`, then `gh pr list --head <branch> --json number,url,title,state`. Under our worktree-per-ticket discipline this is nearly always exactly right, which is precisely why it must not be trusted blindly on other people's machines.
3. **Title scrape** `PR #N` — legacy, Meta-only, backfill, lowest trust.

**v1 policy: (2) surfaces as a suggestion, it does not write.** The chip slot shows a muted "Link #1234?" affordance; one tap accepts and writes with `source: 'user'`.

**Ratchet with a number attached:** if suggestion acceptance runs ≥80% unchanged over two weeks of dogfood, flip branch→PR to auto-write with `source: 'inferred'` and render inferred chips muted until an agent or user confirms. If acceptance is below that, the auto-write would have been wrong often enough to poison `related_session_id`, and we keep it manual.

### D6 — Meta backfill, once, then title scraping is demoted

`hapi-meta-daily --backfill-refs` walks sessions whose titles carry **`PR #N`** (not `Peer #N`, not bare `#N`), resolves the repo from the PR's actual home via a successful `GET /repos/{owner}/{repo}/pulls/{n}` (HTTP 404 JSON on stdout is failure — never invent a pull URL), and writes `role: primary, source: 'inferred'` only where the session has **no** existing ref. After that runs clean, `related_session_id` resolution in the contribution-state emitter reads `externalRefs` first and falls back to title scraping only for unbacked sessions, with a warning line in the action queue naming them. When the warning list hits zero for a week, delete the scraper.

**Kill criterion (2026-07-27):** if a `Peer #N` / issue-only title ever gets a `github_pr` chip again, the resolve exit-code gate or the linked-PR extractor regressed.

### D7 — Schema delta is additive (v1.1)

```ts
// shared/src/schemas.ts — GithubPrExternalRefSchema
source: z.enum(['agent', 'user', 'inferred']).optional(),
linkedAt: z.number().int().positive().optional()
```

Absent `source` reads as `'user'` (trusted): every ref written before this field existed was operator- or agent-authored, so treating unknown as trusted avoids a migration and cannot demote a good link. `linkedAt` exists so a stale link on a long-lived session can be aged out or re-confirmed later.

## 2. Surface summary

| Surface | Shape | New? |
|---|---|---|
| `GET /api/sessions/:id/external-refs` | `{ externalRefs }` | shipped (#1161) |
| `PUT /api/sessions/:id/external-refs` | full replace; 403 when disabled, 409 on version contention | new |
| `GET /api/features` | `{ githubPrAwareness: { enabled, source } }` | new, generic — do not add a bespoke endpoint per flag |
| `PATCH /api/features` | allowlisted booleans, persisted via `config/settings.ts` | new |
| `GET /api/sessions/:id/pr-suggestions` | branch-derived candidates, CLI-side RPC, `[]` without `gh` | new |
| MCP `link_pr` | `{ url }` \| `{ repo, number, role? }`, self-session only | new |
| `hapi link-pr` | CLI subcommand, self-targets via `HAPI_SESSION_ID` | new |
| machine capability `github-cli` | advertised in `metadata.capabilities` | new |
| Settings → General row | "GitHub PR awareness", off by default | new |

## 3. Security and privacy

- Refs store `repo`, `number`, `url`, `role`, `source`, `linkedAt`. No tokens, no PR bodies, no diffs.
- With the toggle off, HAPI makes zero GitHub network calls on the user's behalf. That is the claim the default protects, and it should be asserted by a test, not just documented.
- `gh` runs on the CLI host under the user's own credentials. The hub never holds a GitHub token.
- The MCP tool's self-session-only constraint (D4a) is a security property, not an ergonomic one: it is what stops one agent from rewriting another's provenance.

## 4. Slices

| Slice | Content | Home |
|---|---|---|
| **T1** | Toggle: settings persistence, env override, `GET`/`PATCH /api/features`, Settings row | upstreamable |
| **T2** | Write path: `PUT external-refs`, `setSessionExternalRefs` with version retry, 403/409 semantics | upstreamable |
| **T3** | User affordance: link dialog, chip change/unlink, gated on T1 | upstreamable |
| **T4** | Agent affordance: `hapi link-pr` first, then MCP `link_pr` (`enableLinkPr`) | upstreamable |
| **T5** | Detection: `github-cli` machine capability, branch→PR suggestions, one-tap accept | upstreamable |
| **F1** | Meta `--backfill-refs`; `related_session_id` reads refs first; scraper demoted | fork-local |

T1+T2 are the ones that unblock everything else and are worth landing together. T4's CLI half is genuinely small and buys every flavor at once — do it before the MCP half.

## 5. Kill criteria and cheapest falsification

- **Toggle is theater** if any GitHub call, chip, or tool appears with it off. *Test:* boot a clean hub with the default, run a session in a repo with an open PR, assert zero `gh` invocations and no chip. Cheap, and it should be a permanent regression test.
- **Agents won't link spontaneously.** *Falsify in one day:* ship T4's CLI half plus one line in the fork's agent guide, then count sessions that self-link within their first turn on a PR. If under half of new PR sessions self-link after a week, the tool description is wrong or the affordance is too far from the agent's path — fix the prompt before building more UI.
- **Suggestions are noise** if acceptance is under 80% (D5). Then branch→PR stays manual forever and we drop the auto-write ambition.
- **Backfill is wrong** if any inferred ref points at the wrong repo. *Test:* dry-run `--backfill-refs` and eyeball the full mapping before the first write — it is ~20 sessions, so this is minutes, not a project.
- **The whole thing is over-built** if, after a month, the only writer is Meta's backfill and no agent or user has ever linked a PR by hand. Then the honest move is to keep the data model, delete the UI, and let Meta own it entirely.

## 6. Open questions

1. **Multiple PRs per session.** `role: primary | secondary` supports it and the chip shows primary only. Do stacked-PR sessions want a "+2" affordance, or is that inventing demand? Defer until someone complains.
2. **Session forks/imports — DECIDED 2026-07-25.** Do **not** inherit the source session's PR refs. An imported or forked session starts unattached, like a fresh session. Normal discovery may later suggest a PR and the agent or user may attach it explicitly. This requires distinguishing continuity/bootstrap metadata preservation (where #1161 correctly keeps refs) from creating a new imported/forked session (where refs must be omitted).
3. **Non-GitHub forges.** `ExternalRefSchema` is a one-member union expressly so GitLab/Gitea can join later. Nothing here should assume GitHub beyond the `github_pr` kind — the toggle name is the one place we are already leaking that assumption, and `githubPrAwareness` is honest about being GitHub-only for now.

## 7. Decision addendum — PR *state* belongs on the chip, not the title (2026-07-25)

### D8 — Chip carries status; title stays the human workstream name — **IMPLEMENTED in #1163**

**Problem (pre-D8).** Meta wrote health into the **session title** (`✅PR #947: …`) while the PR chip only showed identity (`#947`). That split "what is this?" and "is it green?" across two surfaces.

**Decision:** PR health is a chip concern. Optional fields on `GithubPrExternalRef`:

- `status`: `clean | pending | needs_work | pre_pr | merged | unknown`
- `statusCheckedAt`: unix ms
- `statusAction`: short classifier action string

Meta's daily classify writes these onto existing refs (full `PUT external-refs`). Chip renders emoji + `#N` and tones by status. Browser never live-queries GitHub.

**Transition (complete 2026-07-25):** Meta no longer writes status emoji into titles. For sessions with a chip it **strips** a leading status emoji once. `hapi-pr-session-emoji.sh` is a removed stub.

**Title identity (2026-07-27):** Meta also strips leading `PR #N:` / `PR #N/#M:` prefixes from chipped sessions — chip owns identity. Titles become workstream-only. `Peer #N:` incubating titles are kept (no issue chip yet). Agents must not re-add `PR #N:` after strip.

**Stale honesty (2026-07-26):** browser never live-queries GitHub. If `statusCheckedAt` is older than **2 hours**, the chip mutes tone and shows `?`. Estate refresh: fork-local timers (morning pings + quiet refresh every 45m 24/7) — see `install-hapi-meta-daily-timer.sh`.

**Re-link stickiness (2026-07-28):** `hapi link-pr` / MCP `link_pr` / Link PR dialog historically wrote identity-only refs (no `status*`). A naive full replace wiped Meta's cached health → chip showed bare `#N`. Hub `mergeSessionMetadata` runs `preserveGithubPrStatusCache`: same `repo#N` keeps prior `status` / `statusCheckedAt` / `statusAction` unless the write sets `status` explicitly; `[]` and different PR still replace. Matches Meta's "skip writing `?`" last-good contract.

**Fetch-on-attach (2026-07-28):** First attach / PR change must not leave a blank chip until Meta daily. `buildAttachedGithubPrRefs` runs Meta's `hapi-pr-emoji-batch` (via `classifyGithubPrChipStatus`) when there is no preserved status for that `repo#N`, then writes status fields before/with the attach. Wired into `hapi link-pr` + MCP `link_pr`. Hub `setSessionExternalRefs` also fire-and-forgets the same enrich for Link PR dialog / classify-miss paths. Soup layer `driver/github-pr-awareness`.

**Remat re-thin (2026-07-29):** Never thin onto stale `origin/driver/integration` tip. Remat does `reset --hard upstream/main` then merges layers - use the **pre-layer SHA Meta reports** from a failed remat (or thin onto `upstream/main` awareness-only). Wave that landed awareness: tip `ac95f9f65` via merge `08fdb92cf`; actual pre-layer was `d0a3d6473` (commit message saying `12814cf6b` is stale wording). Next re-thin absorb: HappyThread keep `props.outlineTitle`; SessionList keep PR chips and do **not** drop `getTodoProgress` / attention / time-label helpers (heal pattern on driver tip `9d506f30e`).

**Not a second upstream PR.** Awareness + attach + chip status ship together in [tiann/hapi#1163](https://github.com/tiann/hapi/pull/1163).
