# Absorb 2026-11-19 — test bodies needing hand review

Shared test names where BOTH sides changed the body and each side has
identifiers the other lacks. The absorb currently keeps `origin/main`'s
body, so any fork-only assertion listed here is NOT being asserted on the
composed tip. The code it covered is still present — this is coverage loss,
which no gate reports, which is why it is written down.

Resolve by merging the assertions, not by picking a side.

## cli/src/claude/utils/startHappyServer.test.ts
- `does not expose change_title when native ACP titles are enabled`
  - fork-only identifiers: Registration, Same, absent, absorbed, archive_peer, assertion, assertions, awareness
- `omits peer tools from registration and toolNames when HAPI_DISABLE_PEER_TOOLS is set`
  - fork-only identifiers: archive_peer, link_issue, search_peers, set_voice_mode, stays

## cli/src/codex/utils/buildHapiMcpBridge.test.ts
- `forwards the enabled HTTP tool through STDIO and auto-approves it`
  - fork-only identifiers: archive_peer, display_links, enableDisplayLinks, search_peers, toHaveProperty
- `does not expose skill_lookup for native-skill bridge callers`
  - fork-only identifiers: archive_peer, display_links, search_peers, toHaveProperty

## cli/src/cursor/cursorAcpRemoteLauncher.test.ts
- `restores the row when ACP explicitly rejects after dispatch`
  - fork-only identifiers: false
- `holds a transport-ambiguous steer for explicit retry or cancel`
  - fork-only identifiers: false
- `prevents cancellation once ACP steer dispatch starts`
  - fork-only identifiers: false
- `blocks the next prompt while soft-steer dispatch is pending`
  - fork-only identifiers: false
- `acknowledges a steer dispatched before an overlapping abort`
  - fork-only identifiers: false
- `does not hang teardown while a soft steer completion is unresolved`
  - fork-only identifiers: false
- `does not truncate coalesced speech while a soft-steer is outstanding (#2268)`
  - fork-only identifiers: false

## hub/src/notifications/notificationHub.test.ts
- `dedupes model-error notifications across repeat session-updated events`
  - fork-only identifiers: Error, quota_exhausted, resource_exhausted
- `fires again when a NEW lastModelError replaces an older one`
  - fork-only identifiers: auth_failed
- `skips model-error dispatch when no channels implement it`
  - fork-only identifiers: sendTaskNotification

## hub/src/web/routes/hubSettings.test.ts
- `persists chat display toggle for owner without changing emit`
  - fork-only identifiers: null, sessionStartTimeoutMs
- `persists peer spawn defaults`
  - fork-only identifiers: null, sessionStartTimeoutMs
- `rejects non-default namespaces for PUT but allows GET`
  - fork-only identifiers: null, sessionStartTimeoutMs
- `survives a prior write via settings helpers`
  - fork-only identifiers: null, sessionStartTimeoutMs

## hub/src/web/routes/sessions.test.ts
- `rejects an invalid pin body`
  - fork-only identifiers: pinned

## web/src/components/SessionList.directory-action.test.tsx
- `keeps the sticky project header opaque and aligned with the list viewport`
  - fork-only identifiers: SEARCH_PLACEHOLDER, closest, getByPlaceholderText, searchInput, toBeNull
- `keeps Fork session disabled while the source turn is running`
  - fork-only identifiers: dialog, queryByRole
- `puts pending operator action ahead of Jobs when both apply`
  - fork-only identifiers: Blocked, This, above, blocked, getByTestId, harder, into, moved
- `keeps quiet connected sessions in directory groups when pin-in-progress is on`
  - fork-only identifiers: Active, Blocked, Jobs, Upstream, With, above, action, adaptation
- `keeps new-session-in-directory actions for projects whose rows all floated`
  - fork-only identifiers: Active, Quiet, quiet
- `does not pin quiet connected sessions as in-progress (#1404 jobs stand)`
  - fork-only identifiers: Either, Upstream, because, false, fork, group, holds, keeps
- `mounts collapsed group rows only while open or closing`
  - fork-only identifiers: toggleGroupHeader
- `keeps a collapsing row mounted while its rename dialog is open`
  - fork-only identifiers: document, querySelector, toggleGroupHeader
- `folds primary actions into More on a narrow empty-query header (tiann/hapi#2040)`
  - fork-only identifiers: MachineFilterBar, SessionListViewMenu, assertion, checks, chip, filtering, fork, hidden
- `lets a long query chip yield so More stays on-screen at 320px / 130% (tiann/hapi#2040)`
  - fork-only identifiers: Sort, being, budgeted, control, filter, filtering, fork, here
- `gives expanded search a 48px clear end-cap at the end of the field (tiann/hapi#2019)`
  - fork-only identifiers: Array, INSIDE, Layout, Upstream, above, asserted, before, calendar

## web/src/components/SessionList.machine-filter.test.tsx
- `shows the filter bar and machine-suffixed group titles with multiple machines`
  - fork-only identifiers: combined, every, handles, mobile, only, options, separate, unified
- `allows unread and scratchlist filters to be selected together`
  - fork-only identifiers: _000, fetchTranscriptionProviders, markSessionSeen, providers
- `keeps the existing unread filter behavior behind the unified menu`
  - fork-only identifiers: _000, markSessionSeen

## web/src/components/SessionList.test.ts
- `preserves input order`
  - fork-only identifiers: elsewhere, filterSessionsByMachine, machine, nomachine
- `keeps only sessions newer than lastSeen; drops seen and selected-only quiet rows stay when selected`
  - fork-only identifiers: null
- `keeps the selected session visible even when it would otherwise filter out`
  - fork-only identifiers: lastSeen
- `composes with machine filter as empty intersection (unread after machine scope stays selected)`
  - fork-only identifiers: _000, lastSeenById, null, string

## web/src/components/SessionRowSummary.test.tsx
- `refreshes unread attention when the local watermark version changes`
  - fork-only identifiers: expectUnreadOnce, queryByTestId
- `renders label-only unknown jobs with striped indeterminate bar + running · elapsed (shape B)`
  - fork-only identifiers: animate
- `renders a real fill only when total yields a fraction`
  - fork-only identifiers: animate, indeterminate

## web/src/routes/settings/index.test.tsx
- `renders compact display controls without dropdown popovers`
  - fork-only identifiers: Asserting, Display, Reasoning, SessionList, Settings, Upstream, actual, assertion
- `keeps chat enum choices inline`
  - fork-only identifiers: Grouped

