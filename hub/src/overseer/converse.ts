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
    'doubt, call a tool.'
].join('\n')

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
        convo.push(message)

        const calls = message.tool_calls ?? []
        if (calls.length === 0) {
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

        for (const call of calls) {
            const name = call.function?.name ?? ''
            const args = parseToolArgs(call.function?.arguments ?? '')
            let resultContent: string
            if (!isOverseerToolName(name)) {
                toolTrace.push({ tool: name as never, args, ok: false, error: 'unknown tool' })
                resultContent = JSON.stringify({ error: `unknown tool: ${name}` })
            } else {
                try {
                    const result = runOverseerTool(overseer, name, args)
                    toolTrace.push({ tool: name, args, ok: true })
                    resultContent = JSON.stringify(result ?? null)
                } catch (error) {
                    const msg = error instanceof Error ? error.message : String(error)
                    toolTrace.push({ tool: name, args, ok: false, error: msg })
                    resultContent = JSON.stringify({ error: msg })
                }
            }
            convo.push({
                role: 'tool',
                content: resultContent,
                tool_call_id: call.id ?? name,
                name: name || undefined
            })
        }
    }

    // Iteration cap hit while still calling tools — ask once more for a plain answer.
    const finalMsg = await callBrain({
        config,
        messages: [...convo, { role: 'user', content: 'Answer now in plain text, no more tools.' }],
        signal
    })
    return { reply: (finalMsg.content ?? '').trim() || 'I gathered the data but could not compose an answer.', toolTrace }
}
