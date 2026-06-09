/**
 * Normalize Claude SDK telemetry into the structured `ClaudeUsage` shape that
 * lives on `session.metadata.claudeUsage`. Consumed by the web budget indicator
 * via the `toClaudeBudgetState` adapter.
 *
 * Data sources (all observed in `@anthropic-ai/claude-code` SDK message stream):
 *  - `rate_limit_event` SDK message: subscription rate-limit telemetry
 *    (status, resetsAt, utilization, rateLimitType).
 *  - `assistant` message `.message.usage`: per-turn token usage
 *    (input/output/cache_read/cache_creation).
 *  - `result` message `.modelUsage[model]`: cumulative per-model usage
 *    including `contextWindow` and `maxOutputTokens` reported by the SDK
 *    so we don't need a hard-coded model-to-context table.
 *  - `result` message `.total_cost_usd`: cumulative cost.
 *  - `system` init message `.model`: resolved model id for that session.
 *
 * Local (file-backed) Claude sessions also flow through the converter that
 * flattens rate-limit events into pipe-delimited assistant text; for those we
 * could parse the text back out, but v1 ships the SDK-side path only (the
 * remote launcher) which covers all hub-attached sessions.
 */

import type { ClaudeUsage, ClaudeRateLimit } from '@hapi/protocol/schemas'
import type {
    SDKMessage,
    SDKAssistantMessage,
    SDKResultMessage,
    SDKSystemMessage
} from '@/claude/sdk'

export type ClaudeUsageInput = {
    rateLimitEvent?: {
        status: 'allowed' | 'allowed_warning' | 'rejected'
        rateLimitType: string
        resetsAt?: number
        utilization?: number
    }
    assistantUsage?: {
        inputTokens?: number
        outputTokens?: number
        cacheReadInputTokens?: number
        cacheCreationInputTokens?: number
        model?: string
    }
    modelUsage?: Record<string, {
        inputTokens?: number
        outputTokens?: number
        cacheReadInputTokens?: number
        cacheCreationInputTokens?: number
        webSearchRequests?: number
        costUSD?: number
        contextWindow?: number
        maxOutputTokens?: number
    }>
    totalCostUSD?: number
    resolvedModel?: string
    occurredAt: number
}

const RATE_LIMIT_STATUSES = new Set(['allowed', 'allowed_warning', 'rejected'])

/**
 * Turn an SDK message into a `ClaudeUsageInput` if it carries usage telemetry.
 * Returns null for messages that don't move the needle (text deltas, tool
 * calls without usage, etc).
 */
export function extractClaudeUsageInput(message: SDKMessage): ClaudeUsageInput | null {
    const now = Date.now()

    if (message.type === 'rate_limit_event') {
        const info = (message as any).rate_limit_info
        if (typeof info !== 'object' || info === null) return null
        const status = info.status
        const rateLimitType = info.rateLimitType
        if (typeof rateLimitType !== 'string' || rateLimitType.length === 0) return null
        if (typeof status !== 'string' || !RATE_LIMIT_STATUSES.has(status)) return null
        return {
            rateLimitEvent: {
                status: status as 'allowed' | 'allowed_warning' | 'rejected',
                rateLimitType,
                resetsAt: typeof info.resetsAt === 'number' ? info.resetsAt : undefined,
                utilization: typeof info.utilization === 'number' ? info.utilization : undefined
            },
            occurredAt: now
        }
    }

    if (message.type === 'system') {
        const sys = message as SDKSystemMessage
        if (sys.subtype === 'init' && typeof sys.model === 'string' && sys.model.length > 0) {
            return { resolvedModel: sys.model, occurredAt: now }
        }
        return null
    }

    if (message.type === 'assistant') {
        const assist = message as SDKAssistantMessage
        const raw = (assist.message as any)?.usage
        if (typeof raw !== 'object' || raw === null) return null
        const model = typeof (assist.message as any)?.model === 'string'
            ? (assist.message as any).model
            : undefined
        return {
            assistantUsage: {
                inputTokens: typeof raw.input_tokens === 'number' ? raw.input_tokens : undefined,
                outputTokens: typeof raw.output_tokens === 'number' ? raw.output_tokens : undefined,
                cacheReadInputTokens: typeof raw.cache_read_input_tokens === 'number'
                    ? raw.cache_read_input_tokens
                    : undefined,
                cacheCreationInputTokens: typeof raw.cache_creation_input_tokens === 'number'
                    ? raw.cache_creation_input_tokens
                    : undefined,
                model
            },
            occurredAt: now
        }
    }

    if (message.type === 'result') {
        const result = message as SDKResultMessage
        const input: ClaudeUsageInput = { occurredAt: now }
        if (result.modelUsage && typeof result.modelUsage === 'object') {
            input.modelUsage = result.modelUsage
        }
        if (typeof result.total_cost_usd === 'number') {
            input.totalCostUSD = result.total_cost_usd
        }
        return input.modelUsage || typeof input.totalCostUSD === 'number' ? input : null
    }

    return null
}

/**
 * Compute the effective context-window limit for a model id from the
 * cumulative `modelUsage` map (the SDK reports it on `result` messages).
 */
function resolveContextWindowLimit(
    modelUsage: ClaudeUsage['modelUsage'],
    model: string | undefined
): number | undefined {
    if (!modelUsage) return undefined
    if (model) {
        const direct = modelUsage[model]?.contextWindow
        if (typeof direct === 'number' && direct > 0) return direct
    }
    // Fallback: first model with a reported contextWindow. The SDK only
    // populates this on `result` messages, so on the very first assistant
    // message we may not have a per-model entry yet for the active model;
    // grabbing any reported window is better than dropping the gauge entirely.
    for (const entry of Object.values(modelUsage)) {
        if (typeof entry.contextWindow === 'number' && entry.contextWindow > 0) {
            return entry.contextWindow
        }
    }
    return undefined
}

/**
 * Merge a `ClaudeUsageInput` into the existing `ClaudeUsage` snapshot.
 * Pure function - returns a new object, never mutates the previous one.
 */
export function normalizeClaudeUsage(
    prev: ClaudeUsage | undefined,
    input: ClaudeUsageInput
): ClaudeUsage {
    const next: ClaudeUsage = {
        contextWindow: prev?.contextWindow,
        rateLimits: { ...(prev?.rateLimits ?? {}) },
        modelUsage: { ...(prev?.modelUsage ?? {}) },
        totalCostUSD: prev?.totalCostUSD,
        resolvedModel: prev?.resolvedModel
    }

    if (input.resolvedModel) {
        next.resolvedModel = input.resolvedModel
    }

    if (input.rateLimitEvent) {
        const e = input.rateLimitEvent
        const utilization = typeof e.utilization === 'number'
            ? e.utilization
            : e.status === 'rejected' ? 1 : 0
        const merged: ClaudeRateLimit = {
            status: e.status,
            rateLimitType: e.rateLimitType,
            utilization,
            updatedAt: input.occurredAt
        }
        if (typeof e.resetsAt === 'number') {
            merged.resetsAt = e.resetsAt
        }
        next.rateLimits = { ...next.rateLimits, [e.rateLimitType]: merged }
    }

    if (input.modelUsage) {
        const merged: ClaudeUsage['modelUsage'] = { ...next.modelUsage }
        for (const [model, usage] of Object.entries(input.modelUsage)) {
            merged[model] = { ...(merged[model] ?? {}), ...usage }
        }
        next.modelUsage = merged
    }

    if (typeof input.totalCostUSD === 'number') {
        next.totalCostUSD = input.totalCostUSD
    }

    if (input.assistantUsage) {
        const u = input.assistantUsage
        const model = u.model ?? next.resolvedModel
        const limit = resolveContextWindowLimit(next.modelUsage, model)
        // Context "used" is input + cached reads + cache creation. Output tokens
        // grow the assistant turn but don't count against the input window;
        // they're tracked separately as cost / output volume.
        const usedTokens = (u.inputTokens ?? 0)
            + (u.cacheReadInputTokens ?? 0)
            + (u.cacheCreationInputTokens ?? 0)
        if (limit && limit > 0) {
            next.contextWindow = {
                usedTokens,
                limitTokens: limit,
                percent: Math.max(0, Math.min(100, (usedTokens / limit) * 100)),
                updatedAt: input.occurredAt
            }
        } else if (next.contextWindow) {
            // Keep the previous context window; we'll overwrite once we see the
            // first `result` message that carries the per-model limit.
        }
    }

    return next
}

/**
 * Convenience: ingest a raw SDK message and produce the next usage snapshot,
 * or return `prev` unchanged if the message carries no usage telemetry.
 */
export function ingestClaudeSDKMessage(
    prev: ClaudeUsage | undefined,
    message: SDKMessage
): ClaudeUsage | undefined {
    const input = extractClaudeUsageInput(message)
    if (!input) return prev
    return normalizeClaudeUsage(prev, input)
}
