import {
    OVERSEER_TOOL_NAMES,
    isOverseerWriteTool,
    overseerToolArgsSchemas,
    type OverseerToolName
} from '@hapi/protocol'
import type { OverseerEntity } from '../sync/overseerEntity'

/** Thrown when a write tool is dispatched on a read-only surface (R2 gate). */
export class OverseerWriteNotAllowedError extends Error {
    constructor(tool: string) {
        super(`Tool "${tool}" writes and is not allowed on this surface`)
        this.name = 'OverseerWriteNotAllowedError'
    }
}

/**
 * Execute one Overseer tool by name against the entity. Shared by the HTTP tool-dispatch route and
 * the converse tool-calling loop so both go through exactly one place. Throws `ZodError` on invalid
 * args. Write tools (`record_disposition`, `ping_session`) are gated behind `allowWrites`
 * (the conversational path sets it; the raw HTTP dispatch does not). Async because `ping_session`
 * may resume a worker before enqueueing.
 */
export async function runOverseerTool(
    overseer: OverseerEntity,
    tool: OverseerToolName,
    args: unknown,
    allowWrites = false
): Promise<unknown> {
    if (isOverseerWriteTool(tool) && !allowWrites) {
        throw new OverseerWriteNotAllowedError(tool)
    }
    switch (tool) {
        case 'query_events':
            return { events: overseer.queryEvents(overseerToolArgsSchemas.query_events.parse(args)) }
        case 'query_inbox':
            return overseer.queryInbox(overseerToolArgsSchemas.query_inbox.parse(args))
        case 'get_session_state': {
            const parsed = overseerToolArgsSchemas.get_session_state.parse(args)
            return { state: overseer.getSessionState(parsed.sessionId) }
        }
        case 'get_session_recent_output': {
            const parsed = overseerToolArgsSchemas.get_session_recent_output.parse(args)
            return { chunks: overseer.getSessionRecentOutput(parsed.sessionId, parsed.n ?? 10) }
        }
        case 'get_worker_health': {
            const parsed = overseerToolArgsSchemas.get_worker_health.parse(args)
            return { health: overseer.getWorkerHealth(parsed.sessionId) }
        }
        case 'explain_priority': {
            const parsed = overseerToolArgsSchemas.explain_priority.parse(args)
            return { explanation: overseer.explainPriority(parsed.itemId) }
        }
        case 'list_active_workers':
            return { workers: overseer.listActiveWorkers(overseerToolArgsSchemas.list_active_workers.parse(args)) }
        case 'query_open_loops':
            return overseer.queryOpenLoops(overseerToolArgsSchemas.query_open_loops.parse(args))
        case 'query_dispositions':
            return overseer.queryDispositions(overseerToolArgsSchemas.query_dispositions.parse(args))
        case 'record_disposition':
            return overseer.recordDisposition(overseerToolArgsSchemas.record_disposition.parse(args))
        case 'ping_session':
            return overseer.pingSession(overseerToolArgsSchemas.ping_session.parse(args))
        default: {
            const exhaustive: never = tool
            throw new Error(`Unknown overseer tool: ${String(exhaustive)}`)
        }
    }
}

export function isOverseerToolName(value: string): value is OverseerToolName {
    return (OVERSEER_TOOL_NAMES as readonly string[]).includes(value)
}
