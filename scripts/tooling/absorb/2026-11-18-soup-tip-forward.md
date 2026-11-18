# Soup tip-forward absorb — driver/integration-wip <- origin/main
# 2026-11-18 | owner: tooling_meta cbd1073e | hold: ACTIVE
# remat WT: /home/heavygee/coding/hapi/worktrees/driver-remat  prev tip (LIVE, still serving): 360c9d58d
# MERGE_HEAD: b42d956ae (fork main after the 110-commit upstream absorb)
#
# SCALE: 253 files, 731 hunks.
# Handbook §3b benchmarks: typical tip-forward ~17 files; the 2026-11-10
# disaster night was 91 files / 332 hunks. This is ~2.2x that night.
# Cause is the same one §3b names: deferral. Fork main sat 110 commits
# behind upstream while the soup accumulated 82 live layers.
#
# NOT stale-layer bloat: checked all 88 manifest layers, ZERO are
# ancestors of origin/main, so the §3b 'drop ancestor layers first'
# remedy does not apply here. Hypothesis tested and refuted.
#
# status: PENDING -> RESOLVED

PENDING    32  web/src/components/SessionList.tsx
PENDING    22  hub/src/sync/sessionCache.ts
PENDING    16  hub/src/sync/syncEngine.ts
PENDING    16  cli/src/cursor/cursorAgentMessageClassifier.test.ts
PENDING    16  cli/src/claude/utils/startHappyServer.ts
PENDING    16  bun.lock
PENDING    15  web/src/components/NewSession/index.tsx
PENDING    13  web/src/components/SessionChat.tsx
PENDING    12  hub/src/notifications/notificationHub.test.ts
PENDING    11  cli/src/codex/shared/root.ts
PENDING    10  hub/src/notifications/notificationHub.ts
PENDING    10  cli/src/runner/run.ts
PENDING     9  web/src/lib/locales/zh-CN.ts
PENDING     9  web/src/lib/locales/en.ts
PENDING     9  shared/src/externalRefs.ts
PENDING     9  shared/src/apiTypes.ts
PENDING     9  hub/src/web/routes/hubSettings.test.ts
PENDING     9  cli/src/codex/shared/root.test.ts
PENDING     9  android/app/src/main/kotlin/app/hapi/companion/feature/chat/composer/ChatComposer.kt
PENDING     8  web/src/components/SessionRowSummary.tsx
PENDING     8  web/src/components/SessionPrChip.tsx
PENDING     8  web/src/components/ModelErrorBanner.test.ts
PENDING     8  web/src/components/LinkPrDialog.tsx
PENDING     8  hub/src/store/sessions.ts
PENDING     8  cli/src/dsh/dshRemoteLauncher.test.ts
PENDING     8  cli/src/claude/claudeRemote.ts
PENDING     7  web/src/router.tsx
PENDING     7  web/src/components/AssistantChat/HappyThread.tsx
PENDING     7  hub/src/web/server.ts
PENDING     7  cli/src/cursor/cursorAcpRemoteLauncher.ts
PENDING     6  web/src/components/SessionRowSummary.test.tsx
PENDING     6  web/src/components/ModelErrorBanner.tsx
PENDING     6  web/src/api/client.ts
PENDING     6  shared/src/schemas.externalRefs.test.ts
PENDING     6  hub/src/web/routes/sessions.ts
PENDING     6  hub/src/web/routes/features.ts
PENDING     6  hub/src/web/routes/features.test.ts
PENDING     6  hub/src/web/routes/codexDesktop.ts
PENDING     6  hub/src/web/routes/cli.test.ts
PENDING     6  hub/src/sync/rpcGateway.ts
PENDING     6  hub/src/socket/handlers/cli/sessionHandlers.ts
PENDING     6  cli/src/claude/claudeRemoteLauncher.ts
PENDING     5  web/src/hooks/mutations/useSessionActions.ts
PENDING     5  web/src/components/SessionHeader.tsx
PENDING     5  web/src/components/ImagePreview.tsx
PENDING     5  hub/src/web/routes/sessions.test.ts
PENDING     5  hub/src/fcm/fcmNotificationChannel.ts
PENDING     5  hub/src/fcm/fcmNotificationChannel.test.ts
PENDING     4  web/src/routes/settings/general.tsx
PENDING     4  web/src/routes/settings/chat.tsx
PENDING     4  web/src/lib/message-window-store.ts
PENDING     4  web/src/components/SessionAttentionIndicator.tsx
PENDING     4  web/src/components/SessionActionMenu.test.tsx
PENDING     4  web/src/components/AssistantChat/HappyComposer.sendError.test.tsx
PENDING     4  shared/src/sessionSummary.ts
PENDING     4  shared/src/schemas.ts
PENDING     4  hub/src/web/routes/cli.ts
PENDING     4  hub/src/store/sessions.test.ts
PENDING     4  hub/src/push/pushNotificationChannel.ts
PENDING     4  hub/src/notifications/modelErrorCopy.test.ts
PENDING     4  cli/src/utils/MessageQueue2.ts
PENDING     4  cli/src/cursor/cursorModelErrorBridge.ts
PENDING     4  cli/src/cursor/cursorModelErrorBridge.test.ts
PENDING     4  cli/src/commands/resume.test.ts
PENDING     4  cli/src/commands/linkPr.ts
PENDING     4  cli/src/codex/utils/buildHapiMcpBridge.test.ts
PENDING     4  cli/src/claude/claudeRemoteLauncher.test.ts
PENDING     4  cli/src/api/apiMachine.ts
PENDING     4  android/app/src/main/res/values-zh-rCN/strings.xml
PENDING     4  android/app/src/main/kotlin/app/hapi/companion/ui/theme/HapiColors.kt
PENDING     4  android/app/src/main/kotlin/app/hapi/companion/feature/chat/blocks/PermissionActionViews.kt
PENDING     3  web/src/routes/settings/index.test.tsx
PENDING     3  web/src/lib/assistant-runtime.ts
PENDING     3  web/src/hooks/queries/useFeatures.ts
PENDING     3  web/src/components/ui/ConfirmDialog.tsx
PENDING     3  web/src/components/SessionPrChip.test.ts
PENDING     3  web/src/components/AssistantChat/messages/MessageActions.tsx
PENDING     3  web/src/components/AssistantChat/messages/MessageActions.test.tsx
PENDING     3  web/src/components/AssistantChat/HappyThread.mobile-scroll.test.tsx
PENDING     3  shared/src/messages.ts
PENDING     3  hub/src/telegram/bot.ts
PENDING     3  hub/src/sync/sessionCache.mergeExternalRefs.test.ts
PENDING     3  hub/src/sse/sseManager.ts
PENDING     3  hub/src/notifications/notificationTypes.ts
PENDING     3  hub/src/config/serverSettings.test.ts
PENDING     3  cli/src/modules/common/skills.ts
PENDING     3  cli/src/modules/common/codexSessions.ts
PENDING     3  cli/src/dsh/runDsh.ts
PENDING     3  cli/src/cursor/cursorAcpRemoteLauncher.test.ts
PENDING     3  cli/src/claude/runClaude.ts
PENDING     3  cli/src/api/apiSession.test.ts
PENDING     3  android/app/src/main/res/values/strings.xml
PENDING     3  android/app/src/main/res/values-ru/strings.xml
PENDING     2  web/src/routes/settings/about.tsx
PENDING     2  web/src/lib/attachmentAdapter.ts
PENDING     2  web/src/components/assistant-ui/markdown-text.tsx
PENDING     2  web/src/components/SessionList.machine-filter.test.tsx
PENDING     2  web/src/components/AssistantChat/messages/UserMessage.tsx
PENDING     2  web/src/components/AssistantChat/messages/UserMessage.test.tsx
PENDING     2  web/src/api/client.test.ts
PENDING     2  shared/src/runnerCapabilities.ts
PENDING     2  shared/src/models.test.ts
PENDING     2  shared/src/messages.test.ts
PENDING     2  ios/Hapi/Features/Pairing/PairingFlowView.swift
PENDING     2  hub/src/sync/messageService.ts
PENDING     2  hub/src/store/messageStore.ts
PENDING     2  hub/src/store/index.ts
PENDING     2  hub/src/push-ios/iosPushChannel.ts
PENDING     2  hub/src/notifications/modelErrorCopy.ts
PENDING     2  hub/src/configuration.ts
PENDING     2  docs/guide/native-apps.md
PENDING     2  cli/src/commands/registry.ts
PENDING     2  cli/src/commands/claude.test.ts
PENDING     2  cli/src/codex/shared/registry.ts
PENDING     2  cli/src/codex/shared/projection.ts
PENDING     2  cli/src/codex/happyMcpStdioBridge.ts
PENDING     2  cli/src/claude/utils/startHappyServer.test.ts
PENDING     2  cli/src/claude/utils/sessionScanner.ts
PENDING     2  cli/src/agent/sessionFactory.test.ts
PENDING     2  cli/src/agent/backends/acp/AcpSdkBackend.test.ts
PENDING     2  android/app/src/main/kotlin/app/hapi/companion/feature/chat/ChatTranscript.kt
PENDING     2  android/app/src/main/kotlin/app/hapi/companion/Navigation.kt
PENDING     2  android/README.md
PENDING     2  .github/workflows/test.yml
PENDING     1  website/src/const.ts
PENDING     1  web/src/types/api.ts
PENDING     1  web/src/routes/sessions/file.tsx
PENDING     1  web/src/lib/sessionPatch.ts
PENDING     1  web/src/lib/sessionNavigation.test.ts
PENDING     1  web/src/lib/query-keys.ts
PENDING     1  web/src/lib/message-window-store.test.ts
PENDING     1  web/src/lib/codexStatusLabels.test.ts
PENDING     1  web/src/index.css
PENDING     1  web/src/components/icons.tsx
PENDING     1  web/src/components/SessionList.unread-visibility.test.tsx
PENDING     1  web/src/components/SessionList.test.ts
PENDING     1  web/src/components/SessionList.directory-action.test.tsx
PENDING     1  web/src/components/ProjectGroupRow.tsx
PENDING     1  web/src/components/NewSession/index.test.tsx
PENDING     1  web/src/components/AssistantChat/messages/NotifySummaryText.tsx
PENDING     1  web/src/components/AssistantChat/messages/AssistantMessage.tsx
PENDING     1  web/src/components/AssistantChat/SortableComposerAttachments.preview.test.tsx
PENDING     1  web/src/components/AssistantChat/HappyComposer.tsx
PENDING     1  web/src/components/AssistantChat/AttachmentItem.test.tsx
PENDING     1  shared/src/types.ts
PENDING     1  shared/src/sessionSummary.test.ts
PENDING     1  shared/src/rpcMethods.ts
PENDING     1  shared/src/index.ts
PENDING     1  ios/Hapi/Features/Settings/SettingsView.swift
PENDING     1  hub/src/web/routes/voice.ts
PENDING     1  hub/src/web/routes/machines.ts
PENDING     1  hub/src/web/routes/machines.test.ts
PENDING     1  hub/src/web/routes/hubSettings.ts
PENDING     1  hub/src/web/routes/events.ts
PENDING     1  hub/src/sync/workGraphNotifyIngest.ts
PENDING     1  hub/src/sync/syncEngineArchiveSession.test.ts
PENDING     1  hub/src/sync/sessionModel.test.ts
PENDING     1  hub/src/store/sessionStore.ts
PENDING     1  hub/src/store/messages.ts
PENDING     1  hub/src/push-ios/iosPushService.ts
PENDING     1  hub/src/fcm/fcmService.ts
PENDING     1  hub/README.md
PENDING     1  docs/guide/quick-start.md
PENDING     1  docs/guide/installation.md
PENDING     1  docs/guide/how-it-works.md
PENDING     1  cli/src/runner/orphanReap.ts
PENDING     1  cli/src/runner/buildCliArgs.test.ts
PENDING     1  cli/src/modules/common/skills.test.ts
PENDING     1  cli/src/modules/common/rpcTypes.ts
PENDING     1  cli/src/modules/common/permission/BasePermissionHandler.test.ts
PENDING     1  cli/src/modules/common/launcher/BaseLocalLauncher.test.ts
PENDING     1  cli/src/modules/common/codexSessions.test.ts
PENDING     1  cli/src/modules/common/claudeSessions.ts
PENDING     1  cli/src/dsh/session.ts
PENDING     1  cli/src/dsh/dshRemoteLauncher.ts
PENDING     1  cli/src/cursor/runCursor.ts
PENDING     1  cli/src/cursor/cursorAgentMessageClassifier.ts
PENDING     1  cli/src/commands/runCli.ts
PENDING     1  cli/src/commands/runCli.test.ts
PENDING     1  cli/src/commands/resume.ts
PENDING     1  cli/src/commands/help.ts
PENDING     1  cli/src/commands/dsh.ts
PENDING     1  cli/src/commands/dsh.test.ts
PENDING     1  cli/src/codex/utils/buildHapiMcpBridge.ts
PENDING     1  cli/src/codex/shared/projection.test.ts
PENDING     1  cli/src/claude/utils/systemPrompt.ts
PENDING     1  cli/src/claude/session.ts
PENDING     1  cli/src/claude/loop.ts
PENDING     1  cli/src/claude/claudeRemote.test.ts
PENDING     1  cli/src/claude/claudeLocalLauncher.test.ts
PENDING     1  cli/src/api/api.ts
PENDING     1  cli/src/agent/sessionFactory.ts
PENDING     1  android/app/src/main/kotlin/app/hapi/companion/ui/theme/HapiTypography.kt
PENDING     1  android/app/src/main/kotlin/app/hapi/companion/ui/markdown/Markdown.kt
PENDING     1  android/app/src/main/kotlin/app/hapi/companion/feature/settings/SettingsPreviews.kt
PENDING     1  android/app/src/main/kotlin/app/hapi/companion/feature/sessions/SessionDateRangePickerDialog.kt
PENDING     1  android/app/src/main/kotlin/app/hapi/companion/feature/chat/ChatScreen.kt
PENDING     0  website/src/pages/Home.tsx
PENDING     0  website/src/locales/zh.json
PENDING     0  website/src/locales/en.json
PENDING     0  web/src/components/assistant-ui/markdown-image.tsx
PENDING     0  web/src/components/assistant-ui/markdown-image.test.tsx
PENDING     0  web/src/components/OpencodeSessionImportDialog.tsx
PENDING     0  web/src/components/NewSession/OpencodeImportActions.tsx
PENDING     0  web/src/components/MarkdownRenderer.file-base.test.tsx
PENDING     0  web/src/components/AssistantChat/HappyThread.forward-scroll.test.ts
PENDING     0  web/e2e/chat-markdown-images.spec.ts
PENDING     0  web/e2e-fixtures/notify-summary-fixture.tsx
PENDING     0  web/e2e-fixtures/chat-markdown-images-fixture.tsx
PENDING     0  ios/Hapi/Hapi-macOS.entitlements
PENDING     0  hub/src/web/routes/opencodeSessions.ts
PENDING     0  hub/src/web/routes/opencodeSessions.test.ts
PENDING     0  hub/src/sync/forkWhileRunning.test.ts
PENDING     0  hub/src/sync/archivedFork.test.ts
PENDING     0  hub/src/sync/archiveCleanupError.ts
PENDING     0  e2e/notify-summary.spec.ts
PENDING     0  docs/guide/session-list.md
PENDING     0  cli/src/runner/run.stopSession.test.ts
PENDING     0  cli/src/modules/common/opencodeSessions.ts
PENDING     0  cli/src/modules/common/opencodeSessions.test.ts
PENDING     0  cli/src/modules/common/displayImagePrompt.ts
PENDING     0  cli/src/codex/utils/codexSessionScanner.ts
PENDING     0  cli/src/codex/utils/codexSessionScanner.test.ts
PENDING     0  cli/src/codex/utils/codexEventConverter.ts
PENDING     0  cli/src/codex/utils/codexEventConverter.test.ts
PENDING     0  cli/src/codex/shared/asyncQuestions.ts
PENDING     0  cli/src/codex/shared/asyncQuestions.test.ts
PENDING     0  cli/src/codex/shared/archivedFork.ts
PENDING     0  cli/src/codex/shared/archivedFork.test.ts
PENDING     0  cli/src/codex/session.ts
PENDING     0  cli/src/codex/conversationHistory.ts
PENDING     0  cli/src/codex/conversationHistory.test.ts
PENDING     0  cli/src/codex/codexRemoteLauncher.ts
PENDING     0  cli/src/codex/codexRemoteLauncher.test.ts
PENDING     0  cli/src/codex/codexLocalLauncher.ts
PENDING     0  cli/src/codex/codexLocalLauncher.test.ts
PENDING     0  cli/src/claude/claudeRemoteLauncher.steer.test.ts
PENDING     0  cli/src/claude/claudeRemote.steer.test.ts
PENDING     0  cli/src/agent/runners/runAgentSession.ts
PENDING     0  cli/src/agent/runners/runAgentSession.test.ts
PENDING     0  android/app/src/test/kotlin/app/hapi/companion/ui/theme/HapiTypographyScaleTest.kt
PENDING     0  android/app/src/test/kotlin/app/hapi/companion/feature/settings/SettingsHubCatalogTest.kt
PENDING     0  android/app/src/test/kotlin/app/hapi/companion/feature/chat/composer/ScheduleSendTest.kt
PENDING     0  android/app/src/test/kotlin/app/hapi/companion/feature/chat/PermissionModeChipTest.kt
PENDING     0  android/app/src/main/kotlin/app/hapi/companion/ui/theme/ThemePresets.kt
PENDING     0  android/app/src/main/kotlin/app/hapi/companion/ui/markdown/MermaidDiagram.kt
PENDING     0  android/app/src/main/kotlin/app/hapi/companion/feature/settings/SettingsHubCatalog.kt
PENDING     0  android/app/src/main/kotlin/app/hapi/companion/feature/chat/composer/ScheduleSend.kt
PENDING     0  android/app/src/main/kotlin/app/hapi/companion/feature/chat/composer/ComposerGlyphs.kt
PENDING     0  android/app/src/main/kotlin/app/hapi/companion/feature/chat/PermissionModeChip.kt
PENDING     0  android/app/src/main/kotlin/app/hapi/companion/feature/chat/MessageMetadataViews.kt
PENDING     0  android/app/src/main/kotlin/app/hapi/companion/feature/chat/ContextUsageChip.kt
PENDING     0  android/app/src/androidTest/kotlin/app/hapi/companion/feature/chat/composer/ScheduleComposerTest.kt


## Progress — 2026-11-18, owner cbd1073e

RESOLVED 56 of 253 (delete-vs-modify, decided not merged):
- 21x UD (soup modified, main deleted): main deleted them in `175b768ff chore:
  remove dead tests and the unreachable code they covered`. Took the deletion —
  the code is dead upstream and has nowhere to land.
- 35x DU (soup layer deleted, main modified): kept the soup's deletion. These
  are layer refactors (android chat UI etc). Upstream's edits to files a layer
  removed are moot; porting them is the layer owner's call, not the absorb's.

REMAINING 197: 177 UU + 20 AA, ~675 hunks.

### The 20 AA are one family and must NOT take --theirs
`linkPr.ts`, `LinkPrDialog.tsx`, `SessionPrChip.tsx`, `externalRefs.ts`,
`features.ts`, `modelErrorCopy.ts`, `cursorModelErrorBridge.ts` + tests — fork
features that upstream later landed its own version of, so both sides added the
same paths.

Checked before choosing a side (provenance != currency):

| file | soup | main |
|---|---|---|
| shared/src/externalRefs.ts | **301** | 204 |
| web/src/components/SessionPrChip.tsx | **211** | 197 |
| cli/src/commands/linkPr.ts | **86** | 60 |
| hub/src/web/routes/features.ts | 88 | **92** |

The soup side is LARGER on three of four and carries `needs_work`, which main
does not have at all. Upstream's landed copy is **not** a superset. `--theirs`
here would silently delete fork PR-chip statuses — the exact scar §3b records
(deleted soup helpers, call sites left behind). Union required, per file.

### Hot files still ahead (union rules, §3b)
SessionList.tsx 32 · sessionCache.ts 22 · syncEngine.ts 16 ·
startHappyServer.ts 16 · NewSession/index.tsx 15 · SessionChat.tsx 13

## Deferred debt (deliberate, not forgotten)

**`cli/src/claude/utils/startHappyServer.ts` — took the fork side whole.**
Upstream refactored tool registration into a gated `registerTool()` helper and
moved descriptions into `*_TOOL_DESCRIPTION` constants. Good change. But the
fork registers **16** tools to upstream's 11, and the fork set is a strict
superset: `archive_peer`, `display_links`, `link_issue`, `search_peers` and
`set_voice_mode` exist only on the fork. Adopting upstream's structure in this
pass meant re-porting five registrations by hand into a new helper, in the one
file whose mis-registration served ZERO tools to every new session earlier today
(duplicate `session_job`). Verified the fork side still gates via
`includeTool()` — no blind registration — and that all 16 names are present.

Re-port onto upstream's `registerTool()` shape as its own layer when the kitchen
is calm. Doing it mid-731-hunk-absorb is how you lose a tool silently.

## Passes that moved the needle (731 -> 396)

| pass | basis | result |
|---|---|---|
| delete-vs-modify | upstream dead-code removal (`175b768ff`) vs soup layer refactors | 56 files |
| retired-layer AA | manifest DROP + identifier gate; **unioned, not `--theirs`** | 15 files |
| additive hunks | diff3 base empty = both sides added | 34 files |
| import hunks | union specifier sets, respect fork deletions | 38 hunks |
| android | component-survival check, then soup-tip consistency | 14 files |
| locales | key-union, upstream first, fork wins on clash | 2 files |

## Passes tested and REFUTED (do not retry)
- Droppable ancestor layers: 0 by ancestry, 0 by content. Squash-merge does not
  hide any here, and per the predecessor it would not shrink this MERGE_HEAD
  anyway — tip-forward merges into a tip that already contains the layers.
- One-sided hunks (`base == theirs` or `base == ours`): 0.
- Strict-superset hunks: 0.
