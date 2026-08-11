/**
 * Overseer converse loop — the modality-agnostic conversation core.
 *
 * Takes the operator<->Overseer message history, runs the brain LLM with the 7
 * read-only tools, executes any tool calls in-process (read-only), feeds results
 * back, and returns the final human-facing reply plus an audit trail of the
 * tools it used. Text/voice/XR transports all call this same function.
 */

import {
    applyFocusFromToolResolve,
    buildOverseerOpenAiTools,
    buildOverseerSystemPrompt,
    fingerprintWriteToolCall,
    formatConverseFocusDirective,
    isOverseerWriteTool,
    isWriteToolCallAuthorized,
    resolveOverseerWriteAuthorization,
    type OverseerConverseFocus,
    type OverseerConverseMessage,
    type OverseerToolName,
    type OverseerToolTraceEntry,
    type OverseerWriteAuthorization
} from '@hapi/protocol'
import type { OverseerEntity } from '../sync/overseerEntity'
import { isOverseerToolName, runOverseerTool } from './runOverseerTool'
import { projectToolResultForBrain } from './toolProjection'
import {
    callBrain,
    type BrainConfig,
    type OpenAiChatMessage,
    type OverseerOpenAiToolLike
} from './brainClient'

// Appended to the shared system prompt for the converse transport. The brain
// tends to "narrate from memory" without calling tools; this makes grounding a
// hard rule rather than a suggestion.
const GROUNDING_DIRECTIVE = [
    '# Grounding (mandatory)',
    '',
    'You have NO prior knowledge of the current fleet. Every fact about the inbox,',
    'workers, events, counts, health, or status must come from a tool call you make',
    'in THIS turn. Never state such a fact — including "nothing needs attention" or',
    '"the inbox is empty" — without having called the relevant tool first. When in',
    'doubt, call a tool.',
    '',
    'Query narrowly. Ask for a SMALL limit (10-25) and use filters (status, project,',
    'eventType, severity, time window); never dump the whole inbox or event stream.',
    'For depth on one item, call explain_priority instead of widening the query.'
].join('\n')

// A single tool result fed back to the brain is capped to this many characters
// (~4k tokens). The 64k-ctx local brain would otherwise overflow on a full
// query_inbox / query_events dump (~75k / ~60k tokens at limit=200). Truncation
// keeps the head (results are priority-/recency-ordered) and tells the model to
// narrow. Exported for the unit test.
export const MAX_TOOL_RESULT_CHARS = 16_000

export function clampToolResult(json: string): string {
    if (json.length <= MAX_TOOL_RESULT_CHARS) return json
    return `${json.slice(0, MAX_TOOL_RESULT_CHARS)}\n…[truncated: result too large for the context window. Re-query with a smaller limit or a tighter filter, or use explain_priority for a single item.]`
}

function parseToolArgs(raw: string): Record<string, unknown> {
    if (!raw || raw.trim().length === 0) return {}
    try {
        const parsed: unknown = JSON.parse(raw)
        return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : {}
    } catch {
        return {}
    }
}

/** Write tools return `{ ok: boolean, … }`; propagate that into the converse audit trail. */
export function toolResultOk(result: unknown): boolean {
    if (result && typeof result === 'object' && 'ok' in result) {
        return (result as { ok: unknown }).ok !== false
    }
    return true
}

function toolResultError(result: unknown): string | undefined {
    if (!result || typeof result !== 'object') return undefined
    const record = result as { error?: unknown; tombstone?: unknown }
    if (typeof record.error === 'string' && record.error.trim()) return record.error
    if (typeof record.tombstone === 'string' && record.tombstone.trim()) return record.tombstone
    return 'tool returned ok:false'
}

function writeResultTombstone(result: unknown): string | null {
    if (!result || typeof result !== 'object') return null
    const tombstone = (result as { tombstone?: unknown }).tombstone
    return typeof tombstone === 'string' && tombstone.trim() ? tombstone.trim() : null
}

function fallbackReplyAfterWriteSuccess(confirmations: string[]): string {
    if (confirmations.length === 0) {
        return 'A follow-up brain call failed after tools ran. Check the tool trace before retrying.'
    }
    return [
        'Write tool(s) already succeeded; the brain failed while composing the confirmation.',
        'Do not retry the same write unless you intend a duplicate.',
        ...confirmations.map((line) => `- ${line}`)
    ].join('\n')
}

function hasSuccessfulWrite(toolTrace: OverseerToolTraceEntry[]): boolean {
    return toolTrace.some((entry) => entry.ok && isOverseerWriteTool(entry.tool as OverseerToolName))
}

export async function runOverseerConverse(params: {
    overseer: OverseerEntity
    config: BrainConfig
    messages: OverseerConverseMessage[]
    maxIterations?: number
    signal?: AbortSignal
    /** Explicit client opt-in for write tools (admin/voice confirm). */
    allowWrites?: boolean
    /** Hub-owned subject from prior turns (session and/or inbox item). */
    focus?: OverseerConverseFocus | null
}): Promise<{
    reply: string
    toolTrace: OverseerToolTraceEntry[]
    focus: OverseerConverseFocus | null
}> {
    const { overseer, config, messages, maxIterations = 6, signal, allowWrites } = params

    const latestOperatorText = [...messages].reverse().find((m) => m.role === 'operator')?.content ?? ''
    /** Focus that may advance from tool resolves — persisted for the next operator turn. */
    let focus = params.focus ?? null
    /**
     * Write grants are frozen at turn start. Mid-turn tool resolves must not unlock
     * ping/disposition against a model-chosen subject in the same turn (Codex P1).
     * Cross-turn "tell it…" uses the focus persisted from the prior turn.
     */
    const writeFocus = params.focus ?? null
    /** Monotonic turn token — tool resolves stamp this, not wall-clock at completion. */
    const turnStartedAt = Date.now()

    const writeAuthFor = (): OverseerWriteAuthorization =>
        resolveOverseerWriteAuthorization({
            latestOperatorText,
            allowWrites,
            focus: writeFocus
        })

    // Full catalog always exposed; write authorization is enforced at call time
    // against turn-start focus (or allowWrites).
    const tools = buildOverseerOpenAiTools() as OverseerOpenAiToolLike[]
    const clockLine = `Server time now: ${new Date().toISOString()} (epoch ms ${Date.now()}, timezone ${Intl.DateTimeFormat().resolvedOptions().timeZone}). Relative snoozes must use absolute snoozedUntil epoch ms from this clock.`
    const focusDirective = formatConverseFocusDirective(focus)
    const systemContent = [
        buildOverseerSystemPrompt(),
        GROUNDING_DIRECTIVE,
        focusDirective,
        `# Clock\n\n${clockLine}`
    ]
        .filter((block): block is string => Boolean(block && block.trim()))
        .join('\n\n')
    const convo: OpenAiChatMessage[] = [
        { role: 'system', content: systemContent },
        ...messages.map((m): OpenAiChatMessage => ({
            role: m.role === 'operator' ? 'user' : 'assistant',
            content: m.content
        }))
    ]

    const toolTrace: OverseerToolTraceEntry[] = []
    /** Tombstones from successful write tools — used if a later brain call fails. */
    const writeConfirmations: string[] = []
    /** Successful irreversible call fingerprints — reject duplicates in this turn. */
    const consumedWriteFingerprints = new Set<string>()
    // The brain (llama-server) does not honor tool_choice:'required', so it will
    // sometimes answer a fleet question from nothing (e.g. "the inbox is empty"
    // when it never called query_inbox). Guardrail: if the very first answer
    // carries zero tool calls AND no tool has run this turn, nudge once to force
    // it to verify. If it still declines, the question genuinely needed no tool.
    let nudged = false

    const finish = (reply: string) => ({ reply, toolTrace, focus })

    for (let iter = 0; iter < maxIterations; iter++) {
        let message: OpenAiChatMessage
        try {
            message = await callBrain({ config, messages: convo, tools, signal })
        } catch (error) {
            // Irreversible writes already landed — return their audit trail so the
            // route can record the turn and the operator does not duplicate-retry.
            if (hasSuccessfulWrite(toolTrace)) {
                return finish(fallbackReplyAfterWriteSuccess(writeConfirmations))
            }
            throw error
        }
        const calls = message.tool_calls ?? []

        if (calls.length === 0) {
            convo.push(message)
            if (toolTrace.length === 0 && !nudged) {
                nudged = true
                convo.push({
                    role: 'user',
                    content: 'You answered without checking. Before stating any fact about the fleet (inbox, workers, events, counts, status), call the read-only tool needed to verify it, then answer. If the question truly needs no fleet data, answer directly.'
                })
                continue
            }
            return finish((message.content ?? '').trim())
        }

        // Execute the requested tools and feed the results back as a plain USER
        // message rather than role:'tool'+tool_call_id follow-ups. llama.cpp chat
        // templates 400 ("template"/"tool_call_id") on multi-round tool-role
        // exchanges with real data; the flattened form keeps every turn on the
        // user/assistant path that all templates render. We also drop the raw
        // assistant tool-call message from history for the same reason.
        const resultLines: string[] = []
        const batchHasRead = calls.some((call) => {
            const name = call.function?.name ?? ''
            return isOverseerToolName(name) && !isOverseerWriteTool(name)
        })
        for (const call of calls) {
            const name = call.function?.name ?? ''
            const argsRaw = call.function?.arguments ?? ''
            const args = parseToolArgs(argsRaw)
            if (!isOverseerToolName(name)) {
                toolTrace.push({ tool: name as never, args, ok: false, error: 'unknown tool' })
                resultLines.push(`${name || 'unknown'}(${argsRaw}) => ${JSON.stringify({ error: `unknown tool: ${name}` })}`)
                continue
            }
            if (batchHasRead && isOverseerWriteTool(name)) {
                const deferred = 'write deferred: resolve identifying read tools first, then call the write in a later turn'
                toolTrace.push({ tool: name, args, ok: false, error: deferred })
                resultLines.push(`${name}(${argsRaw}) => ${JSON.stringify({ error: deferred })}`)
                continue
            }
            const authz = isWriteToolCallAuthorized(name, args, writeAuthFor())
            if (!authz.ok) {
                toolTrace.push({ tool: name, args, ok: false, error: authz.error })
                resultLines.push(`${name}(${argsRaw}) => ${JSON.stringify({ error: authz.error })}`)
                continue
            }
            if (isOverseerWriteTool(name)) {
                const fp = fingerprintWriteToolCall(name, args)
                if (consumedWriteFingerprints.has(fp)) {
                    const dup = 'duplicate irreversible tool call rejected (already executed this turn)'
                    toolTrace.push({ tool: name, args, ok: false, error: dup })
                    resultLines.push(`${name}(${argsRaw}) => ${JSON.stringify({ error: dup })}`)
                    continue
                }
            }
            try {
                // The conversational surface is the operator-directed write-path, so dispositions
                // are allowed here (gated off on the raw HTTP tool-dispatch endpoint).
                const result = await runOverseerTool(overseer, name, args, true)
                const ok = toolResultOk(result)
                toolTrace.push({
                    tool: name,
                    args,
                    ok,
                    ...(ok ? {} : { error: toolResultError(result) })
                })
                if (ok) {
                    focus = applyFocusFromToolResolve(
                        focus,
                        {
                            tool: name,
                            ok: true,
                            args,
                            result
                        },
                        turnStartedAt
                    )
                }
                if (ok && isOverseerWriteTool(name)) {
                    consumedWriteFingerprints.add(fingerprintWriteToolCall(name, args))
                    const tombstone = writeResultTombstone(result)
                    writeConfirmations.push(tombstone ?? `${name} succeeded`)
                }
                // The brain opts into 'full' per call when it needs depth; default lean.
                const detail = args.detail === 'full' ? 'full' : 'lean'
                const projected = projectToolResultForBrain(name, result, detail)
                resultLines.push(`${name}(${argsRaw}) => ${clampToolResult(JSON.stringify(projected ?? null))}`)
            } catch (error) {
                const msg = error instanceof Error ? error.message : String(error)
                toolTrace.push({ tool: name, args, ok: false, error: msg })
                resultLines.push(`${name}(${argsRaw}) => ${JSON.stringify({ error: msg })}`)
            }
        }
        convo.push({
            role: 'user',
            content: `Results of the tool call(s) you requested:\n${resultLines.join('\n')}\n\nAnswer my question using only these results. Call another tool only if you still lack data.`
        })
    }

    // Iteration cap hit while still calling tools — ask once more for a plain answer.
    try {
        const finalMsg = await callBrain({
            config,
            messages: [...convo, { role: 'user', content: 'Answer now in plain text, no more tools.' }],
            signal
        })
        return finish(
            (finalMsg.content ?? '').trim() || 'I gathered the data but could not compose an answer.'
        )
    } catch (error) {
        if (hasSuccessfulWrite(toolTrace)) {
            return finish(fallbackReplyAfterWriteSuccess(writeConfirmations))
        }
        throw error
    }
}
