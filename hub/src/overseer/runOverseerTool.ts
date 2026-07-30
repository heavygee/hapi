import {
    OVERSEER_TOOL_NAMES,
    overseerToolArgsSchemas,
    type OverseerToolName
} from '@hapi/protocol'
import type { OverseerEntity } from '../sync/overseerEntity'

/**
 * Execute one read-only Overseer tool by name against the entity. Shared by the
 * HTTP tool-dispatch route and the converse tool-calling loop so both go through
 * exactly one place. Throws `ZodError` on invalid args; every tool is read-only.
 */
export function runOverseerTool(overseer: OverseerEntity, tool: OverseerToolName, args: unknown): unknown {
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
        default: {
            const exhaustive: never = tool
            throw new Error(`Unknown overseer tool: ${String(exhaustive)}`)
        }
    }
}

export function isOverseerToolName(value: string): value is OverseerToolName {
    return (OVERSEER_TOOL_NAMES as readonly string[]).includes(value)
}
