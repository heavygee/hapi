/**
 * Overseer converse loop — the modality-agnostic conversation core.
 *
 * Takes the operator<->Overseer message history, runs the brain LLM with the 7
 * read-only tools, executes any tool calls in-process (read-only), feeds results
 * back, and returns the final human-facing reply plus an audit trail of the
 * tools it used. Text/voice/XR transports all call this same function.
 */

import {
    buildOverseerOpenAiTools,
    buildOverseerSystemPrompt,
    type OverseerConverseMessage,
    type OverseerToolTraceEntry
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

export async function runOverseerConverse(params: {
    overseer: OverseerEntity
    config: BrainConfig
    messages: OverseerConverseMessage[]
    maxIterations?: number
    signal?: AbortSignal
}): Promise<{ reply: string; toolTrace: OverseerToolTraceEntry[] }> {
    const { overseer, config, messages, maxIterations = 6, signal } = params

    const tools = buildOverseerOpenAiTools() as OverseerOpenAiToolLike[]
    const convo: OpenAiChatMessage[] = [
        { role: 'system', content: `${buildOverseerSystemPrompt()}\n\n${GROUNDING_DIRECTIVE}` },
        ...messages.map((m): OpenAiChatMessage => ({
            role: m.role === 'operator' ? 'user' : 'assistant',
            content: m.content
        }))
    ]

    const toolTrace: OverseerToolTraceEntry[] = []
    // The brain (llama-server) does not honor tool_choice:'required', so it will
    // sometimes answer a fleet question from nothing (e.g. "the inbox is empty"
    // when it never called query_inbox). Guardrail: if the very first answer
    // carries zero tool calls AND no tool has run this turn, nudge once to force
    // it to verify. If it still declines, the question genuinely needed no tool.
    let nudged = false

    for (let iter = 0; iter < maxIterations; iter++) {
        const message = await callBrain({ config, messages: convo, tools, signal })
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
            return { reply: (message.content ?? '').trim(), toolTrace }
        }

        // Execute the requested tools and feed the results back as a plain USER
        // message rather than role:'tool'+tool_call_id follow-ups. llama.cpp chat
        // templates 400 ("template"/"tool_call_id") on multi-round tool-role
        // exchanges with real data; the flattened form keeps every turn on the
        // user/assistant path that all templates render. We also drop the raw
        // assistant tool-call message from history for the same reason.
        const resultLines: string[] = []
        for (const call of calls) {
            const name = call.function?.name ?? ''
            const argsRaw = call.function?.arguments ?? ''
            const args = parseToolArgs(argsRaw)
            if (!isOverseerToolName(name)) {
                toolTrace.push({ tool: name as never, args, ok: false, error: 'unknown tool' })
                resultLines.push(`${name || 'unknown'}(${argsRaw}) => ${JSON.stringify({ error: `unknown tool: ${name}` })}`)
                continue
            }
            try {
                const result = runOverseerTool(overseer, name, args)
                toolTrace.push({ tool: name, args, ok: true })
                const lean = projectToolResultForBrain(name, result)
                resultLines.push(`${name}(${argsRaw}) => ${clampToolResult(JSON.stringify(lean ?? null))}`)
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
    const finalMsg = await callBrain({
        config,
        messages: [...convo, { role: 'user', content: 'Answer now in plain text, no more tools.' }],
        signal
    })
    return { reply: (finalMsg.content ?? '').trim() || 'I gathered the data but could not compose an answer.', toolTrace }
}
