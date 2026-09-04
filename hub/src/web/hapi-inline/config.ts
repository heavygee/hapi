import { readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { parseSpawnYolo, type HapiInlineHostConfig } from './routes'

const PINNED_TAG = 'v0.12.8'
const DEFAULT_PROJECT = '/home/heavygee/coding/hapi'

function env(name: string): string {
    return (process.env[name] ?? '').trim()
}

function pick(newName: string, oldName: string, fallback = ''): string {
    return env(newName) || env(oldName) || fallback
}

function truthy(raw: string): boolean {
    return /^(1|true|yes|on)$/i.test(raw)
}

function readSettings(): { cliApiToken?: string, machineId?: string } {
    const path = env('HAPI_SETTINGS') || join(homedir(), '.hapi', 'settings.json')
    try {
        return JSON.parse(readFileSync(path, 'utf8')) as { cliApiToken?: string, machineId?: string }
    } catch {
        return {}
    }
}

export function loadHapiInlineConfig(): HapiInlineHostConfig {
    const settings = readSettings()
    const listenPort = env('HAPI_LISTEN_PORT') || '3006'
    return {
        enabled: truthy(pick('HAPI_INLINE_ENABLED', 'OPERATOR_MIC_ENABLED')),
        secret: pick('HAPI_INLINE_SECRET', 'OPERATOR_MIC_SECRET'),
        hubToken: pick('HAPI_INLINE_HUB_TOKEN', 'OPERATOR_MIC_HUB_TOKEN', settings.cliApiToken ?? ''),
        hubBase: pick('HAPI_INLINE_HUB_BASE', 'OPERATOR_MIC_HUB_BASE', `http://127.0.0.1:${listenPort}`),
        hubNamespace: pick('HAPI_INLINE_HUB_NAMESPACE', 'OPERATOR_MIC_HUB_NAMESPACE', 'default'),
        projectPath: pick('HAPI_INLINE_PROJECT_PATH', 'OPERATOR_MIC_PROJECT_PATH', DEFAULT_PROJECT),
        machineId: pick('HAPI_INLINE_MACHINE_ID', 'OPERATOR_MIC_MACHINE_ID', settings.machineId ?? ''),
        session: pick('HAPI_INLINE_SESSION', 'OPERATOR_MIC_SESSION'),
        appId: pick('HAPI_INLINE_APP_ID', 'OPERATOR_MIC_APP_ID', 'hapi-web'),
        spawnAgent: pick('HAPI_INLINE_SPAWN_AGENT', 'OPERATOR_MIC_SPAWN_AGENT', 'cursor'),
        spawnYolo: parseSpawnYolo(pick('HAPI_INLINE_SPAWN_YOLO', 'OPERATOR_MIC_SPAWN_YOLO', '1'), true),
        build: PINNED_TAG
    }
}
