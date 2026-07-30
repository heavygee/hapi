export type GardenSeenRecord = {
    updatedAt: number
    assistantMessageId: string | null
}

const STORAGE_KEY = 'hapi_garden_seen_v1'

function readAll(): Record<string, GardenSeenRecord> {
    if (typeof localStorage === 'undefined') {
        return {}
    }
    try {
        const raw = localStorage.getItem(STORAGE_KEY)
        if (!raw) {
            return {}
        }
        return JSON.parse(raw) as Record<string, GardenSeenRecord>
    } catch {
        return {}
    }
}

function writeAll(records: Record<string, GardenSeenRecord>): void {
    if (typeof localStorage === 'undefined') {
        return
    }
    localStorage.setItem(STORAGE_KEY, JSON.stringify(records))
}

export function getGardenSeen(sessionId: string): GardenSeenRecord | null {
    return readAll()[sessionId] ?? null
}

export function markGardenSeen(
    sessionId: string,
    updatedAt: number,
    assistantMessageId: string | null = null,
): void {
    const records = readAll()
    const prev = records[sessionId]
    if (
        prev
        && prev.updatedAt >= updatedAt
        && (assistantMessageId === null || prev.assistantMessageId === assistantMessageId)
    ) {
        return
    }
    records[sessionId] = { updatedAt, assistantMessageId }
    writeAll(records)
}

export function clearGardenSeenForTests(): void {
    if (typeof localStorage === 'undefined') {
        return
    }
    localStorage.removeItem(STORAGE_KEY)
}
