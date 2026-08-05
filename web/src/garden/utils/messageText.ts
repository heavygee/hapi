import type { DecryptedMessage } from '@/types/api'
import { extractLastAssistantSpeakable } from '@/realtime'

function isObject(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null
}

function extractSpeakableFromContent(content: unknown): string | null {
    if (typeof content === 'string' && content.trim()) {
        return content.trim()
    }
    if (isObject(content) && content.type === 'text' && typeof content.text === 'string' && content.text.trim()) {
        return content.text.trim()
    }
    if (isObject(content) && typeof content.type === 'string' && isObject(content.data)) {
        const data = content.data
        if (data.type === 'message' && typeof data.message === 'string' && data.message.trim()) {
            return data.message.trim()
        }
    }
    if (Array.isArray(content)) {
        const parts = content
            .filter((item) => isObject(item) && item.type === 'text' && typeof item.text === 'string')
            .map((item) => (item as { text: string }).text.trim())
            .filter(Boolean)
        if (parts.length > 0) {
            return parts.join('\n\n')
        }
    }
    return null
}

function unwrapMessageContent(message: DecryptedMessage): { role: string | null; content: unknown } {
    let content: unknown = message.content
    let role: string | null = null

    if (isObject(content) && typeof content.role === 'string') {
        role = content.role
        content = content.content
    }

    if (isObject(content) && content.type === 'output' && isObject(content.data) && isObject(content.data.message)) {
        const data = content.data
        if (data.type === 'assistant' || data.type === 'user') {
            role = data.type
        }
        const msg = data.message as { content?: unknown }
        content = msg.content ?? data.message
    }

    return { role, content }
}

export function extractLastMessageText(messages: DecryptedMessage[]): string | null {
    const sorted = [...messages].sort((a, b) => (a.seq ?? 0) - (b.seq ?? 0))
    for (let i = sorted.length - 1; i >= 0; i -= 1) {
        const { role, content } = unwrapMessageContent(sorted[i])
        const speakable = extractSpeakableFromContent(content)
        if (!speakable) {
            continue
        }
        return role === 'user' ? `You: ${speakable}` : `Agent: ${speakable}`
    }
    return null
}

/**
 * Like the shared `extractLastAssistantSpeakable` but also returns the message id,
 * which Garden needs for seen-state tracking. Walks newest-first to match
 * the shared util; if shared returns no speakable text we return null.
 */
export function extractLastAssistantMessage(messages: DecryptedMessage[]): {
    id: string
    preview: string
} | null {
    const speakable = extractLastAssistantSpeakable(messages)
    if (!speakable) {
        return null
    }
    const sorted = [...messages].sort((a, b) => (a.seq ?? 0) - (b.seq ?? 0))
    for (let i = sorted.length - 1; i >= 0; i -= 1) {
        const message = sorted[i]
        const { role, content } = unwrapMessageContent(message)
        const preview = extractSpeakableFromContent(content)
        if (!preview || role === 'user') {
            continue
        }
        return { id: message.id, preview: speakable }
    }
    return null
}
