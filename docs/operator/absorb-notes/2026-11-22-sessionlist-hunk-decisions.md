# SessionList.tsx — 3-way hunk decisions (2026-11-22)

Why this file exists: my first resolution of `web/src/components/SessionList.tsx`
kept the fork side almost intact (362 fork-only identifiers, 2 missing) but lost
**56 of upstream's 155** upstream-only identifiers — whole features
(`renderNewSessionInGroupButton`, search exclude mode, per-row CollapsiblePanel,
the memo wrapper). Four spot-probes found four losses, so the file is being
redone from a real 3-way merge (`git merge-file` base=aefc2c7d5): 64 hunks,
1235 conflicted lines.

Parents: fork `360c9d58d` · upstream `f288d8511` · base `aefc2c7d5`

`both` = concatenate both sides. `custom` = neither side as-is; see note.

| # | decision | note |
|---|----------|------|
| 1 | both | react imports — union (fork: Children/cloneElement/Fragment/isValidElement/ReactElement; upstream: KeyboardEvent/MouseEvent) |
| 2 | both | fork voice hooks + upstream useLowRateAnimation/useIsMutating/sessionPinMutationKey |
| 3 | both | both import sets; dedupe pass handles repeats |
| 4 | upstream | LowRatePulseDot is an upstream-only addition |
| 5 | upstream | large upstream-only import block (fork side empty) |
| 6 | both | different functions: fork shouldShowPinnedDivider, upstream sessionMatchesSearchMode |
| 7 | both | prop + state union (fork api/datePickerOpen; upstream searchMatchMode/chromeMinPx) |
| 8 | both | upstream's setSearchMatchModeOpen(false) in the else, then fork's formatTimeFilterChipLabel |
| 9 | fork | keep `renderDateFilter` + the operator's Layout A comment; rewrite upstream's `renderDateButton(` call sites |
| 10 | fork | standalone chip styling is the operator's Layout A decision (2026-10-15) |
| 11 | fork | template literals vs upstream string concat — equivalent, keep repo style |
| 12 | fork | standalone chip label (Layout A) |
| 13 | fork | comment only |
| 14 | fork | anchorRef float+clamp fix |
| 15 | both | fork dictation/hold-to-talk AND upstream renderSearchMatchMode |
| 16 | fork | renderDateFilter('standalone') |
| 17 | fork | embedded calendar + hasDateFilter guard (refinement over showDateFilter) |
| 18 | fork | dictation transcript/error overlays + hasDateFilter datePicker |
| 19 | both | fork flashHighlight prop, then upstream shallowEqualExcept + memo wrapper |
| 20 | custom | both, MINUS fork's `const { features } = useFeatures(api)` (upstream passes features as a prop) and MINUS fork's primaryPrRef (upstream defines it in #25). Duplicate deleteOpen/githubPrAwarenessEnabled collapse to one |
| 21 | both | useSessionActions destructure union (fork setExternalRefs/acknowledgeBlocked + upstream upsertExternalRef/removePrimaryExternalRef) |
| 22 | upstream | overlayOpen superset (adds linkPrOpen, forkFlowOpen) |
| 23 | custom | fork's fork-support predicates ONLY + upstream's whole block (upstream's copy already carries quickArchivePending/archiveNeedsConfirmation/showQuickArchive) |
| 24 | custom | merge both: pendingRequestId wins; else forward optional scroll args only when set; else bare onSelect(s.id) |
| 25 | upstream | adds display profile + prNowMs; owns primaryPrRef |
| 26 | upstream | matching deps |
| 27 | custom | upstream's structure (outer div + inner `<button>` + PR chip as a SIBLING) resolves the very nesting the fork's `div role="button"` was working around; port fork's blocked rail classes, data-session-blocked and flashHighlight ring onto upstream's outer div |
| 28 | custom | upstream PR-chip wrap + contentSearchTruncated + trailingClassName, plus fork's linkedIssue chip |
| 29 | custom | fork's UnblockReasonDialog + reopenError dialog, plus upstream's forkFlow (ForkPreviewDialog + legacyFallback) which supersedes fork's manual forkOpen/forkPending |
| 30 | upstream | upsert/removePrimary external-ref API |
| 31 | both | fork showBlockedOnly + upstream showActiveOnly |
| 32 | fork | blocked-section state, pinInProgressMode, fixedSessionOrder, blockedAlertMode (upstream side empty) |
| 33 | both | fork comment + upstream state block |
| 34 | upstream | toolbarSlotWidths |
| 35 | custom | upstream's isFiltering, plus `showBlockedOnly` so the fork lens participates |
| 36 | custom | upstream's filterSessionsForListStatus(sidebarSessions, ...) wrapped in the fork's showActiveSessionsOnly filter |

Fixups after applying:
- rename upstream `renderDateButton(` call sites to `renderDateFilter(`
- run `scripts/tooling/absorb/dedupe-duplicate-imports.mjs` (hunks 1-5 intentionally
  produce duplicate import statements)
- verify with the identifier-presence audit: fork-only AND upstream-only
  identifiers must both come back at 0 missing
