export type {
    CursorAgentStreamFailureKind,
    CursorAgentStreamFailureSource,
    CursorAgentStreamFailure
} from '@hapi/protocol/cursorInlineModelError'

export {
    classifyCursorAgentMessage,
    classifyAcpRpcRejection,
    mapAcpStderrToFailure,
    isCompletionClaim
} from '@hapi/protocol/cursorInlineModelError'
