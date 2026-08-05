import {
    classifyCursorAgentMessage,
    isCompletionClaim
} from '@hapi/protocol/cursorInlineModelError'
import { unwrapRoleWrappedRecordEnvelope } from '@hapi/protocol/messages'
import { MetadataSchema, type Metadata } from '@hapi/protocol/schemas'
import { isObject } from '@hapi/protocol'
import type { Store, StoredSession } from '../store'

const MAX_RAW_SNIPPET = 400
const MAX_LAST_USER_MESSAGE_CHARS = 32_000

export function extractCursorInlineClassifiableText(content: unknown): string | null {
    const record = unwrapRoleWrappedRecordEnvelope(content)
    if (!record || record.role !== 'agent') {
        return null
    }

    const inner = record.content
    if (!isObject(inner)) {
        return null
    }

    if (inner.type === 'event') {
        return null
    }

    if (inner.type === 'codex' && isObject(inner.data)) {
        const data = inner.data
        if (data.type === 'message' && typeof data.message === 'string') {
            return data.message
        }
        if (data.type === 'error' && typeof data.message === 'string') {
            return data.message
        }
    }

    return null
}

function extractUserMessageText(content: unknown): string | null {
    const record = unwrapRoleWrappedRecordEnvelope(content)
    if (!record || record.role !== 'user') {
        return null
    }

    const inner = record.content
    if (!isObject(inner)) {
        return null
    }

    if (inner.type === 'text' && typeof inner.text === 'string') {
        return inner.text
    }

    return null
}

function truncateLastUserMessage(message: string): string {
    if (message.length <= MAX_LAST_USER_MESSAGE_CHARS) {
        return message
    }
    return message.slice(0, MAX_LAST_USER_MESSAGE_CHARS)
}

function findLastUserMessage(store: Store, sessionId: string): string {
    const messages = store.messages.getMessages(sessionId, 100)
    for (let index = messages.length - 1; index >= 0; index -= 1) {
        const text = extractUserMessageText(messages[index]?.content)
        if (text && text.trim().length > 0) {
            return truncateLastUserMessage(text)
        }
    }
    return ''
}

function priorAssistantClaimsDone(store: Store, sessionId: string, beforeSeq: number): boolean {
    const messages = store.messages.getMessages(sessionId, 100)
    for (let index = messages.length - 1; index >= 0; index -= 1) {
        const message = messages[index]
        if (!message || message.seq >= beforeSeq) {
            continue
        }
        const text = extractCursorInlineClassifiableText(message.content)
        if (!text) {
            continue
        }
        return isCompletionClaim(text)
    }
    return false
}

function shouldSkipPromotion(existing: Metadata['lastModelError'], rawSnippet: string): boolean {
    if (!existing || existing.acknowledgedAt !== undefined) {
        return false
    }
    return existing.rawSnippet === rawSnippet
}

export function tryPromoteCursorInlineModelErrorFromMessage(args: {
    store: Store
    sessionId: string
    session: StoredSession
    content: unknown
    atTs: number
    messageSeq: number
}): boolean {
    const parsedMetadata = MetadataSchema.safeParse(args.session.metadata)
    if (!parsedMetadata.success || parsedMetadata.data.flavor !== 'cursor') {
        return false
    }
    const metadata = parsedMetadata.data

    const text = extractCursorInlineClassifiableText(args.content)
    if (!text) {
        return false
    }

    const failure = classifyCursorAgentMessage(text)
    if (!failure) {
        return false
    }

    const rawSnippet = failure.raw.slice(0, MAX_RAW_SNIPPET)
    if (shouldSkipPromotion(metadata.lastModelError, rawSnippet)) {
        return false
    }

    const lastUserMessage = findLastUserMessage(args.store, args.sessionId)
    const nextLastModelError: NonNullable<Metadata['lastModelError']> = {
        kind: failure.kind,
        transient: failure.transient,
        rawSnippet,
        atTs: args.atTs,
        priorAssistantClaimsDone: priorAssistantClaimsDone(args.store, args.sessionId, args.messageSeq),
        ...(lastUserMessage ? { lastUserMessage } : {})
    }

    for (let attempt = 0; attempt < 2; attempt += 1) {
        const latest = args.store.sessions.getSession(args.sessionId)
        const latestMetadata = latest ? MetadataSchema.safeParse(latest.metadata) : null
        if (!latest || !latestMetadata?.success) {
            return false
        }
        if (shouldSkipPromotion(latestMetadata.data.lastModelError, rawSnippet)) {
            return false
        }

        const nextMetadata: Metadata = {
            ...latestMetadata.data,
            lastModelError: nextLastModelError
        }

        const result = args.store.sessions.updateSessionMetadata(
            args.sessionId,
            nextMetadata,
            latest.metadataVersion,
            args.session.namespace,
            { touchUpdatedAt: false }
        )

        if (result.result === 'success') {
            return true
        }
        if (result.result === 'version-mismatch') {
            continue
        }
        return false
    }

    return false
}
