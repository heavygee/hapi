import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import {
    Navigate,
    Outlet,
    createRootRoute,
    createRoute,
    createRouter,
    useLocation,
    useMatchRoute,
    useNavigate,
    useParams,
    useRouter,
    useSearch,
} from '@tanstack/react-router'
import { getScrollRestorationKey } from '@/lib/scrollRestorationKey'
import {
    getSessionListSelectionNavigation,
    PRESERVE_SESSION_SIDEBAR_SCROLL,
} from '@/lib/sessionNavigation'
import { App } from '@/App'
import { SessionChat } from '@/components/SessionChat'
import { SessionList } from '@/components/SessionList'
import { AgentSessionImportDialog } from '@/components/AgentSessionImportDialog'
import { ConfirmDialog } from '@/components/ui/ConfirmDialog'
import { SessionsModeSwitch, type SessionsMode } from '@/components/SessionsModeSwitch'
import { BoardList } from '@/components/BoardList'
import { BoardItemDetail } from '@/components/BoardItemDetail'
import { resolveBoardItemDirectory } from '@/lib/resolveBoardItemDirectory'
import { buildBoardItemSpawnMessage } from '@/lib/boardItemSpawnMessage'
import { clearBoardSpawnBriefing, peekBoardSpawnBriefing, stashBoardSpawnBriefing } from '@/lib/boardSpawnBriefing'
import { shouldExitBoardsModeForNavigation } from '@/lib/sessionsBoardsModeSync'
import { isAbandoningSpawnFlow } from '@/lib/spawnFlowAbandonment'
import { parseIssueUrl } from '@hapi/protocol/schemas'
import { findSessionLinkedToIssue } from '@/lib/externalRefs'
import type { BoardItem } from '@/types/api'
import { NewSession } from '@/components/NewSession'
import { WorkspaceBrowser } from '@/components/WorkspaceBrowser'
import { LoadingState } from '@/components/LoadingState'
import { useAppContext } from '@/lib/app-context'
import { isOwnerNamespace } from '@/lib/namespace'
import { useAppGoBack } from '@/hooks/useAppGoBack'
import { isTelegramApp } from '@/hooks/useTelegram'
import { useSidebarResize } from '@/hooks/useSidebarResize'
import { useSplitViewport } from '@/hooks/useSplitViewport'
import { useMessages } from '@/hooks/queries/useMessages'
import { useMachines } from '@/hooks/queries/useMachines'
import { useMachineLabels } from '@/hooks/useMachineLabels'
import { useBoards } from '@/hooks/queries/useBoards'
import { useBoardItems } from '@/hooks/queries/useBoardItems'
import { useBoardSelection } from '@/hooks/useBoardSelection'
import { useBoardActions } from '@/hooks/mutations/useBoardActions'
import { useBoardItemActions } from '@/hooks/mutations/useBoardItemActions'
import { getApiErrorMessage } from '@/lib/apiErrorMessage'
import { useSession } from '@/hooks/queries/useSession'
import { useCursorChatStoreStatus } from '@/hooks/queries/useCursorChatStoreStatus'
import { useSessions } from '@/hooks/queries/useSessions'
import { useOnboardingTour, type ShellTourStepId } from '@/lib/use-onboarding-tour'
import { FueCallout, FueDot } from '@/components/Fue'
import { useSlashCommands } from '@/hooks/queries/useSlashCommands'
import { useSkills } from '@/hooks/queries/useSkills'
import { getSessionTitle } from '@/lib/sessionTitle'
import { buildSessionReferenceText, matchSessionsForMention } from '@/lib/sessionReference'
import type { Suggestion } from '@/hooks/useActiveSuggestions'
import { useSendMessage, type SendErrorInfo } from '@/hooks/mutations/useSendMessage'
import type { ComposerSendError } from '@/components/AssistantChat/HappyComposer'
import { ApiError } from '@/api/client'
import type { MessageDeliveryMode } from '@hapi/protocol'
import { queryKeys } from '@/lib/query-keys'
import { useToast } from '@/lib/toast-context'
import { useTranslation } from '@/lib/use-translation'
import { seedMessageWindowFromSession, syncTailMessages } from '@/lib/message-window-store'
import { clearDraftsAfterSend } from '@/lib/clearDraftsAfterSend'
import { transferComposerDraftThenNavigate } from '@/lib/composer-draft-transfer'
import { getDraftAttachments } from '@/lib/composer-attachment-drafts'
import { refreshSessionDetailPreservingActive } from '@/lib/session-detail-optimistic'
import { inactiveSessionCanResume, resolveCursorReopenGate } from '@/lib/sessionResume'
import { initializeSessionLastSeen } from '@/lib/sessionLastSeen'
import { useSelectedSessionSeen } from '@/hooks/useSelectedSessionSeen'
import { useSessionBrowserTitle } from '@/hooks/useSessionBrowserTitle'
import { clearCodexImportedSession, markCodexSessionsImported } from '@/lib/codexImportedSessions'
import { clearClaudeImportedSession, markClaudeSessionsImported } from '@/lib/claudeImportedSessions'
import type { CodexDuplicateSessionGroup, CodexLocalSessionSummary, ClaudeLocalSessionSummary, AgentImportFlavor, CursorImportableSessionSummary, CursorImportRowOutcome } from '@/types/api'
import { getSupersedingSessionId, prepareFollowSupersedingSession, shouldFollowSupersedingSession } from '@/routes/sessions/followSupersedingSession'
import { migrateSuppressedSendError } from '@/lib/suppressed-send-error'
import { useConsumedMessageTarget } from '@/lib/useConsumedMessageTarget'
import FilesPage from '@/routes/sessions/files'
import FilePage from '@/routes/sessions/file'
import TerminalPage from '@/routes/sessions/terminal'
import SettingsLayout from '@/routes/settings/layout'
import SettingsHubPage from '@/routes/settings'
import SettingsGeneralPage from '@/routes/settings/general'
import SettingsRunnerManagementPage from '@/routes/settings/runner-management'
import SettingsDisplayPage from '@/routes/settings/display'
import SettingsChatPage from '@/routes/settings/chat'
import SettingsVoicePage from '@/routes/settings/voice'
import SettingsVoiceVoicesPage from '@/routes/settings/voice-voices'
import SettingsVoiceAdvancedPage from '@/routes/settings/voice-advanced'
import SettingsMachinesPage from '@/routes/settings/machines'
import SettingsAboutPage from '@/routes/settings/about'
import SettingsStoragePage from '@/routes/settings/storage'
import SettingsUsagePage from '@/routes/settings/usage'
import SharePage from '@/routes/share'
import OverseerConsolePage from '@/routes/overseer'
import { retargetSharePendingTransfer, setSharePendingTransfer } from '@/lib/sharePendingState'
import { deleteShareTransfer, parseShareSearch } from '@/lib/shareTransfer'
import { GardenXrEntryChip } from '@/garden/components/GardenXrEntryChip'


function BackIcon(props: { className?: string }) {
    return (
        <svg
            xmlns="http://www.w3.org/2000/svg"
            width="20"
            height="20"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            className={props.className}
        >
            <polyline points="15 18 9 12 15 6" />
        </svg>
    )
}

function PlusIcon(props: { className?: string }) {
    return (
        <svg
            xmlns="http://www.w3.org/2000/svg"
            width="24"
            height="24"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            className={props.className}
        >
            <line x1="12" y1="5" x2="12" y2="19" />
            <line x1="5" y1="12" x2="19" y2="12" />
        </svg>
    )
}

function CodexImportIcon(props: { className?: string }) {
    return (
        <svg
            xmlns="http://www.w3.org/2000/svg"
            width="20"
            height="20"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            className={props.className}
        >
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
            <polyline points="7 10 12 15 17 10" />
            <line x1="12" y1="15" x2="12" y2="3" />
        </svg>
    )
}
function FolderOpenIcon(props: { className?: string }) {
    return (
        <svg
            xmlns="http://www.w3.org/2000/svg"
            width="20"
            height="20"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            className={props.className}
        >
            <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
        </svg>
    )
}


function OverseerIcon(props: { className?: string }) {
    return (
        <svg
            xmlns="http://www.w3.org/2000/svg"
            width="20"
            height="20"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            className={props.className}
        >
            <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7z" />
            <circle cx="12" cy="12" r="3" />
        </svg>
    )
}

function SettingsIcon(props: { className?: string }) {
    return (
        <svg
            xmlns="http://www.w3.org/2000/svg"
            width="20"
            height="20"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            className={props.className}
        >
            <circle cx="12" cy="12" r="3" />
            <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z" />
        </svg>
    )
}

function SessionsPage() {
    const { api, baseUrl, token, titleSuggestionAvailable = false } = useAppContext()
    const navigate = useNavigate()
    const queryClient = useQueryClient()
    const router = useRouter()
    const pathname = useLocation({ select: location => location.pathname })
    const matchRoute = useMatchRoute()
    const { t } = useTranslation()
    const { addToast } = useToast()
    const { sessions, isLoading, error, refetch } = useSessions(api)
    const [initializedHub, setInitializedHub] = useState<string | null>(null)
    const { machines } = useMachines(api, true)
    const [isSyncingCodexSession, setIsSyncingCodexSession] = useState(false)
    const [codexSessions, setCodexSessions] = useState<CodexLocalSessionSummary[]>([])
    const [codexImportMachineId, setCodexImportMachineId] = useState<string | null>(null)
    const [isLoadingCodexSessions, setIsLoadingCodexSessions] = useState(false)
    const [isSyncConfirmOpen, setIsSyncConfirmOpen] = useState(false)
    const [isRestartingCodexDesktop, setIsRestartingCodexDesktop] = useState(false)
    const [pendingDuplicateSessionIds, setPendingDuplicateSessionIds] = useState<string[]>([])
    const [pendingDuplicateHapiSessionIds, setPendingDuplicateHapiSessionIds] = useState<string[]>([])
    const [duplicateSessionGroups, setDuplicateSessionGroups] = useState<CodexDuplicateSessionGroup[]>([])
    const [isDuplicateMergeConfirmOpen, setIsDuplicateMergeConfirmOpen] = useState(false)
    const [isMergingDuplicateSessions, setIsMergingDuplicateSessions] = useState(false)
    const [codexImportWorkDirectoryOverride, setCodexImportWorkDirectoryOverride] = useState<string | null>(null)
    const [isSyncingClaudeSession, setIsSyncingClaudeSession] = useState(false)
    const [claudeSessions, setClaudeSessions] = useState<ClaudeLocalSessionSummary[]>([])
    const [claudeImportMachineId, setClaudeImportMachineId] = useState<string | null>(null)
    const [isLoadingClaudeSessions, setIsLoadingClaudeSessions] = useState(false)
    const [importFlavor, setImportFlavor] = useState<AgentImportFlavor>('codex')
    const [cursorSessions, setCursorSessions] = useState<CursorImportableSessionSummary[]>([])
    const [cursorImportMachineId, setCursorImportMachineId] = useState<string | null>(null)
    const [isLoadingCursorSessions, setIsLoadingCursorSessions] = useState(false)
    const [isImportingCursorSessions, setIsImportingCursorSessions] = useState(false)
    const [cursorLastOutcomes, setCursorLastOutcomes] = useState<CursorImportRowOutcome[] | null>(null)

    const handleRefresh = useCallback(() => {
        return (async () => {
            try {
                await refetch()
            } catch (error) {
                addToast({
                    title: t('sessions.refresh.failed.title'),
                    body: error instanceof Error ? error.message : t('dialog.error.default'),
                    sessionId: '',
                    url: ''
                })
            }
        })()
    }, [addToast, refetch, t])

    const projectCount = useMemo(() => new Set(sessions.map(s =>
        s.metadata?.worktree?.basePath ?? s.metadata?.path ?? 'Other'
    )).size, [sessions])
    const machineLabelsById = useMachineLabels(machines)
    const machinesById = useMemo(() => {
        const byId: Record<string, typeof machines[number]> = {}
        for (const machine of machines) {
            byId[machine.id] = machine
        }
        return byId
    }, [machines])
    // Workspace browsing is opt-in per runner (`--workspace-root`); only show
    // browse affordances when at least one machine reported roots.
    const canBrowse = useMemo(
        () => machines.some(m => (m.metadata?.workspaceRoots?.length ?? 0) > 0),
        [machines]
    )
    const sessionMatch = matchRoute({ to: '/sessions/$sessionId', fuzzy: true })
    const selectedSessionId = sessionMatch && sessionMatch.sessionId !== 'new' ? sessionMatch.sessionId : null
    const selectedSession = useMemo(
        () => selectedSessionId ? sessions.find((session) => session.id === selectedSessionId) ?? null : null,
        [selectedSessionId, sessions]
    )
    useEffect(() => {
        if (isLoading || error) {
            return
        }
        initializeSessionLastSeen(baseUrl, sessions)
        setInitializedHub(baseUrl)
    }, [baseUrl, error, isLoading, sessions])
    useSelectedSessionSeen(selectedSessionId, selectedSession?.updatedAt)
    const currentCodexSessionId = selectedSession?.metadata?.flavor === 'codex'
        ? (selectedSession.metadata.agentSessionId ?? null)
        : null
    const currentWorkDirectory = codexImportWorkDirectoryOverride
        ?? selectedSession?.metadata?.worktree?.basePath
        ?? selectedSession?.metadata?.path
        ?? null
    const currentClaudeSessionId = selectedSession?.metadata?.flavor === 'claude'
        ? (selectedSession.metadata.claudeSessionId ?? null)
        : null
    const isSessionsIndex = pathname === '/sessions' || pathname === '/sessions/'
    const sidebar = useSidebarResize()
    // Shell onboarding tour — spotlights new-session/browse/settings for a
    // brand-new install. See use-onboarding-tour.ts for why this is scoped
    // to /sessions only (mobile single-pane vs desktop split-pane).
    const tour = useOnboardingTour({ sessionCount: sessions.length, sessionsLoaded: !isLoading })
    const tourNewSessionRef = useRef<HTMLButtonElement>(null)
    const tourBrowseRef = useRef<HTMLButtonElement>(null)
    const tourSettingsRef = useRef<HTMLButtonElement>(null)
    const tourStepRef: Record<ShellTourStepId, React.RefObject<HTMLButtonElement | null>> = {
        'new-session': tourNewSessionRef,
        browse: tourBrowseRef,
        settings: tourSettingsRef,
    }
    const tourStepCopy: Record<ShellTourStepId, { title: string; body: string }> = {
        'new-session': { title: t('onboarding.tour.newSession.title'), body: t('onboarding.tour.newSession.body') },
        browse: { title: t('onboarding.tour.browse.title'), body: t('onboarding.tour.browse.body') },
        settings: { title: t('onboarding.tour.settings.title'), body: t('onboarding.tour.settings.body') },
    }
    // Desktop keeps the sidebar mounted even off /sessions (split-pane), so
    // gate the dot the same way as the callout below — otherwise clicking
    // the very button the tour is spotlighting (e.g. "New Session", which
    // navigates to /sessions/new) leaves an unexplained dot pulsing with no
    // callout in sight, since the callout alone was gated on isSessionsIndex.
    const visibleTourStep = isSessionsIndex ? tour.activeStepId : null
    const isSplitViewport = useSplitViewport()
    const [sessionsMode, setSessionsMode] = useState<SessionsMode>('sessions')
    // Every /api/todo-boards route 403s outside the owner namespace — hide
    // the switch itself rather than let a non-owner select it and land on a
    // permanent error (same pattern as the owner-only Settings categories).
    const isOwner = isOwnerNamespace(token)
    // Defensive: hiding the switch (below) only stops a non-owner from
    // ever *entering* To-Do mode. If the effective namespace changes away
    // from owner while already in it (a token refresh mid-session, say),
    // there would otherwise be no way back — every /api/todo-boards call
    // 403s and the switch that could flip back to Sessions mode is gone.
    useEffect(() => {
        if (!isOwner && sessionsMode === 'boards') {
            setSessionsMode('sessions')
        }
    }, [isOwner, sessionsMode])
    const {
        boards: boards,
        isLoading: boardsLoading,
        isRefetching: boardsRefetching,
        error: boardsError,
        refetch: refetchBoards,
    } = useBoards(api, sessionsMode === 'boards')
    const { selectedBoardId, setSelectedBoardId } = useBoardSelection()
    const effectiveBoardId = useMemo(() => {
        if (selectedBoardId && boards.some(board => board.id === selectedBoardId)) {
            return selectedBoardId
        }
        return boards[0]?.id ?? null
    }, [selectedBoardId, boards])
    const {
        items: boardItems,
        statusOrder: boardStatusOrder,
        isLoading: boardItemsLoading,
        isRefetching: boardItemsRefetching,
        error: boardItemsError,
        refetch: refetchBoardItems,
    } = useBoardItems(api, sessionsMode === 'boards' ? effectiveBoardId : null)
    const { addBoard: addBoard, removeBoard: removeBoard } = useBoardActions(api)
    const {
        closeItem: closeBoardItem,
        reopenItem: reopenBoardItem,
        commentOnItem: commentOnBoardItem,
        setItemStatus: setBoardItemStatus,
        closingUrls: closingBoardItemUrls,
        reopeningUrls: reopeningBoardItemUrls,
        commentingUrls: commentingOnBoardItemUrls,
        settingStatusUrls: settingBoardItemStatusUrls,
    } = useBoardItemActions(api, effectiveBoardId)
    const [selectedBoardItemId, setSelectedBoardItemId] = useState<string | null>(null)
    useEffect(() => {
        setSelectedBoardItemId(null)
    }, [sessionsMode, effectiveBoardId])
    const selectedBoardItem = useMemo(
        () => (selectedBoardItemId ? boardItems.find(item => item.id === selectedBoardItemId) ?? null : null),
        [selectedBoardItemId, boardItems]
    )
    // Hidden behind the board list while in Boards mode with an item
    // selected (mobile *and* desktop, since BoardItemDetail then occupies the
    // right-pane slot) — marking it "seen" there would silently clear unread
    // state for messages the user never actually looked at. But Boards mode
    // with *no* item selected falls through to <Outlet/> in that same slot,
    // which still renders the previously-routed session chat underneath — on
    // the desktop split layout that pane stays visible regardless of mode
    // (only the single-pane mobile layout actually hides it), so seen
    // tracking must keep running there too, or messages visibly on screen
    // stay marked unread until the operator switches back to Sessions mode
    // (hapi#238 Codex review, two rounds: the first review caught over-eager
    // seen-tracking while the chat was genuinely hidden behind Boards mode;
    // this one caught the desktop-split case where it's hidden on mobile only).
    const isBoardChatVisibleInSplitView = sessionsMode === 'boards' && selectedBoardItem === null && isSplitViewport
    useSelectedSessionSeen(
        sessionsMode === 'sessions' || isBoardChatVisibleInSplitView ? selectedSessionId : null,
        selectedSession?.updatedAt
    )
    const linkedBoardSession = useMemo(
        () => findSessionLinkedToIssue(sessions, selectedBoardItem?.url ?? null),
        [sessions, selectedBoardItem]
    )
    const handleOpenLinkedBoardSession = useCallback((sessionId: string) => {
        navigate({
            to: '/sessions/$sessionId',
            params: { sessionId },
            ...PRESERVE_SESSION_SIDEBAR_SCROLL,
        })
    }, [navigate])
    // Item detail reuses the session-detail right-pane slot, so it needs the
    // same mobile show/hide signal `isSessionsIndex` drives for sessions —
    // but it's local state, not a route, so it has to opt in explicitly here
    // rather than coming from `pathname` for free. Branching on `sessionsMode`
    // (not `!isSessionsIndex || selectedBoardItem !== null`) matters: mode
    // switching never touches the URL, so a session route can still be live
    // underneath while the operator is in To-Do mode — without this branch,
    // switching to To-Do mode with no item selected yet would leave the
    // previous session's chat showing in the right pane on mobile instead of
    // the to-do list, since `isSessionsIndex` alone has no idea a mode
    // switch happened.
    const hasRightPaneContent = sessionsMode === 'boards' ? selectedBoardItem !== null : !isSessionsIndex
    // See shouldExitBoardsModeForNavigation's doc comment for why this reacts
    // to the navigation event itself rather than comparing selected-session
    // ids before/after.
    useEffect(() => {
        return router.subscribe('onBeforeNavigate', (event) => {
            if (shouldExitBoardsModeForNavigation(event.toLocation.pathname, sessionsMode)) {
                setSessionsMode('sessions')
                setSelectedBoardItemId(null)
            }
        })
    }, [router, sessionsMode])
    const onlineMachineIds = useMemo(() => new Set(machines.map(m => m.id)), [machines])
    const handleSpawnFromBoardItem = useCallback((item: BoardItem) => {
        const resolved = resolveBoardItemDirectory(item.repo, sessions, onlineMachineIds)
        // Only attempt the auto-link for a real GitHub issue URL — board
        // items can also be pull requests or draft issues, and parseIssueUrl
        // only recognizes `/issues/<n>`. Linking a PR URL always 400s on the
        // hub, so skip it rather than spawn with a guaranteed failure toast
        // (hapi#238 Codex review; PR-kind refs are out of scope for now, see
        // ExternalRefSchema's doc comment in shared/src/schemas.ts).
        const linkIssueUrl = item.url && parseIssueUrl(item.url) ? item.url : undefined
        const briefingId = stashBoardSpawnBriefing({
            message: buildBoardItemSpawnMessage(item),
            linkIssueUrl
        })
        // `/sessions/new` is a sibling route under the same `/sessions`
        // parent, so SessionsPage never remounts — without clearing the
        // selected item (and switching back to Sessions mode, so
        // `hasRightPaneContent` stops gating on `selectedBoardItem`), the
        // right pane would keep rendering the stale BoardItemDetail instead
        // of <Outlet/> picking up the new-session form; the URL would change
        // but the screen wouldn't.
        setSelectedBoardItemId(null)
        setSessionsMode('sessions')
        navigate({
            to: '/sessions/new',
            search: {
                ...(resolved ? { directory: resolved.directory } : {}),
                ...(resolved ? { machineId: resolved.machineId } : {}),
                briefingId,
            },
            ...PRESERVE_SESSION_SIDEBAR_SCROLL,
        })
    }, [navigate, sessions, setSelectedBoardItemId, setSessionsMode, onlineMachineIds])
    const handleNewSessionInDirectory = useCallback((args: { machineId: string | null; directory: string }) => {
        navigate({
            to: '/sessions/new',
            search: args.machineId
                ? { directory: args.directory, machineId: args.machineId }
                : { directory: args.directory }
        })
    }, [navigate])

    const isCodexScriptTimeout = useCallback((message: string | null | undefined): boolean => {
        const raw = (message ?? '').trim()
        return /执行超时|timed\s*out|timeout/i.test(raw)
    }, [])

    const normalizeCodexScriptError = useCallback((message: string | null | undefined, fallback: string): string => {
        const raw = (message ?? '').trim()
        if (!raw) return fallback
        if (isCodexScriptTimeout(raw)) {
            return t('codexSync.error.timeout')
        }
        if (/当前会话仍处于活跃状态，请等待会话结束后重试|Active Hapi process already has this Codex thread/i.test(raw)) {
            return t('codexSync.error.active')
        }
        if (/未安装\/找不到codex客户端|unable to find codex launcher|找不到.*codex/i.test(raw)) {
            return t('codexSync.restart.failed.notFound')
        }
        return raw
    }, [isCodexScriptTimeout, t])

    const formatCodexSyncFailureBody = useCallback((reason: string): string => {
        if (
            reason === t('codexSync.error.timeout') ||
            reason === t('codexSync.error.active') ||
            reason === t('codexSync.restart.failed.notFound')
        ) {
            return reason
        }
        return t('codexSync.failed.bodyWithReason', { reason })
    }, [t])

    const closeDuplicateMergeDialog = useCallback(() => {
        // 中文注释：重复会话确认框关闭时一并清空“本次选中导入”的上下文，确保后续检测不会误用上一轮的 codexSessionId。
        setIsDuplicateMergeConfirmOpen(false)
        setPendingDuplicateSessionIds([])
        setPendingDuplicateHapiSessionIds([])
        setDuplicateSessionGroups([])
    }, [])

    const handleRestartCodexDesktop = useCallback(async () => {
        setIsRestartingCodexDesktop(true)
        try {
            const status = await api.getCodexDesktopStatus()
            if (!status.codexClientAvailable) {
                throw new Error(t('codexSync.restart.failed.notFound'))
            }

            const result = await api.restartCodexDesktop()
            if (!result.success) {
                throw new Error(normalizeCodexScriptError(result.error, t('codexSync.restart.failed.body')))
            }
            addToast({
                title: t('codexSync.restart.started.title'),
                body: t('codexSync.restart.started.body'),
                sessionId: '',
                url: ''
            })
        } catch (error) {
            addToast({
                title: t('codexSync.restart.failed.title'),
                body: normalizeCodexScriptError(
                    error instanceof Error ? error.message : null,
                    t('codexSync.restart.failed.body')
                ),
                sessionId: '',
                url: ''
            })
        } finally {
            setIsRestartingCodexDesktop(false)
        }
    }, [addToast, api, normalizeCodexScriptError, t])

    const handleMergeDuplicateSessions = useCallback(async () => {
        if (isMergingDuplicateSessions || pendingDuplicateSessionIds.length === 0) return

        setIsMergingDuplicateSessions(true)
        try {
            const result = await api.mergeCodexDuplicateSessions({ sessionIds: pendingDuplicateSessionIds })
            if (!result.success) {
                throw new Error(normalizeCodexScriptError(result.error, t('codexSync.duplicates.merge.failed.body')))
            }

            addToast({
                title: t('codexSync.duplicates.merge.success.title'),
                body: t('codexSync.duplicates.merge.success.body'),
                sessionId: '',
                url: ''
            })

            const redirectTarget = selectedSessionId
                ? result.merged.find((group) => group.removedSessionIds?.includes(selectedSessionId))
                    ?? result.merged.find((group) => Boolean(group.canonicalSessionId))
                : result.merged.find((group) => Boolean(group.canonicalSessionId))
            const redirectSessionId = redirectTarget?.canonicalSessionId ?? pendingDuplicateHapiSessionIds[0]

            closeDuplicateMergeDialog()
            await Promise.all([
                queryClient.invalidateQueries({ queryKey: queryKeys.sessions }),
                selectedSessionId
                    ? queryClient.invalidateQueries({ queryKey: queryKeys.session(selectedSessionId) })
                    : Promise.resolve(),
                selectedSessionId
                    ? queryClient.invalidateQueries({ queryKey: queryKeys.messages(selectedSessionId) })
                    : Promise.resolve()
            ])
            await refetch()

            if (redirectSessionId) {
                navigate({
                    to: '/sessions/$sessionId',
                    params: { sessionId: redirectSessionId }
                })
            }
        } catch (error) {
            addToast({
                title: t('codexSync.duplicates.merge.failed.title'),
                body: normalizeCodexScriptError(
                    error instanceof Error ? error.message : null,
                    t('codexSync.duplicates.merge.failed.body')
                ),
                sessionId: '',
                url: ''
            })
            throw error
        } finally {
            setIsMergingDuplicateSessions(false)
        }
    }, [
        addToast,
        api,
        closeDuplicateMergeDialog,
        isMergingDuplicateSessions,
        navigate,
        normalizeCodexScriptError,
        pendingDuplicateHapiSessionIds,
        pendingDuplicateSessionIds,
        queryClient,
        refetch,
        selectedSessionId,
        t
    ])

    const loadCursorImportableSessions = useCallback(async (machineId?: string | null) => {
        setIsLoadingCursorSessions(true)
        try {
            const result = await api.getCursorImportableSessions(machineId)
            if (!result.success) {
                throw new Error(result.error || t('cursorSync.failed.body'))
            }
            setCursorSessions(result.sessions)
            setCursorImportMachineId(machineId ?? null)
        } catch (error) {
            setCursorSessions([])
            setCursorImportMachineId(null)
            addToast({
                title: t('cursorSync.failed.title'),
                body: error instanceof Error ? error.message : t('cursorSync.failed.body'),
                sessionId: '',
                url: ''
            })
        } finally {
            setIsLoadingCursorSessions(false)
        }
    }, [addToast, api, t])

    const loadClaudeImportableSessions = useCallback(async (workDirectory?: string | null, machineId?: string | null) => {
        setIsLoadingClaudeSessions(true)
        try {
            const result = await api.getClaudeSessions(workDirectory, machineId)
            if (!result.success) {
                throw new Error(result.error || t('claudeSync.failed.body'))
            }
            setClaudeSessions(result.sessions)
            setClaudeImportMachineId(machineId ?? null)
        } catch (error) {
            setClaudeSessions([])
            setClaudeImportMachineId(null)
            addToast({
                title: t('claudeSync.failed.title'),
                body: t('claudeSync.failed.bodyWithReason', {
                    reason: error instanceof Error ? error.message : t('dialog.error.default')
                }),
                sessionId: '',
                url: ''
            })
        } finally {
            setIsLoadingClaudeSessions(false)
        }
    }, [addToast, api, t])

    const openCodexImportDialog = useCallback(async (workDirectory?: string | null) => {
        setCodexImportWorkDirectoryOverride(workDirectory?.trim() || null)
        if (isLoadingCodexSessions) return

        setIsSyncConfirmOpen(true)
        setCursorLastOutcomes(null)
        void loadCursorImportableSessions()
        void loadClaudeImportableSessions(workDirectory)
        setIsLoadingCodexSessions(true)
        try {
            const result = await api.getCodexSessions(workDirectory)
            setCodexSessions(result.sessions)
            setCodexImportMachineId(result.machineId ?? null)
        } catch (error) {
            setCodexSessions([])
            setCodexImportMachineId(null)
            const reason = normalizeCodexScriptError(
                error instanceof Error ? error.message : null,
                t('dialog.error.default')
            )
            addToast({
                title: t('codexSync.failed.title'),
                body: formatCodexSyncFailureBody(reason),
                sessionId: '',
                url: ''
            })
        } finally {
            setIsLoadingCodexSessions(false)
        }
    }, [addToast, api, formatCodexSyncFailureBody, isLoadingCodexSessions, loadClaudeImportableSessions, loadCursorImportableSessions, normalizeCodexScriptError, t])

    const handleImportCursorSessions = useCallback(async (uuids: string[]) => {
        if (isImportingCursorSessions || isLoadingCursorSessions) return
        setIsImportingCursorSessions(true)
        try {
            const selections = uuids.map((uuid) => {
                const session = cursorSessions.find((entry) => entry.id === uuid)
                return {
                    uuid,
                    workspacePath: session?.workspacePath ?? null,
                    machineId: session?.machineId ?? cursorImportMachineId
                }
            })
            const result = await api.importCursorSessions({
                selections
            })
            if (!result.success) {
                throw new Error(result.error || t('cursorSync.failed.body'))
            }
            setCursorLastOutcomes(result.results)
            const okCount = result.importedCount
            const total = result.results.length
            if (okCount === total) {
                addToast({
                    title: t('cursorSync.success.title'),
                    body: t('cursorSync.success.body', { n: okCount }),
                    sessionId: '',
                    url: ''
                })
                setIsSyncConfirmOpen(false)
            } else {
                addToast({
                    title: t('cursorSync.partial.title'),
                    body: t('cursorSync.partial.body', { ok: okCount, total }),
                    sessionId: '',
                    url: ''
                })
            }
            await refetch()
            void loadCursorImportableSessions(cursorImportMachineId)
        } catch (error) {
            addToast({
                title: t('cursorSync.failed.title'),
                body: error instanceof Error ? error.message : t('cursorSync.failed.body'),
                sessionId: '',
                url: ''
            })
        } finally {
            setIsImportingCursorSessions(false)
        }
    }, [
        addToast,
        api,
        cursorImportMachineId,
        cursorSessions,
        isImportingCursorSessions,
        isLoadingCursorSessions,
        loadCursorImportableSessions,
        refetch,
        t
    ])

    const handleArchiveCodexSession = useCallback(async (codexSession: import('@/types/api').CodexLocalSessionSummary) => {
        if (!api) return
        const result = await api.archiveCodexSession(
            codexSession.id,
            codexSession.machineId ?? codexImportMachineId
        )
        if (!result.success) {
            throw new Error(result.error)
        }
        setCodexSessions((current) => current.filter((session) => session.id !== codexSession.id))
    }, [api, codexImportMachineId])

    const handleImportCodexSessions = useCallback(async (sessionIds: string[]) => {
        if (isSyncingCodexSession || isLoadingCodexSessions) return

        setIsSyncingCodexSession(true)
        try {
            // Estate-wide: omit machineId so hub fans out using per-row owners.
            const result = await api.syncCodexSession({ sessionIds, cwd: currentWorkDirectory })
            if (!result.success) {
                throw new Error(normalizeCodexScriptError(result.error, t('codexSync.failed.body')))
            }

            addToast({
                title: t('codexSync.success.title'),
                body: t('codexSync.success.body', { n: result.syncedCount ?? sessionIds.length }),
                sessionId: '',
                url: ''
            })
            // 中文注释：导入成功后先在浏览器侧记住这些 Codex thread 的导入时间，供左侧会话列表显示特殊时间文案。
            markCodexSessionsImported(sessionIds)
            setIsSyncConfirmOpen(false)
            await refetch()

            setPendingDuplicateSessionIds([])
            setPendingDuplicateHapiSessionIds(result.hapiSessionIds ?? [])
            setDuplicateSessionGroups([])
            setIsDuplicateMergeConfirmOpen(false)
            try {
                // 中文注释：重复会话检测严格限定在这次用户勾选导入的 codexSessionId 范围内；未勾选的其它会话不参与检测，也不弹合并提示。
                const duplicateResult = await api.getCodexDuplicateSessions({ sessionIds })
                if (!duplicateResult.success) {
                    throw new Error(normalizeCodexScriptError(
                        duplicateResult.error,
                        t('codexSync.duplicates.detect.failed.body')
                    ))
                }

                if (duplicateResult.duplicates.length > 0) {
                    setPendingDuplicateSessionIds(sessionIds)
                    setPendingDuplicateHapiSessionIds(result.hapiSessionIds ?? [])
                    setDuplicateSessionGroups(duplicateResult.duplicates)
                    setIsDuplicateMergeConfirmOpen(true)
                }
            } catch (duplicateError) {
                addToast({
                    title: t('codexSync.duplicates.detect.failed.title'),
                    body: normalizeCodexScriptError(
                        duplicateError instanceof Error ? duplicateError.message : null,
                        t('codexSync.duplicates.detect.failed.body')
                    ),
                    sessionId: '',
                    url: ''
                })
            }
        } catch (syncError) {
            const reason = normalizeCodexScriptError(
                syncError instanceof Error ? syncError.message : null,
                t('dialog.error.default')
            )
            addToast({
                title: t('codexSync.failed.title'),
                body: formatCodexSyncFailureBody(reason),
                sessionId: '',
                url: ''
            })
        } finally {
            setIsSyncingCodexSession(false)
        }
    }, [
        addToast,
        api,
        formatCodexSyncFailureBody,
        codexImportMachineId,
        currentWorkDirectory,
        isLoadingCodexSessions,
        isSyncingCodexSession,
        normalizeCodexScriptError,
        refetch,
        setDuplicateSessionGroups,
        setIsDuplicateMergeConfirmOpen,
        setPendingDuplicateHapiSessionIds,
        setPendingDuplicateSessionIds,
        t
    ])

    const handleImportClaudeSessions = useCallback(async (sessionIds: string[]) => {
        if (isSyncingClaudeSession || isLoadingClaudeSessions) return

        setIsSyncingClaudeSession(true)
        try {
            const result = await api.syncClaudeSession({
                sessionIds,
                cwd: currentWorkDirectory
            })
            if (!result.success) {
                throw new Error(result.error || t('claudeSync.failed.body'))
            }

            addToast({
                title: t('claudeSync.success.title'),
                body: t('claudeSync.success.body', { n: result.syncedCount ?? sessionIds.length }),
                sessionId: '',
                url: ''
            })
            markClaudeSessionsImported(sessionIds)
            setIsSyncConfirmOpen(false)
            await refetch()
        } catch (syncError) {
            addToast({
                title: t('claudeSync.failed.title'),
                body: t('claudeSync.failed.bodyWithReason', {
                    reason: syncError instanceof Error ? syncError.message : t('dialog.error.default')
                }),
                sessionId: '',
                url: ''
            })
        } finally {
            setIsSyncingClaudeSession(false)
        }
    }, [
        addToast,
        api,
        currentWorkDirectory,
        isLoadingClaudeSessions,
        isSyncingClaudeSession,
        refetch,
        t
    ])

    return (
        <>
            <div className="flex h-full min-h-0">
            <div
                className={`${hasRightPaneContent ? 'hidden split:flex' : 'flex'} w-full shrink-0 flex-col bg-[var(--app-bg)]`}
                style={{ '--sidebar-w': `${sidebar.width}px` } as React.CSSProperties}
            >
                <div className="flex min-h-0 flex-1 flex-col pt-[env(safe-area-inset-top)]">
                    {isOwner ? (
                        <div className="mx-auto w-full max-w-content shrink-0">
                            <SessionsModeSwitch mode={sessionsMode} onChange={setSessionsMode} />
                        </div>
                    ) : null}
                    {error && sessionsMode === 'sessions' ? (
                        <div className="mx-auto w-full max-w-content px-3 py-2">
                            <div className="text-sm text-red-600">{error}</div>
                        </div>
                    ) : null}
                    {sessionsMode === 'boards' ? (
                        <BoardList
                            boards={boards}
                            selectedBoardId={effectiveBoardId}
                            onSelectBoard={setSelectedBoardId}
                            onAddBoard={addBoard}
                            onRemoveBoard={removeBoard}
                            items={boardItems}
                            statusOrder={boardStatusOrder}
                            isLoading={boardsLoading || boardItemsLoading}
                            error={boardsError ?? boardItemsError}
                            selectedItemId={selectedBoardItemId}
                            onSelectItem={(item) => setSelectedBoardItemId(item.id)}
                            onRefresh={() => {
                                // The boards list must also be refetched, not
                                // just items — otherwise this button does
                                // nothing when an initial /todo-boards
                                // failure left no board loaded (Codex
                                // review). But `enabled: false` only gates
                                // *automatic* fetching, not a manually called
                                // `refetch()` — TanStack Query still runs the
                                // queryFn on a disabled query's refetch(),
                                // which throws "API unavailable" with no
                                // board id, replacing a valid empty-boards
                                // state with a false failure (Codex review,
                                // second pass). Only refetch items when a
                                // board actually exists to refetch.
                                void refetchBoards()
                                if (effectiveBoardId) {
                                    void refetchBoardItems()
                                }
                            }}
                            isRefreshing={boardsRefetching || boardItemsRefetching}
                            sessions={sessions}
                            onOpenSession={handleOpenLinkedBoardSession}
                        />
                    ) : (
                    <SessionList
                        key={initializedHub === baseUrl ? 'last-seen-ready' : 'last-seen-pending'}
                        sessions={sessions}
                        selectedSessionId={selectedSessionId}
                        onSelect={(sessionId, targetMessageId, targetMessageQuery) => {
                            if (targetMessageId) {
                                return navigate({
                                    to: '/sessions/$sessionId',
                                    params: { sessionId },
                                    search: {
                                        messageId: targetMessageId,
                                        ...(targetMessageQuery ? { messageQuery: targetMessageQuery } : {})
                                    },
                                    ...PRESERVE_SESSION_SIDEBAR_SCROLL,
                                })
                            }
                            return navigate(getSessionListSelectionNavigation(sessionId))
                        }}
                        onNewSession={() => navigate({
                            to: '/sessions/new',
                            ...PRESERVE_SESSION_SIDEBAR_SCROLL,
                        })}
                        onNewSessionInDirectory={handleNewSessionInDirectory}
                        onBrowse={canBrowse ? () => navigate({ to: '/browse' }) : undefined}
                        onRefresh={handleRefresh}
                        isLoading={isLoading}
                        renderHeader={false}
                        headerActions={(
                            <div className="flex items-center gap-2">
                                <button
                                    type="button"
                                    onClick={() => void openCodexImportDialog()}
                                    disabled={isSyncingCodexSession || isLoadingCodexSessions || isImportingCursorSessions || isSyncingClaudeSession || isLoadingClaudeSessions}
                                    aria-label={t('agentImport.tooltip')}
                                    aria-busy={isSyncingCodexSession || isLoadingCodexSessions || isImportingCursorSessions || isSyncingClaudeSession || isLoadingClaudeSessions}
                                    className="p-1.5 rounded-full text-[var(--app-hint)] hover:text-[var(--app-fg)] hover:bg-[var(--app-subtle-bg)] transition-colors disabled:opacity-60 disabled:cursor-wait"
                                    title={t('agentImport.tooltip')}
                                >
                                    <CodexImportIcon className={`h-5 w-5 ${isLoadingCodexSessions || isLoadingCursorSessions || isLoadingClaudeSessions ? 'animate-spin' : ''}`} />
                                </button>
                                {canBrowse && (
                                    <button
                                        ref={tourBrowseRef}
                                        type="button"
                                        onClick={() => navigate({ to: '/browse' })}
                                        className="relative p-1.5 rounded-full text-[var(--app-hint)] hover:text-[var(--app-fg)] hover:bg-[var(--app-subtle-bg)] transition-colors"
                                        title={t('browse.nav')}
                                    >
                                        <FolderOpenIcon className="h-5 w-5" />
                                        {visibleTourStep === 'browse' ? (
                                            <FueDot pulsing ariaLabel={t('fue.newFeatureDot')} />
                                        ) : null}
                                    </button>
                                )}
                                <button
                                    type="button"
                                    onClick={() => navigate({ to: '/overseer' })}
                                    className="p-1.5 rounded-full text-[var(--app-hint)] hover:text-[var(--app-fg)] hover:bg-[var(--app-subtle-bg)] transition-colors"
                                    title="Overseer"
                                >
                                    <OverseerIcon className="h-5 w-5" />
                                </button>
                                <button
                                    ref={tourSettingsRef}
                                    type="button"
                                    onClick={() => navigate({ to: '/settings' })}
                                    className="relative p-1.5 rounded-full text-[var(--app-hint)] hover:text-[var(--app-fg)] hover:bg-[var(--app-subtle-bg)] transition-colors"
                                    title={t('settings.title')}
                                >
                                    <SettingsIcon className="h-5 w-5" />
                                    {visibleTourStep === 'settings' ? (
                                        <FueDot pulsing ariaLabel={t('fue.newFeatureDot')} />
                                    ) : null}
                                </button>
                                <button
                                    ref={tourNewSessionRef}
                                    type="button"
                                    onClick={() => navigate({
                                        to: '/sessions/new',
                                        ...PRESERVE_SESSION_SIDEBAR_SCROLL,
                                    })}
                                    className="session-list-new-button relative flex h-9 w-9 items-center justify-center rounded-full text-[var(--app-link)] transition-colors"
                                    title={t('sessions.new')}
                                >
                                    <PlusIcon className="h-5 w-5" />
                                    {visibleTourStep === 'new-session' ? (
                                        <FueDot pulsing ariaLabel={t('fue.newFeatureDot')} />
                                    ) : null}
                                </button>
                            </div>
                        )}
                        api={api}
                        machineLabelsById={machineLabelsById}
                        machinesById={machinesById}
                    />
                    )}
                    {visibleTourStep && sessionsMode === 'sessions' ? (
                        <FueCallout
                            title={tourStepCopy[visibleTourStep].title}
                            body={tourStepCopy[visibleTourStep].body}
                            anchorRef={tourStepRef[visibleTourStep]}
                            onDismiss={tour.next}
                            dismissLabel={tour.isLastStep ? t('onboarding.tour.finish') : t('onboarding.tour.next')}
                            closeAriaLabel={t('fue.closeAriaLabel')}
                            onSecondaryAction={tour.skipAll}
                            secondaryActionLabel={t('onboarding.tour.skip')}
                        />
                    ) : null}
                </div>
            </div>

            {/* Resize handle - desktop only */}
            <div
                className="sidebar-resize-handle hidden split:block shrink-0"
                data-dragging={sidebar.isDragging || undefined}
                onPointerDown={sidebar.onPointerDown}
            />

            <div className={`${hasRightPaneContent ? 'flex' : 'hidden split:flex'} min-w-0 flex-1 flex-col bg-[var(--app-bg)]`}>
                <div className="flex-1 min-h-0">
                    {selectedBoardItem ? (
                        <BoardItemDetail
                            // Remount on item switch — local state (comment draft, the
                            // close-confirm dialog's open flag) must not bleed from the
                            // previously-selected item onto the newly-selected one.
                            key={selectedBoardItem.id}
                            item={selectedBoardItem}
                            statusOrder={boardStatusOrder}
                            onBack={() => setSelectedBoardItemId(null)}
                            onSpawn={() => handleSpawnFromBoardItem(selectedBoardItem)}
                            linkedSessionId={linkedBoardSession?.id ?? null}
                            onOpenLinkedSession={handleOpenLinkedBoardSession}
                            onRefresh={() => { void refetchBoardItems() }}
                            isRefreshing={boardItemsRefetching}
                            onClose={() => closeBoardItem(selectedBoardItem)}
                            onReopen={() => {
                                reopenBoardItem(selectedBoardItem).catch((err) => addToast({
                                    title: t('boards.detail.reopenFailed'),
                                    body: getApiErrorMessage(err, t('dialog.error.default')),
                                    sessionId: '',
                                    url: ''
                                }))
                            }}
                            onComment={(body) => {
                                return commentOnBoardItem(selectedBoardItem, body).catch((err) => {
                                    addToast({
                                        title: t('boards.detail.commentFailed'),
                                        body: getApiErrorMessage(err, t('dialog.error.default')),
                                        sessionId: '',
                                        url: ''
                                    })
                                    throw err
                                })
                            }}
                            onSetStatus={(status) => {
                                setBoardItemStatus(selectedBoardItem, status).catch((err) => addToast({
                                    title: t('boards.detail.statusChangeFailed'),
                                    body: getApiErrorMessage(err, t('dialog.error.default')),
                                    sessionId: '',
                                    url: ''
                                }))
                            }}
                            isClosing={selectedBoardItem.url !== null && closingBoardItemUrls.has(selectedBoardItem.url)}
                            isReopening={selectedBoardItem.url !== null && reopeningBoardItemUrls.has(selectedBoardItem.url)}
                            isCommenting={selectedBoardItem.url !== null && commentingOnBoardItemUrls.has(selectedBoardItem.url)}
                            isSettingStatus={selectedBoardItem.url !== null && settingBoardItemStatusUrls.has(selectedBoardItem.url)}
                        />
                    ) : (
                        <Outlet />
                    )}
                </div>
            </div>
            </div>
            {/* Multi-agent session import: Codex + Cursor + Claude tabs. */}
            <AgentSessionImportDialog
                isOpen={isSyncConfirmOpen}
                onClose={() => {
                    setIsSyncConfirmOpen(false)
                    setCodexImportWorkDirectoryOverride(null)
                    setCodexImportMachineId(null)
                }}
                flavor={importFlavor}
                onChangeFlavor={setImportFlavor}
                codexSessions={codexSessions}
                currentCodexSessionId={currentCodexSessionId}
                isLoadingCodex={isLoadingCodexSessions}
                isPendingCodex={isSyncingCodexSession}
                isRestartingCodexDesktop={isRestartingCodexDesktop}
                onConfirmCodex={handleImportCodexSessions}
                onRestartCodexDesktop={handleRestartCodexDesktop}
                onArchiveCodexSession={handleArchiveCodexSession}
                cursorSessions={cursorSessions}
                isLoadingCursor={isLoadingCursorSessions}
                isPendingCursor={isImportingCursorSessions}
                cursorLastOutcomes={cursorLastOutcomes}
                onConfirmCursor={handleImportCursorSessions}
                claudeSessions={claudeSessions}
                currentClaudeSessionId={currentClaudeSessionId}
                isLoadingClaude={isLoadingClaudeSessions}
                isPendingClaude={isSyncingClaudeSession}
                onConfirmClaude={handleImportClaudeSessions}
            />
            <ConfirmDialog
                isOpen={isDuplicateMergeConfirmOpen && duplicateSessionGroups.length > 0}
                onClose={closeDuplicateMergeDialog}
                title={t('codexSync.duplicates.confirm.title')}
                description={t('codexSync.duplicates.confirm.description')}
                confirmLabel={t('codexSync.duplicates.confirm.confirm')}
                confirmingLabel={t('codexSync.duplicates.confirm.confirming')}
                onConfirm={handleMergeDuplicateSessions}
                isPending={isMergingDuplicateSessions}
            />
        </>
    )
}

function SessionsIndexPage() {
    return null
}

/**
 * Classify a thrown send error into a {message, code} pair the composer can
 * render.  `code` lets the consumer attach a recovery affordance (Reopen on
 * `session_inactive`) without re-inspecting the raw error.
 *
 * `request<T>` in the api client throws `ApiError` for !res.ok with `status`
 * and `code` parsed from the JSON body.  Older / non-JSON failures arrive as
 * plain `Error`; we surface those by their message verbatim, falling back to
 * a localized default when nothing usable is present (e.g. an aborted fetch
 * that resolved with no message).
 */
function classifySendError(
    error: unknown,
    t: (key: string) => string,
): { message: string; code: string | null } {
    if (error instanceof ApiError && error.status === 409 && error.code === 'session_inactive') {
        return { message: t('chat.sendError.sessionInactive'), code: 'session_inactive' }
    }
    if (error instanceof Error && error.message) {
        return { message: error.message, code: null }
    }
    return { message: t('chat.sendError.fallback'), code: null }
}

function SessionPage() {
    const { api } = useAppContext()
    const { t } = useTranslation()
    const goBack = useAppGoBack()
    const navigate = useNavigate()
    const queryClient = useQueryClient()
    const { addToast } = useToast()
    const { sessionId } = useParams({ from: '/sessions/$sessionId' })
    const { outline, log, messageId, messageQuery } = useSearch({ from: '/sessions/$sessionId' })
    const {
        effectiveMessageId: effectiveInitialMessageId,
        effectiveMessageQuery: effectiveInitialMessageQuery,
        consume: consumeMessageTarget,
        clear: clearConsumedMessageTarget,
    } = useConsumedMessageTarget(sessionId, messageId, messageQuery)
    const {
        session,
        error: sessionError,
        refetch: refetchSession,
    } = useSession(api, sessionId)
    const {
        status: cursorChatStoreStatus,
        isApplicable: cursorChatStoreApplicable,
        error: cursorChatStoreError,
        isLoading: cursorChatStoreLoading,
    } = useCursorChatStoreStatus({ api, session })
    const {
        messages,
        warning: messagesWarning,
        isSyncingTail: messagesSyncingTail,
        isLoadingMore: messagesLoadingMore,
        hasMore: messagesHasMore,
        loadMore: loadMoreMessages,
        cancelLoadMore: cancelLoadMoreMessages,
        refetch: refetchMessages,
        loadMessageContext: loadMessageContextForSession,
        viewMode: messagesViewMode,
        messagesVersion,
        historyVersion,
        tailRevision,
        historySeekActive,
        setViewMode,
        seekToMessage,
        returnToLatest,
        jumpToTail,
    } = useMessages(api, sessionId, {
        skipInitialTailSync: Boolean(effectiveInitialMessageId?.trim())
    })

    // Tracks the most recent send the hub rejected (4xx/5xx/network), keyed
    // by the session the failed POST actually targeted (post-resolveSessionId).
    // assistant-ui clears the composer eagerly when a send is invoked, so to
    // retain the typed text on error we keep it here and hand it back to the
    // composer for restore + visual error affordance.  Keying by sessionId
    // covers the inactive-session resume race: useSendMessage can resolve
    // the target id, kick off async navigation to it, and then have the POST
    // fail before navigation completes.  Without keying, we'd restore the
    // text into the OLD session's composer and the next render would clear
    // it.  The bumped `id` still lets the composer dedupe restorations of
    // identical text.
    //
    // We persist the classifier `code` (not the bound action) so the
    // composer-visible action stays reactive to `reopeningSessionId` state
    // changes -- the action is built fresh on each render from {raw error
    // record} x {current reopen state}.  See classifySendError + the
    // Reopen affordance below.
    type RawSendError = {
        id: number
        text: string
        message: string
        code: string | null
        scheduledAt: number | null
        deliveryMode: MessageDeliveryMode
        mutationStarted: boolean
        restoreSuppressed: boolean
    }
    const [sendErrors, setSendErrors] = useState<Record<string, RawSendError>>({})
    const [reopeningSessionId, setReopeningSessionId] = useState<string | null>(null)
    const sendErrorIdRef = useRef(0)
    const clearSendError = useCallback(() => {
        setSendErrors((prev) => {
            if (!(sessionId in prev)) return prev
            const next = { ...prev }
            delete next[sessionId]
            return next
        })
    }, [sessionId])

    const suppressSendErrorRestore = useCallback((id: number) => {
        setSendErrors((prev) => {
            const current = prev[sessionId]
            if (!current || current.id !== id || current.restoreSuppressed) return prev
            return {
                ...prev,
                [sessionId]: { ...current, restoreSuppressed: true }
            }
        })
    }, [sessionId])

    // Reopen recovery (#918): one-click affordance attached to the inline
    // composer error when the rejected send was inactive-session.  Mirrors
    // SessionList's Reopen UX -- POST /sessions/:id/reopen via
    // api.reopenSession -- so the operator's mental model is consistent
    // across surfaces.  We do NOT auto-replay the send: per #917 the reopen
    // path has known fragility, so the operator re-clicks Send on the
    // restored composer text once Reopen lands.
    const reopenFromErrorAffordance = useCallback((errorSessionId: string) => {
        if (!api) return
        setReopeningSessionId((prev) => prev ?? errorSessionId)
        void (async () => {
            try {
                const result = await api.reopenSession(errorSessionId)
                // Clear the inline error -- the operator now has a live
                // session to retry against.
                setSendErrors((prev) => {
                    if (!(errorSessionId in prev)) return prev
                    const next = { ...prev }
                    delete next[errorSessionId]
                    return next
                })
                await queryClient.invalidateQueries({ queryKey: queryKeys.session(result.sessionId) })
                await queryClient.invalidateQueries({ queryKey: queryKeys.sessions })
                if (result.sessionId && result.sessionId !== errorSessionId) {
                    retargetSharePendingTransfer(errorSessionId, result.sessionId)
                    await transferComposerDraftThenNavigate(
                        errorSessionId,
                        result.sessionId,
                        () => navigate({
                            to: '/sessions/$sessionId',
                            params: { sessionId: result.sessionId },
                            replace: true
                        }),
                    )
                }
            } catch (err) {
                const message = err instanceof Error ? err.message : t('dialog.error.default')
                addToast({
                    title: t('resume.failed.title'),
                    body: message,
                    sessionId: errorSessionId,
                    url: ''
                })
            } finally {
                setReopeningSessionId(null)
            }
        })()
    }, [api, queryClient, navigate, addToast, t])

    const cursorReopenGate = resolveCursorReopenGate({
        applicable: cursorChatStoreApplicable,
        onDisk: cursorChatStoreStatus?.onDisk,
        error: cursorChatStoreError,
        isLoading: cursorChatStoreLoading,
    })
    const cursorReopenDisabledReason = cursorReopenGate.disabledReason === 'missing'
        ? t('session.action.reopenCursorMissing')
        : cursorReopenGate.disabledReason === 'checking'
            ? t('session.action.reopenCursorChecking')
            : undefined
    const cursorReopenUnverifiedHint = cursorReopenGate.probeUnverified
        ? t('session.action.reopenCursorUnverified')
        : undefined
    const canOfferInactiveReopen = session
        ? inactiveSessionCanResume(session, messages.length, cursorChatStoreStatus?.onDisk)
        : false
    const rawSendError = sendErrors[sessionId] ?? null
    const sendError: ComposerSendError | null = rawSendError
        ? {
            id: rawSendError.id,
            text: rawSendError.text,
            message: rawSendError.message,
            scheduledAt: rawSendError.scheduledAt,
            deliveryMode: rawSendError.deliveryMode,
            mutationStarted: rawSendError.mutationStarted,
            restoreSuppressed: rawSendError.restoreSuppressed,
            action: rawSendError.code === 'session_inactive' && canOfferInactiveReopen
                ? {
                    label: t('chat.sendError.sessionInactive.action'),
                    onClick: () => reopenFromErrorAffordance(sessionId),
                    pending: reopeningSessionId === sessionId
                }
                : null
        }
        : null

    const resolvedSessionRef = useRef<{ source: string; target: Promise<string> } | null>(null)
    // Clear when the session id or active flag changes so a same-id resume
    // that later archives again cannot reuse a stale in-flight/cached resume.
    useEffect(() => {
        resolvedSessionRef.current = null
    }, [session?.id, session?.active])
    const resolveSessionId = useCallback(async (currentSessionId: string) => {
        if (!api || !session || session.active) {
            return { sessionId: currentSessionId, resumed: false }
        }
        const cached = resolvedSessionRef.current
        if (cached?.source === currentSessionId) {
            return { sessionId: await cached.target, resumed: true }
        }
        if (!inactiveSessionCanResume(session, messages.length, cursorChatStoreStatus?.onDisk)) {
            throw new ApiError(
                t('chat.sendError.sessionInactive'),
                409,
                'session_inactive',
            )
        }
        try {
            const target = api.resumeSession(currentSessionId, { permissionMode: session.permissionMode ?? undefined })
            resolvedSessionRef.current = { source: currentSessionId, target }
            return { sessionId: await target, resumed: true }
        } catch (error) {
            if (resolvedSessionRef.current?.source === currentSessionId) {
                resolvedSessionRef.current = null
            }
            const message = error instanceof Error ? error.message : t('dialog.error.default')
            addToast({
                title: t('resume.failed.title'),
                body: message,
                sessionId: currentSessionId,
                url: ''
            })
            throw new ApiError(
                t('chat.sendError.sessionInactive'),
                409,
                'session_inactive',
            )
        }
    }, [api, session, messages.length, cursorChatStoreStatus?.onDisk, t, addToast])

    const handleSessionResolved = useCallback((resolvedSessionId: string) => {
        if (session) {
            if (resolvedSessionId !== session.id) {
                retargetSharePendingTransfer(session.id, resolvedSessionId)
                seedMessageWindowFromSession(session.id, resolvedSessionId)
            }
            queryClient.setQueryData(queryKeys.session(resolvedSessionId), (previous: { session?: typeof session } | undefined) => ({
                session: { ...(previous?.session ?? session), id: resolvedSessionId, active: true }
            }))
            void queryClient.invalidateQueries({ queryKey: queryKeys.sessions })
        }
        navigate({
            to: '/sessions/$sessionId',
            params: { sessionId: resolvedSessionId },
            replace: true
        })
        if (api) {
            void refreshSessionDetailPreservingActive(
                queryClient,
                resolvedSessionId,
                () => api.getSession(resolvedSessionId),
            )
            void syncTailMessages(api, resolvedSessionId).catch(() => {})
        }
    }, [api, navigate, queryClient, session])

    const {
        sendMessage,
        retryMessage,
        isSending,
        sendSettlement,
    } = useSendMessage(api, sessionId, {
        isSessionThinking: session?.thinking ?? false,
        onSuccess: (sentSessionId) => {
            clearDraftsAfterSend(sentSessionId, sessionId)
            // 中文注释：一旦用户已经在 Hapi 内继续这个 Codex 会话，就清除"刚从 Codex 导入"的标记。
            clearCodexImportedSession(session?.metadata?.codexSessionId)
            // 中文注释：Claude 会话同理；用户在 Hapi 内继续后清除"刚从 Claude 导入"的标记。
            clearClaudeImportedSession(session?.metadata?.claudeSessionId)
            // A successful send supersedes any previously-rendered error
            // for that session.  Other sessions' errors stay put.
            setSendErrors((prev) => {
                if (!(sentSessionId in prev)) return prev
                const next = { ...prev }
                delete next[sentSessionId]
                return next
            })
        },
        onError: (info: SendErrorInfo) => {
            sendErrorIdRef.current += 1
            const { message, code } = classifySendError(info.error, t)
            setSendErrors((prev) => ({
                ...prev,
                [info.sessionId]: {
                    id: sendErrorIdRef.current,
                    text: info.text,
                    message,
                    code,
                    scheduledAt: info.scheduledAt,
                    deliveryMode: info.deliveryMode,
                    mutationStarted: info.mutationStarted,
                    restoreSuppressed: false,
                }
            }))
        },
        resolveSessionId,
        onSessionResolved: async (resolvedSessionId, context) => {
            if (!sessionId) return undefined
            setSendErrors((prev) => migrateSuppressedSendError(prev, sessionId, resolvedSessionId))
            if (session && resolvedSessionId !== session.id) {
                retargetSharePendingTransfer(session.id, resolvedSessionId)
            }
            await transferComposerDraftThenNavigate(
                sessionId,
                resolvedSessionId,
                () => handleSessionResolved(resolvedSessionId),
                [],
                // assistant-ui clears composer text without awaiting this path;
                // keep the submitted snapshot so deferred hydration still has it.
                { textOverride: context.text },
            )
            // Cross-session resume: visible metadata may still carry source-scoped
            // upload paths, and inactive remounts hide stored files entirely.
            // Always defer so the active target can hydrate/re-upload before POST.
            const stored = await getDraftAttachments(resolvedSessionId)
            if ((context.attachments?.length ?? 0) > 0 || stored.length > 0) {
                return { deferUntilDraftHydrated: true }
            }
            return undefined
        },

        onBlocked: (reason) => {
            if (reason === 'no-api') {
                addToast({
                    title: t('send.blocked.title'),
                    body: t('send.blocked.noConnection'),
                    sessionId: sessionId ?? '',
                    url: ''
                })
            }
            // 'no-session' and 'pending' don't need toast - either invalid state or expected behavior
        }
    })

    // Get agent type from session metadata for slash commands
    const agentType = session?.metadata?.flavor ?? 'claude'
    const {
        commands: slashCommands,
        getSuggestions: getSlashSuggestions,
    } = useSlashCommands(api, sessionId, agentType)
    const {
        getSuggestions: getSkillSuggestions,
    } = useSkills(api, sessionId)
    // Mention pool is stricter than sidebar (#1506): titled sessions only; match via sessionMatchesQuery.
    const { sessions: allSessions } = useSessions(api)
    const { machines: mentionMachines } = useMachines(api, true)
    const mentionMachineLabelsById = useMachineLabels(mentionMachines)
    // Same fallbacks as share picker / SessionList search.
    const resolveMentionMachineLabel = useCallback((machineId: string | null) => {
        if (machineId && mentionMachineLabelsById[machineId]) {
            return mentionMachineLabelsById[machineId]
        }
        if (machineId) {
            return machineId.slice(0, 8)
        }
        return t('machine.unknown')
    }, [mentionMachineLabelsById, t])

    const getAutocompleteSuggestions = useCallback(async (query: string) => {
        if (query.startsWith('@')) {
            const search = query.slice(1)
            // v1: plain-text expansion (same grammar as Copy reference) — #1213.
            // v2: segmented rich composer with inline session tokens — #1215.
            // Match via sessionMatchesQuery (share/sidebar); label/insert via getSessionTitle.
            const sessionHits = matchSessionsForMention(allSessions, search, {
                excludeId: sessionId,
                limit: 20,
                resolveMachineLabel: resolveMentionMachineLabel,
            }).map((s) => {
                const title = getSessionTitle(s)
                const mentionText = buildSessionReferenceText(title, s.id)
                const idPrefix = s.id.slice(0, 8)
                return {
                    key: `session:${s.id}`,
                    text: mentionText,
                    label: `@${title || idPrefix}`,
                    description: s.active
                        ? `Session · ${idPrefix} · active`
                        : `Session · ${idPrefix}`,
                    // Rich composer atom; textarea path still inserts `text` prose.
                    sessionMention: { id: s.id, title: title || idPrefix },
                }
            })

            const fileHits: Suggestion[] = []
            if ((agentType === 'codex' || agentType === 'copilot') && api && sessionId) {
                const response = await api.searchSessionFiles(sessionId, search, 50)
                if (response.success && response.files) {
                    for (const file of response.files) {
                        // Codex App Server expects @"path"; Copilot CLI uses @path (relative preferred).
                        const mentionText = agentType === 'copilot'
                            ? `@${file.fullPath}`
                            : `@"${file.fullPath.replace(/(["\\])/g, '\\$1')}"`
                        fileHits.push({
                            key: mentionText,
                            text: mentionText,
                            label: `@${file.fileName}`,
                            description: file.filePath || file.fullPath,
                        })
                    }
                }
            }

            return [...sessionHits, ...fileHits]
        }
        if (query.startsWith('$')) {
            return await getSkillSuggestions(query)
        }
        return await getSlashSuggestions(query)
    }, [
        agentType,
        api,
        sessionId,
        allSessions,
        resolveMentionMachineLabel,
        getSkillSuggestions,
        getSlashSuggestions,
    ])

    const refreshSelectedSession = useCallback(async () => {
        await Promise.all([
            refetchSession(),
            refetchMessages(),
        ])
    }, [refetchMessages, refetchSession])

    const handleInitialOutlineConsumed = useCallback(() => {
        navigate({
            to: '/sessions/$sessionId',
            params: { sessionId },
            replace: true,
        })
    }, [navigate, sessionId])

    const handleInitialSessionLogConsumed = useCallback(() => {
        navigate({
            to: '/sessions/$sessionId',
            params: { sessionId },
            replace: true,
        })
    }, [navigate, sessionId])

    const handleInitialMessageConsumed = useCallback(() => {
        if (messageId) {
            consumeMessageTarget()
        }
        navigate({
            to: '/sessions/$sessionId',
            params: { sessionId },
            replace: true,
            ...PRESERVE_SESSION_SIDEBAR_SCROLL,
        })
    }, [consumeMessageTarget, messageId, navigate, sessionId])

    const handleSearchTargetDismissed = useCallback(() => {
        clearConsumedMessageTarget()
        navigate({
            to: '/sessions/$sessionId',
            params: { sessionId },
            replace: true,
            ...PRESERVE_SESSION_SIDEBAR_SCROLL,
        })
    }, [clearConsumedMessageTarget, navigate, sessionId])

    const handleSearchMessage = useCallback((messageId: string, messageQuery: string) => {
        clearConsumedMessageTarget()
        navigate({
            to: '/sessions/$sessionId',
            params: { sessionId },
            search: {
                messageId,
                messageQuery,
            },
            replace: true,
            ...PRESERVE_SESSION_SIDEBAR_SCROLL,
        })
    }, [clearConsumedMessageTarget, navigate, sessionId])

    if (!session) {
        if (sessionError) {
            return (
                <div className="flex h-full flex-col items-center justify-center gap-3 p-4 text-center">
                    <div className="text-sm font-medium text-[var(--app-fg)]">Session unavailable</div>
                    <div className="max-w-md text-xs text-[var(--app-hint)]">{sessionError}</div>
                    <div className="flex gap-2">
                        <button
                            type="button"
                            onClick={() => navigate({ to: '/sessions', replace: true })}
                            className="rounded-md border border-[var(--app-border)] px-3 py-1.5 text-sm text-[var(--app-fg)] hover:bg-[var(--app-secondary-bg)]"
                        >
                            Back to sessions
                        </button>
                        <button
                            type="button"
                            onClick={() => { void refetchSession() }}
                            className="rounded-md bg-[var(--app-button)] px-3 py-1.5 text-sm text-[var(--app-button-text)]"
                        >
                            Retry
                        </button>
                    </div>
                </div>
            )
        }
        return (
            <div className="flex-1 flex items-center justify-center p-4">
                <LoadingState label="Loading session…" className="text-sm" />
            </div>
        )
    }

    return (
        <SessionChat
            api={api}
            session={session}
            cursorChatOnDisk={cursorChatStoreStatus?.onDisk}
            reopenDisabledReason={cursorReopenDisabledReason}
            reopenHint={cursorReopenUnverifiedHint}
            messages={messages}
            messagesWarning={messagesWarning}
            hasMoreMessages={messagesHasMore}
            isSyncingTail={messagesSyncingTail}
            isLoadingMoreMessages={messagesLoadingMore}
            isSending={isSending}
            sendSettlement={sendSettlement}
            viewMode={messagesViewMode}
            messagesVersion={messagesVersion}
            historyVersion={historyVersion}
            tailRevision={tailRevision}
            historySeekActive={historySeekActive}
            onBack={goBack}
            onRefresh={refreshSelectedSession}
            onLoadMore={loadMoreMessages}
            onCancelLoadMore={cancelLoadMoreMessages}
            onSend={sendMessage}
            resolveSessionIdForUpload={async (id) => (await resolveSessionId(id)).sessionId}
            onUploadSessionResolved={handleSessionResolved}
            onViewModeChange={setViewMode}
            onSeekToMessage={seekToMessage}
            onReturnToLatest={returnToLatest}
            onJumpToTail={jumpToTail}
            onRetryMessage={retryMessage}
            autocompleteSuggestions={getAutocompleteSuggestions}
            availableSlashCommands={slashCommands}
            sendError={sendError}
            onClearSendError={clearSendError}
            onSuppressSendErrorRestore={suppressSendErrorRestore}
            initialOutlineOpen={outline}
            onInitialOutlineConsumed={handleInitialOutlineConsumed}
            initialSessionLogOpen={log}
            onInitialSessionLogConsumed={handleInitialSessionLogConsumed}
            initialTargetMessageId={effectiveInitialMessageId}
            initialTargetMessageQuery={effectiveInitialMessageQuery}
            onLoadMessageContext={loadMessageContextForSession}
            onInitialTargetConsumed={handleInitialMessageConsumed}
            onSearchTargetDismissed={handleSearchTargetDismissed}
            onSearchMessage={handleSearchMessage}
            onAbortRestore={(text) => {
                sendErrorIdRef.current += 1
                setSendErrors((prev) => ({
                    ...prev,
                    [sessionId]: {
                        id: sendErrorIdRef.current,
                        text,
                        message: t('chat.sendError.aborted'),
                        code: 'abort',
                        scheduledAt: null,
                        deliveryMode: 'queue',
                        mutationStarted: true,
                        restoreSuppressed: false
                    }
                }))
            }}
        />
    )
}

function SessionDetailRoute() {
    const { api } = useAppContext()
    const pathname = useLocation({ select: location => location.pathname })
    const { sessionId } = useParams({ from: '/sessions/$sessionId' })
    const navigate = useNavigate()
    const { session, notFound: sessionNotFound } = useSession(api, sessionId)
    useSessionBrowserTitle(session)
    const basePath = `/sessions/${sessionId}`
    const isChat = pathname === basePath || pathname === `${basePath}/`
    const supersedingSessionId = getSupersedingSessionId(sessionId, session?.metadata)
    const observedSessionRef = useRef<{
        sessionId: string
        supersedingSessionId: string | null
    } | null>(null)

    useEffect(() => {
        if (!session) {
            return
        }
        const shouldFollow = shouldFollowSupersedingSession(
            observedSessionRef.current,
            sessionId,
            session.metadata
        )
        observedSessionRef.current = { sessionId, supersedingSessionId }
        if (!shouldFollow || !supersedingSessionId) return
        prepareFollowSupersedingSession(sessionId, supersedingSessionId)
        navigate({
            to: '/sessions/$sessionId',
            params: { sessionId: supersedingSessionId },
            replace: true
        })
    }, [navigate, session, sessionId, supersedingSessionId])

    useEffect(() => {
        if (!sessionNotFound) {
            return
        }
        navigate({ to: '/sessions', replace: true })
    }, [navigate, sessionNotFound, sessionId])

    if (sessionNotFound) {
        return (
            <div className="flex-1 flex items-center justify-center p-4">
                <LoadingState label="Session not found. Returning to sessions…" className="text-sm" />
            </div>
        )
    }

    return isChat ? <SessionPage /> : <Outlet />
}

function NewSessionPage() {
    const { api } = useAppContext()
    const navigate = useNavigate()
    const goBack = useAppGoBack()
    const router = useRouter()
    const queryClient = useQueryClient()
    const { machines, isLoading: machinesLoading, error: machinesError } = useMachines(api, true)
    const { t } = useTranslation()
    const { addToast } = useToast()
    const { directory: initialDirectory, machineId: initialMachineId, shareTransferId, briefingId } = newSessionRoute.useSearch()

    const briefing = useMemo(() => briefingId ? peekBoardSpawnBriefing(briefingId) : null, [briefingId])

    // Set synchronously (before the success navigate) so the generic
    // abandonment cleanup below skips the success path — `handleSuccess`
    // handles shareTransferId/briefingId itself, and differently: it marks
    // the share transfer as *completed into this session* (setSharePendingTransfer),
    // not deleted, so the receiving flow can still look it up. Deleting it
    // out from under that on the same navigate() call would break it.
    const spawnedRef = useRef(false)

    // Abandoning the spawn flow — by any means — must clean up the stash, or
    // a to-do item's briefing (private board content; the whole reason this
    // travels via sessionStorage instead of the URL) sits there indefinitely
    // and a later browser Forward can resurrect it in the composer (hapi#238
    // Codex review, two passes: the first only covered the explicit Cancel/
    // header-Back buttons, missing browser/device back-driven abandonment
    // entirely, since neither button's onClick runs for that). Subscribing
    // to the router's own navigation event covers every abandonment path
    // uniformly — explicit buttons, a toast/link click elsewhere, and
    // browser-history navigation alike — the same mechanism already proven
    // for exiting To-Do mode on any session-targeting navigation. `/browse`
    // is excluded: `handleChooseFolder`'s round-trip through it and back is
    // a deliberate continuation of this same spawn, not an abandonment.
    useEffect(() => {
        return router.subscribe('onBeforeNavigate', (event) => {
            if (spawnedRef.current) return
            const toSearch = event.toLocation.search as { briefingId?: unknown; shareTransferId?: unknown }
            if (!isAbandoningSpawnFlow('/sessions/new', event.toLocation.pathname, { briefingId, shareTransferId }, toSearch)) return
            if (shareTransferId) void deleteShareTransfer(shareTransferId)
            if (briefingId) clearBoardSpawnBriefing(briefingId)
        })
    }, [router, shareTransferId, briefingId])

    const handleCancel = useCallback(() => {
        if (shareTransferId) {
            void deleteShareTransfer(shareTransferId)
        }
        if (briefingId) clearBoardSpawnBriefing(briefingId)
        navigate({
            to: '/sessions',
            ...PRESERVE_SESSION_SIDEBAR_SCROLL,
        })
    }, [navigate, shareTransferId, briefingId])

    // The header Back button calls the generic goBack (browser-history-aware,
    // not a hardcoded /sessions navigate) rather than handleCancel.
    const handleHeaderBack = useCallback(() => {
        goBack()
    }, [goBack])

    // Fires only for a genuine fresh spawn (NewSession's `onSessionCreated`,
    // its plain-create success path) — NOT the other three success paths
    // NewSession shares the same /sessions/new route with (Codex duplicate-
    // merge redirect, Codex-import resume, Pi-import reopen). Those are
    // unrelated operator actions reachable from the same page a board-spawn
    // navigated to; delivering the board's briefing to whatever session they
    // produce would send the wrong content to the wrong session, and the
    // duplicate-merge redirect target specifically can still be momentarily
    // inactive, which 400s on the messages route's requireActive guard
    // (Codex review, hapi#238).
    const handleBoardSpawnDelivery = useCallback((sessionId: string) => {
        if (briefing?.message && api) {
            // Deliver as a real incoming message — same mechanism
            // spawn_peer/hapi-ping-peer use — instead of seeding the
            // composer draft for the operator to send themselves (operator
            // feedback, 2026-10-13: a left-unsent draft "defeats the point").
            // Fire-and-forget: a failed delivery shouldn't block the spawn
            // flow the operator is already mid-navigation through — the
            // session still exists and is usable, just without its briefing.
            api.sendMessage(sessionId, briefing.message).catch(() => {
                addToast({
                    title: t('boards.detail.spawnMessageFailed'),
                    body: t('boards.detail.spawnMessageFailedBody'),
                    sessionId,
                    url: ''
                })
            })
        }
        const linkIssueUrl = briefing?.linkIssueUrl
        if (linkIssueUrl && api) {
            // Fire-and-forget: a failed link shouldn't block the spawn flow the
            // operator is already mid-navigation through. The session still
            // exists and is usable without its issue chip.
            api.linkIssue(sessionId, linkIssueUrl).catch(() => {
                addToast({
                    title: t('boards.detail.linkIssueFailed'),
                    body: t('boards.detail.linkIssueFailedBody', { url: linkIssueUrl }),
                    sessionId,
                    url: ''
                })
            })
        }
    }, [briefing, api, addToast, t])

    const handleSuccess = useCallback((sessionId: string) => {
        spawnedRef.current = true
        if (shareTransferId) {
            setSharePendingTransfer(shareTransferId, sessionId)
        }
        if (briefingId) {
            clearBoardSpawnBriefing(briefingId)
        }
        void queryClient.invalidateQueries({ queryKey: queryKeys.sessions })
        // Replace current page with /sessions to clear spawn flow from history
        navigate({
            to: '/sessions',
            replace: true,
            ...PRESERVE_SESSION_SIDEBAR_SCROLL,
        })
        // Then navigate to new session
        requestAnimationFrame(() => {
            navigate({
                to: '/sessions/$sessionId',
                params: { sessionId },
                ...PRESERVE_SESSION_SIDEBAR_SCROLL,
            })
        })
    }, [navigate, queryClient, shareTransferId, briefingId])

    const handleChooseFolder = useCallback((args: { machineId: string | null; directory: string }) => {
        // Forward the currently-selected machine so /browse opens scoped to
        // it rather than falling back to `hapi:lastMachineId`, which can
        // disagree if the user changed machines without yet creating a
        // session. Preserve shareTransferId/briefingId so a share-target or
        // to-do spawn that detours through /browse still seeds after success.
        const search: { machineId?: string; shareTransferId?: string; briefingId?: string } = {}
        if (args.machineId) search.machineId = args.machineId
        if (shareTransferId) search.shareTransferId = shareTransferId
        if (briefingId) search.briefingId = briefingId
        navigate({ to: '/browse', search })
    }, [navigate, shareTransferId, briefingId])

    return (
        <div className="flex h-full min-h-0 flex-col">
            <div className="flex items-center gap-2 border-b border-[var(--app-border)] bg-[var(--app-bg)] p-3 pt-[calc(0.75rem+env(safe-area-inset-top))]">
                {!isTelegramApp() && (
                    <button
                        type="button"
                        onClick={goBack}
                        className="flex h-8 w-8 items-center justify-center rounded-full text-[var(--app-hint)] transition-colors hover:bg-[var(--app-secondary-bg)] hover:text-[var(--app-fg)]"
                    >
                        <BackIcon />
                    </button>
                )}
                <div className="flex-1 font-semibold">{t('newSession.title')}</div>
            </div>

            <div
                className="app-scroll-y flex-1 min-h-0"
                style={{ paddingBottom: 'calc(var(--app-floating-bottom-offset, 0px) + env(safe-area-inset-bottom))' }}
            >
                {machinesError ? (
                    <div className="p-3 text-sm text-red-600">
                        {machinesError}
                    </div>
                ) : null}

                <NewSession
                    api={api}
                    machines={machines}
                    isLoading={machinesLoading}
                    onCancel={handleCancel}
                    onSuccess={handleSuccess}
                    onSessionCreated={handleBoardSpawnDelivery}
                    onChooseFolder={handleChooseFolder}
                    initialDirectory={initialDirectory}
                    initialMachineId={initialMachineId}
                />
            </div>
        </div>
    )
}

function BrowsePage() {
    const { api } = useAppContext()
    const navigate = useNavigate()
    const goBack = useAppGoBack()
    const router = useRouter()
    const { machines, isLoading: machinesLoading } = useMachines(api, true)
    const { t } = useTranslation()
    const { machineId: initialMachineId, shareTransferId, briefingId } = browseRoute.useSearch()

    // Mirrors NewSessionPage's own cleanup — a to-do spawn's "Choose folder"
    // detour carries the same briefing/share-transfer into this route's own
    // search params, and abandoning from HERE (a toast click, browser back,
    // anything other than completing the round trip back to `/sessions/new`)
    // needs the same cleanup `/sessions/new` has, or the stash is orphaned
    // just as easily from this leg of the flow (Codex review).
    useEffect(() => {
        return router.subscribe('onBeforeNavigate', (event) => {
            const toSearch = event.toLocation.search as { briefingId?: unknown; shareTransferId?: unknown }
            if (!isAbandoningSpawnFlow('/browse', event.toLocation.pathname, { briefingId, shareTransferId }, toSearch)) return
            if (shareTransferId) void deleteShareTransfer(shareTransferId)
            if (briefingId) clearBoardSpawnBriefing(briefingId)
        })
    }, [router, shareTransferId, briefingId])

    const handleStartSession = useCallback((machineId: string, directory: string) => {
        navigate({
            to: '/sessions/new',
            search: {
                directory,
                machineId,
                ...(shareTransferId ? { shareTransferId } : {}),
                ...(briefingId ? { briefingId } : {}),
            },
        })
    }, [navigate, shareTransferId, briefingId])

    return (
        <div className="flex h-full min-h-0 flex-col">
            <div className="flex items-center gap-2 border-b border-[var(--app-border)] bg-[var(--app-bg)] p-3 pt-[calc(0.75rem+env(safe-area-inset-top))]">
                {!isTelegramApp() && (
                    <button
                        type="button"
                        onClick={goBack}
                        className="flex h-8 w-8 items-center justify-center rounded-full text-[var(--app-hint)] transition-colors hover:bg-[var(--app-secondary-bg)] hover:text-[var(--app-fg)]"
                    >
                        <BackIcon />
                    </button>
                )}
                <div className="flex-1 font-semibold">{t('browse.title')}</div>
            </div>

            <div className="flex-1 min-h-0">
                <WorkspaceBrowser
                    api={api}
                    machines={machines}
                    machinesLoading={machinesLoading}
                    onStartSession={handleStartSession}
                    initialMachineId={initialMachineId}
                />
            </div>
        </div>
    )
}

const rootRoute = createRootRoute({
    component: App,
})

const indexRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/',
    component: () => <Navigate to="/sessions" replace />,
})

const sessionsRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/sessions',
    component: SessionsPage,
})

const sessionsIndexRoute = createRoute({
    getParentRoute: () => sessionsRoute,
    path: '/',
    component: SessionsIndexPage,
})

const sessionDetailRoute = createRoute({
    getParentRoute: () => sessionsRoute,
    path: '$sessionId',
    validateSearch: (search: Record<string, unknown>): { outline?: boolean; log?: boolean; messageId?: string; messageQuery?: string } => {
        const outline = search.outline === true || search.outline === 'true'
        const log = search.log === true || search.log === 'true'
        const messageId = typeof search.messageId === 'string' && search.messageId.length > 0
            ? search.messageId
            : undefined
        const messageQuery = typeof search.messageQuery === 'string' && search.messageQuery.length > 0
            ? search.messageQuery
            : undefined
        return {
            ...(outline ? { outline: true } : {}),
            ...(log ? { log: true } : {}),
            ...(messageId ? { messageId } : {}),
            ...(messageQuery ? { messageQuery } : {})
        }
    },
    component: SessionDetailRoute,
})

const sessionFilesRoute = createRoute({
    getParentRoute: () => sessionDetailRoute,
    path: 'files',
    validateSearch: (search: Record<string, unknown>): { tab?: 'changes' | 'directories'; query?: string } => {
        const tabValue = typeof search.tab === 'string' ? search.tab : undefined
        const tab = tabValue === 'directories'
            ? 'directories'
            : tabValue === 'changes'
                ? 'changes'
                : undefined
        const query = typeof search.query === 'string' && search.query.length > 0
            ? search.query
            : undefined

        return {
            ...(tab ? { tab } : {}),
            ...(query ? { query } : {}),
        }
    },
    component: FilesPage,
})

const sessionTerminalRoute = createRoute({
    getParentRoute: () => sessionDetailRoute,
    path: 'terminal',
    component: TerminalPage,
})

type SessionFileSearch = {
    path: string
    staged?: boolean
    tab?: 'changes' | 'directories'
    query?: string
    origin?: 'chat'
}

const sessionFileRoute = createRoute({
    getParentRoute: () => sessionDetailRoute,
    path: 'file',
    validateSearch: (search: Record<string, unknown>): SessionFileSearch => {
        const path = typeof search.path === 'string' ? search.path : ''
        const staged = search.staged === true || search.staged === 'true'
            ? true
            : search.staged === false || search.staged === 'false'
                ? false
                : undefined

        const tabValue = typeof search.tab === 'string' ? search.tab : undefined
        const tab = tabValue === 'directories'
            ? 'directories'
            : tabValue === 'changes'
                ? 'changes'
                : undefined
        const query = typeof search.query === 'string' && search.query.length > 0
            ? search.query
            : undefined
        const origin = search.origin === 'chat' ? 'chat' : undefined

        const result: SessionFileSearch = { path }
        if (staged !== undefined) {
            result.staged = staged
        }
        if (tab !== undefined) {
            result.tab = tab
        }
        if (query !== undefined) {
            result.query = query
        }
        if (origin !== undefined) {
            result.origin = origin
        }
        return result
    },
    component: FilePage,
})

type NewSessionSearch = {
    directory?: string
    machineId?: string
    shareTransferId?: string
    initialMessage?: string
    linkIssueUrl?: string
    briefingId?: string
}

const newSessionRoute = createRoute({
    getParentRoute: () => sessionsRoute,
    path: 'new',
    validateSearch: (search: Record<string, unknown>): NewSessionSearch => {
        const result: NewSessionSearch = {}
        if (typeof search.directory === 'string' && search.directory) {
            result.directory = search.directory
        }
        if (typeof search.machineId === 'string' && search.machineId) {
            result.machineId = search.machineId
        }
        if (typeof search.shareTransferId === 'string' && search.shareTransferId) {
            result.shareTransferId = search.shareTransferId
        }
        if (typeof search.initialMessage === 'string' && search.initialMessage) {
            result.initialMessage = search.initialMessage
        }
        if (typeof search.linkIssueUrl === 'string' && search.linkIssueUrl) {
            result.linkIssueUrl = search.linkIssueUrl
        }
        if (typeof search.briefingId === 'string' && search.briefingId) {
            result.briefingId = search.briefingId
        }
        return result
    },
    component: NewSessionPage,
})

const browseRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/browse',
    validateSearch: (search: Record<string, unknown>): { machineId?: string; shareTransferId?: string; briefingId?: string } => {
        const result: { machineId?: string; shareTransferId?: string; briefingId?: string } = {}
        if (typeof search.machineId === 'string' && search.machineId) {
            result.machineId = search.machineId
        }
        if (typeof search.shareTransferId === 'string' && search.shareTransferId) {
            result.shareTransferId = search.shareTransferId
        }
        if (typeof search.briefingId === 'string' && search.briefingId) {
            result.briefingId = search.briefingId
        }
        return result
    },
    component: BrowsePage,
})


const overseerRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/overseer',
    component: OverseerConsolePage,
})

const settingsRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/settings',
    component: SettingsLayout,
})

const settingsIndexRoute = createRoute({
    getParentRoute: () => settingsRoute,
    path: '/',
    component: SettingsHubPage,
})

const settingsGeneralRoute = createRoute({
    getParentRoute: () => settingsRoute,
    path: 'general',
    component: SettingsGeneralPage,
})

const settingsRunnerManagementRoute = createRoute({
    getParentRoute: () => settingsRoute,
    path: 'general/runners',
    component: SettingsRunnerManagementPage,
})

const settingsDisplayRoute = createRoute({
    getParentRoute: () => settingsRoute,
    path: 'display',
    component: SettingsDisplayPage,
})

const settingsChatRoute = createRoute({
    getParentRoute: () => settingsRoute,
    path: 'chat',
    component: SettingsChatPage,
})

const settingsVoiceRoute = createRoute({
    getParentRoute: () => settingsRoute,
    path: 'voice',
    component: SettingsVoicePage,
})

const settingsVoiceVoicesRoute = createRoute({
    getParentRoute: () => settingsRoute,
    path: 'voice/voices',
    component: SettingsVoiceVoicesPage,
})

const settingsVoiceAdvancedRoute = createRoute({
    getParentRoute: () => settingsRoute,
    path: 'voice/advanced',
    component: SettingsVoiceAdvancedPage,
})

const settingsMachinesRoute = createRoute({
    getParentRoute: () => settingsRoute,
    path: 'machines',
    component: SettingsMachinesPage,
})

const settingsAboutRoute = createRoute({
    getParentRoute: () => settingsRoute,
    path: 'about',
    component: SettingsAboutPage,
})

const settingsStorageRoute = createRoute({
    getParentRoute: () => settingsRoute,
    path: 'storage',
    component: SettingsStoragePage,
})

const settingsUsageRoute = createRoute({
    getParentRoute: () => settingsRoute,
    path: 'usage',
    component: SettingsUsagePage,
})

// Web Share Target landing route. Service worker (`web/src/sw.ts`)
// intercepts the manifest's `POST /share` and 303-redirects here with an
// IDB transfer id. `error=ingest` is set when the SW failed to write IDB.
// Native / deep-link clients open `/share#url=&text=&title=` (fragment, not
// query) so shared content is never part of the HTTP request line.
const shareRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/share',
    validateSearch: (search: Record<string, unknown>) => parseShareSearch(search),
    component: SharePage,
})

const GardenPageLazy = lazy(() =>
    import('@/garden/GardenPage').then(m => ({ default: m.GardenPage }))
)

const gardenRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/garden',
    component: () => (
        <Suspense fallback={null}>
            <GardenPageLazy />
        </Suspense>
    ),
})

export const routeTree = rootRoute.addChildren([
    indexRoute,
    sessionsRoute.addChildren([
        sessionsIndexRoute,
        newSessionRoute,
        sessionDetailRoute.addChildren([
            sessionTerminalRoute,
            sessionFilesRoute,
            sessionFileRoute,
        ]),
    ]),
    overseerRoute,
    browseRoute,
    settingsRoute.addChildren([
        settingsIndexRoute,
        settingsGeneralRoute,
        settingsRunnerManagementRoute,
        settingsDisplayRoute,
        settingsChatRoute,
        settingsVoiceRoute,
        settingsVoiceVoicesRoute,
        settingsVoiceAdvancedRoute,
        settingsMachinesRoute,
        settingsStorageRoute,
        settingsUsageRoute,
        settingsAboutRoute,
    ]),
    shareRoute,
    gardenRoute,
])

type RouterHistory = Parameters<typeof createRouter>[0]['history']

export function createAppRouter(history?: RouterHistory) {
    return createRouter({
        routeTree,
        history,
        scrollRestoration: true,
        getScrollRestorationKey,
    })
}

export type AppRouter = ReturnType<typeof createAppRouter>

declare module '@tanstack/react-router' {
    interface Register {
        router: AppRouter
    }
}
