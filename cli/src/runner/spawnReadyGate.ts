/**
 * Runner spawn must not report success until the agent signals readiness.
 * Cursor ACP reports the hub webhook at session bootstrap, but ACP initialize
 * + session/new happen later — see heavygee/hapi#151.
 */

const SPAWN_READY_AGENTS = new Set(['cursor']);

export function agentRequiresSpawnReady(agent: string): boolean {
    return SPAWN_READY_AGENTS.has(agent);
}

export const DEFAULT_AGENT_READY_TIMEOUT_MS = 180_000;

export function resolveAgentReadyTimeoutMs(): number {
    const env = Number(process.env.HAPI_RUNNER_READY_TIMEOUT_MS);
    return Number.isFinite(env) && env > 0 ? env : DEFAULT_AGENT_READY_TIMEOUT_MS;
}
