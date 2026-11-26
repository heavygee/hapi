# GitHub native issue statuses & repository boards — threat/opportunity assessment for HAPI Boards (#2147)

Author: overseer stand-in assessment session. Date: 2026-11-26.

**Status: hazard #1 (must-fix) shipped and reviewed.** `fc47e8d8`/`1009-14eb` implemented the guard on `feat/boards` (`1ddcc20f9`): `setStatus` now reads `repository.planningStatuses` and checks `category.state` — not a hardcoded status-name list, so it survives a repo renaming its own statuses — for a case-insensitive CLOSED match before writing, 409s naming the native status, and the web UI resubmits with `confirmCloses: true` on confirmation; fails open on any lookup trouble. Reviewed the diff directly against the live mechanism confirmed below and it matches. Hazard #2 left documented-not-guarded per the CRITICAL/HIGH split below (non-destructive); #3/#4 deferred as follow-ups, consistent with "should-fix" not "must-fix."
Scope: investigation and judgement only, no code changes made. All "CONFIRMED" claims below were verified live against `heavygee/hapi-demo-board` (the sanctioned, content-free test repo/board) and `heavygee/hapi` / `tiann/hapi` using `gh`/GraphQL on 2026-11-26, not inferred from the GitHub changelog prose alone. Mutations made during testing were reverted; the demo board's open/closed state matches its pre-test state (residual native-status values were left populated — harmless, no real content).

## Bottom line

GitHub's 2026-11-23 public preview of native issue statuses is **already live, unconditionally, on both `heavygee/hapi` and `tiann/hapi`**, confirmed by querying `repository.planningStatuses` directly against both repos today — no opt-in step, no enrollment flag, no waiting period was needed on either. That matters beyond the fact itself: it means there is **no grace period**. This is not a future rollout to plan around; it is live now, against the exact repos #2147 targets, before a single line of the PR has merged. The bidirectional coupling the operator was worried about is real, and I reproduced the worst case directly: **calling the exact `gh project item-edit` command HAPI's Boards feature already uses to drag a card to "Done" closes the real GitHub issue**, as a GitHub-side side effect, with zero further change needed on GitHub's end. It fires today against the current shipped HAPI code path, the moment #2147 merges and someone uses the board against a Project built on GitHub's own default template naming (Todo/In Progress/Done), which is the common case.

A second confirmed hazard: HAPI's assignee-write path also triggers GitHub's automation, silently flipping a card's status to "Todo" on assignment.

Recommendation: **#2147 should not merge with `setStatus` unguarded.** See "Recommended changes to #2147" at the end.

## Confirmed hazards, ranked by how soon they bite a real user

### 1. [CRITICAL — reproduced live] Dragging a card to "Done" silently closes the real issue

- HAPI's `setStatus` (`hub/src/web/routes/todoBoard.ts:895-908`) writes a GitHub Projects v2 item field via `gh project item-edit <project> --owner <owner> --url <issueUrl> --field <fieldName> --value <status>`. Default field name is `'Status'` (`DEFAULT_STATUS_FIELD_NAME`, `todoBoard.ts:60`), default "done" value is `'Done'` (`DEFAULT_DONE_VALUES`, `todoBoard.ts:61`) — i.e. HAPI's own defaults are the exact strings GitHub's new native status feature also uses.
- **Live test**: on `heavygee/hapi-demo-board` project #6 (field "Status", options Todo/In Progress/Done — GitHub's own classic default Project template naming), issue #1 was OPEN with native `status: null`. Running `gh project item-edit 6 --owner heavygee --url .../issues/1 --field Status --value Done` (byte-for-byte what HAPI's `setStatus` does) immediately produced:
  ```
  { "issue": { "state": "CLOSED", "status": { "name": "Done" } } }
  ```
  The issue closed. Reverted by reopening and resetting the field.
- **The match is tolerant of case differences**, which matters because it removes the "well our names don't exactly match theirs" escape hatch: setting the Project field to `"In Progress"` (capital P, the common default) synced the native status to `"In progress"` (lowercase p, GitHub's canonical name) without issue.
- **The coupling only fires on an actual value change**, not on every write — re-writing the same value is a no-op for sync (confirmed: rewriting "In Progress" over itself left native status untouched). This means the hazard is specifically "the first time a card is moved to a value whose name resolves to a CLOSED-category native status," not every board interaction.
- Native status → open/closed category mapping, read live from `repository.planningStatuses` on both `heavygee/hapi` and `tiann/hapi` today:
  | status name | category | issue state/reason |
  |---|---|---|
  | Backlog | backlog | OPEN |
  | Todo | planned | OPEN |
  | In progress | started | OPEN |
  | In review | started | OPEN |
  | **Done** | completed | **CLOSED / COMPLETED** |
  | Not planned | not_planned | CLOSED / NOT_PLANNED |
  | Duplicate | duplicate | CLOSED / DUPLICATE |

  Any status column whose name resolves (case-insensitively) to one of the three CLOSED rows will close the issue the moment HAPI writes it.

### 2. [HIGH — reproduced live] Assigning anyone through the board silently sets status to "Todo"

- HAPI's `setAssignees` (`todoBoard.ts:915-920`, also used on card creation at `todoBoard.ts:1124`) runs `gh issue edit <url> --add-assignee <logins>` — the real GitHub assignee field, not a HAPI-side concept.
- **Live test**: issue #7 on the demo board, confirmed unassigned with native `status: null`. Running `gh issue edit .../issues/7 --add-assignee heavygee` (identical to HAPI's call) produced `status: { name: "Todo" }` immediately. Reverted by removing the assignee.
- **Not independently tested**: whether assigning a GitHub-recognized "agent" actor (vs. a plain human user) triggers "In progress" instead of "Todo," per the changelog's separate claim. I had no qualifying agent-type identity to assign in this environment, so this distinction is **speculative** — and it matters, because if HAPI's own board-driven assignee writes are classified by GitHub as "user" assignments (which the live test shows happens for a plain PAT-authenticated login, which is what HAPI uses), every such write is a silent "Todo" side effect regardless of whether a human or an agent ends up actually working the issue.

### 3. [MEDIUM — confirmed via code + live] New cards start in a disagreeing state

- `createIssue` (`todoBoard.ts:930-940`) never passes a status to `gh issue create` — confirmed live: a freshly created issue defaults to native status **Backlog** (matches the REST API's documented default).
- `addItemToProject` (`todoBoard.ts:943-944`, called right after creation) uses `gh project item-add`, which triggers a **pre-existing, unrelated GitHub Projects convenience default**: the new item's own Status field auto-populated to `"Todo"` — observed live, with no explicit HAPI write. Critically, this did **not** sync back to the native field (native stayed "Backlog" while the Project field showed "Todo") — confirming the coupling fires only on an explicit value-change mutation, not on this kind of implicit default population.
- Net effect: every card HAPI creates spends a window — until the first explicit `setStatus` call — visibly disagreeing between the board's own column ("Todo") and the issue's native status pill ("Backlog"). The create-card dialog's pre-write preview has no status line today (confirmed by the implementing session, `todoBoard.ts` create-card UI), so this disagreement isn't surfaced anywhere.
- This is worth keeping prominent, not filed as a minor follow-up: a brand-new card showing "Backlog" on the issue itself and "Todo" on the board it was just created from reads as an obvious product bug to anyone who notices — "I just made this, why does it say two different things" — and unlike hazard #1 it costs nothing to explain (a one-line default-status note in the create dialog) or even to fix outright (have creation set an explicit initial status instead of relying on GitHub's silent default).

### 4. [MEDIUM, mostly ambient — not HAPI-caused] Collaborator activity outside HAPI can move a card HAPI never touched

- HAPI's board code contains no PR-linking mutation of any kind (confirmed by grep across `todoBoard.ts`: zero `addLabelsToLabelable`, zero PR-link calls). The "linking a PR → In review" and "ready for review → In review" automations are therefore never *triggered* by HAPI — but they still *affect* HAPI's board, because once they fire (from a contributor's own GitHub activity) the native status changes, and if that name matches the board's Project field option, the coupling (confirmed real above) will flip the board's own column with no HAPI-visible cause. A user watching a card hop columns on its own, with no commit/comment/assignment visible in HAPI, is a real confusion risk — not a correctness bug, but worth surfacing (see opportunity C below, which is the same mechanism turned to HAPI's advantage).

### 5. [LOW, strategic — not a correctness issue] #2147's pitch is partly native now

- PR #2147 (`feat/boards` → `tiann/hapi:main`, OPEN) frames Boards as "see work without leaving the repo." As of 3 days ago, GitHub ships a native version of exactly that for the common case. The PR's own linked discussion (#2148, "two-way status sync, multi-repo rollups, board-level automations") shows the author was already reaching for the sync problem GitHub just solved natively — better to name that overlap explicitly in the PR body than have a reviewer (plausibly @tiann, who will have seen the same changelog) name it first. This is a better position to argue from than it first looks: #2147 predates the 2026-11-23 announcement entirely, and #2148 was proposing two-way status sync *before* GitHub shipped a version of it. The honest framing isn't "our feature collided with a GitHub change" — it's "our feature anticipated a GitHub change, and the collision is in one specific behavior" (hazard #1's auto-close edge, not the sync concept itself, which the author already wanted).

## Opportunities

| # | Claim | Status |
|---|---|---|
| A | Native statuses work without any GitHub Project — repo-scoped, so Boards could serve repos with no Project at all | **Confirmed the capability exists** (`repository.planningStatuses` resolves independent of any `projectV2`, verified live on both repos). Whether to build against it now is a separate call: the GraphQL types (`PlanningStatus`, `SetIssueStatusInput`) are 2 weeks old per the schema changelog and still preview-labeled — schema could still shift before GA. |
| B | The official GitHub MCP server can do this more directly than shelling `gh project item-edit` | **Likely, not fully pinned down.** Its `issue_write` tool (method `update`) already has a generic `issue_fields` parameter ("Issue field values to set or clear... field_name + value/field_option_name") and a sibling `list_issue_fields` tool. I did not confirm the exact `field_name` string for native status, or whether `issue_fields` is the right mechanism vs. a dedicated status param — worth a direct test before relying on it. |
| C | PR-link automations are free signal HAPI could surface | **Reasoned from confirmed mechanics, not separately tested.** Since linking an open PR reliably flips native status to "In review" (changelog-stated, consistent with every other automation in this table that I did test), reading `issue.status` and showing it as a badge on a session's linked-issue chip is a low-risk, additive read — the same mechanism that causes hazard #4 is also the fix for it. |
| D | "Assigning an agent → In progress" already matches HAPI's own default behavior | **Unconfirmed, and possibly the opposite of an opportunity.** The live test showed a plain-user assignment (exactly what HAPI's `setAssignees` does — a PAT-authenticated login, not a GitHub-flagged agent actor) gets "Todo," not "In progress." If HAPI's assignee writes always read as "user" to GitHub rather than "agent" — which is the more likely reading given HAPI authenticates as a regular account, not through whatever actor-type GitHub's automation checks for — then this "alignment" never actually applies to us, and the opportunity is smaller than the changelog's framing suggests, possibly nonexistent. Don't let the optimistic reading stand until tested with a real agent-flagged identity. |

## Cross-host scope: this is not a github.com-only hazard

The operator asked directly whether this ships on github.com only, or on GitHub Enterprise too — important because HAPI's own estate spans both. Tested live rather than assumed:

- `lhs.ghe.com` (a second GitHub host HAPI's own `gh` auth already has a token for) is **GitHub Enterprise Cloud with Data Residency**, not self-hosted GitHub Enterprise Server — confirmed via its `/meta` endpoint reporting `installed_version: null` (self-hosted Server reports an actual version string there; Cloud tenants don't, because they run on GitHub's own infrastructure, not a customer-managed instance).
- Queried `repository.planningStatuses` directly against four real repos on that tenant (`lockhouse/infra`, `lockhouse/IT-Systems`, `lockhouse/setup`, `lockhouse/arthur`) — all four return the identical seven-status list seen on `github.com`. **The feature is live there today, not scheduled or pending a release train.** Hazard #1 is not a github.com-only exposure; it is live estate-wide, on every GitHub Enterprise Cloud tenant HAPI can reach, right now.
- The real fork in the road is **GitHub Enterprise Cloud vs. true self-hosted GitHub Enterprise Server** (a different, on-prem product, not what's running at `lhs.ghe.com`). Self-hosted Server bundles new platform features into dated release trains rather than rolling them out continuously, and a third-party summary of the same announcement states this feature is currently "generally available for GitHub Enterprise Cloud and GitHub Team users, but not for GitHub Enterprise Server" — consistent with GitHub's usual Cloud-first preview pattern, though I did not confirm this against GitHub's own primary docs (worth treating as likely, not certain).
- This validates the shape of the recommended guard rather than requiring a separate one: because the guard works by querying `repository.planningStatuses` live, per host and per repo, it already degrades correctly on a host where the feature doesn't exist — the query comes back empty and the guard becomes a no-op. No host-sniffing or version table needed; "does this host support it" and "would this write close the issue" are the same live check.

## What I could not verify (say-so, not inference)

- Whether every HAPI-targeted repo is enrolled, or whether the repos tested happen to be early/default-enrolled while others aren't. REST docs say "only available to accounts enrolled in the preview"; I found no user-facing toggle to check enrollment state short of probing GraphQL per-repo. That said, the sample is no longer two repos on one account: `heavygee/hapi` and `tiann/hapi` on github.com, plus four independent repos on a separate GitHub Enterprise Cloud tenant (`lhs.ghe.com`), all show it live with no opt-in step taken by anyone. Three independent GitHub deployments agreeing is reasonably strong evidence this is a broad, default-on rollout for Cloud-hosted repos (github.com and GHE Cloud alike) rather than a narrow pilot — self-hosted GitHub Enterprise Server remains the one product category genuinely unconfirmed and plausibly still excluded (see "Cross-host scope" above).
- The "assigning an agent" vs. "assigning a user" distinction (hazards #2 and opportunity D) — no qualifying agent-type actor was available to test against.
- The exact official MCP server parameter for reading/writing native status (opportunity B) — the generic `issue_fields` mechanism looks right but wasn't exercised live.
- Whether GitHub's matching logic for the coupling is genuinely case-insensitive-by-design or incidentally matched via some other normalization in this specific case — confirmed the *outcome* (In Progress ↔ In progress matched), not the *mechanism*.

## Recommended changes to #2147 before merge

1. **Must-fix**: guard `setStatus`. Before writing a value, read `repository.planningStatuses` (or cache it per-board) and check whether the target value's name resolves to a CLOSED-category native status. If so, either (a) require explicit confirmation in the UI ("this will also close the GitHub issue"), or (b) at minimum stop treating it as a silent, undifferentiated project-field write. This is the fix for hazard #1, the only one with a reproduced real-world blast radius (closing someone's issue with no warning).
2. **Should-fix, and more than a nicety**: surface `issue.status.name` as an independent, read-only badge per card. This is the fix for the *inverse* of hazard #1: hazard #1 is HAPI silently changing GitHub state the user didn't ask for; hazard #4 is GitHub silently changing HAPI's board state with nothing in HAPI explaining why. A board that reshuffles under the user with no visible cause is arguably the more confusing failure of the two, because there's no action to point to and undo. The two should be presented as a pair — "what HAPI does to GitHub without telling you" and "what GitHub does to the board without telling you" — not as a hazard plus an unrelated UI nicety. Cheap to build: one more GraphQL field on the existing items query.
3. **Should-fix**: add a status line to the create-card dialog's pre-write preview, even if it's just "will start at: Backlog (GitHub default)" — closes the gap in hazard #3.
4. **Should-fix (PR description, not code)**: name the 2026-11-23 GitHub change explicitly in #2147's body, and state what Boards still does that native repo boards don't (multi-repo/cross-project rollups on the existing Projects-v2 model, create-via-issue-templates, session linkage) — pre-empt the "isn't this native now" review comment.
5. **Not blocking**: opportunities A/B/C are follow-up work, not merge gates.
