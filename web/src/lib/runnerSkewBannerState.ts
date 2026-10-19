export const RUNNER_SKEW_TEMP_DISMISS_MS = 60 * 60_000

const MINIMIZED_KEY_PREFIX = 'hapi.runnerSkew.minimized.v1'
const DISMISS_UNTIL_KEY_PREFIX = 'hapi.runnerSkew.dismissUntil.v1'

/** In-memory fallback when sessionStorage is full / blocked (QuotaExceededError). */
const memoryMinimizedByScope = new Map<string, boolean>()
const memoryDismissUntilByScope = new Map<string, number>()

/** Scope dismiss/minimize state to hub + namespace (PWA can switch hubs in-tab). */
export function runnerSkewBannerScope(baseUrl: string | null | undefined, namespace: string | null | undefined): string {
    const hub = (baseUrl ?? (typeof window !== 'undefined' ? window.location.origin : 'unknown')).trim() || 'unknown'
    const ns = (namespace ?? 'unknown').trim() || 'unknown'
    return `${hub}:${ns}`
}

function minimizedKey(scope: string): string {
    return `${MINIMIZED_KEY_PREFIX}.${encodeURIComponent(scope)}`
}

function dismissUntilKey(scope: string): string {
    return `${DISMISS_UNTIL_KEY_PREFIX}.${encodeURIComponent(scope)}`
}

function readStorage(): Storage | null {
    if (typeof window === 'undefined') {
        return null
    }
    try {
        return window.sessionStorage
    } catch {
        return null
    }
}

function writeStorage(mutate: (storage: Storage) => void): void {
    const storage = readStorage()
    if (!storage) {
        return
    }
    try {
        mutate(storage)
    } catch {
        // QuotaExceededError / SecurityError — keep memory fallback only.
    }
}

export function isRunnerSkewMinimized(scope: string): boolean {
    const memory = memoryMinimizedByScope.get(scope)
    if (memory !== undefined) {
        return memory
    }
    try {
        return readStorage()?.getItem(minimizedKey(scope)) === '1'
    } catch {
        return false
    }
}

export function setRunnerSkewMinimized(scope: string, minimized: boolean): void {
    memoryMinimizedByScope.set(scope, minimized)
    writeStorage((storage) => {
        if (minimized) {
            storage.setItem(minimizedKey(scope), '1')
        } else {
            storage.removeItem(minimizedKey(scope))
        }
    })
}

export function getRunnerSkewDismissUntil(scope: string): number {
    const memory = memoryDismissUntilByScope.get(scope)
    if (memory !== undefined) {
        return memory
    }
    try {
        const raw = readStorage()?.getItem(dismissUntilKey(scope))
        if (!raw) {
            return 0
        }
        const parsed = Number(raw)
        return Number.isFinite(parsed) ? parsed : 0
    } catch {
        return 0
    }
}

export function isRunnerSkewTempDismissed(scope: string, now: number = Date.now()): boolean {
    return getRunnerSkewDismissUntil(scope) > now
}

export function tempDismissRunnerSkew(scope: string, now: number = Date.now()): void {
    const until = now + RUNNER_SKEW_TEMP_DISMISS_MS
    memoryDismissUntilByScope.set(scope, until)
    writeStorage((storage) => {
        storage.setItem(dismissUntilKey(scope), String(until))
    })
}

export function clearRunnerSkewTempDismiss(scope: string): void {
    memoryDismissUntilByScope.set(scope, 0)
    writeStorage((storage) => {
        storage.removeItem(dismissUntilKey(scope))
    })
}

/** Test helper: reset memory mirrors (sessionStorage cleared separately). */
export function resetRunnerSkewBannerMemoryForTests(): void {
    memoryMinimizedByScope.clear()
    memoryDismissUntilByScope.clear()
    memoryAcknowledgedOfferByScope.clear()
}

const ACK_OFFER_PREFIX = 'hapi.fleetUpgrade.acknowledgedOffer.v1'
const memoryAcknowledgedOfferByScope = new Map<string, string>()

function ackOfferKey(scope: string): string {
    return `${ACK_OFFER_PREFIX}.${encodeURIComponent(scope)}`
}

function readLocalStorage(): Storage | null {
    if (typeof window === 'undefined') {
        return null
    }
    try {
        return window.localStorage
    } catch {
        return null
    }
}

/** Stable id for "which tip did this browser already see". */
export function fleetOfferNoticeId(offer: {
    channel: string
    targetVersion: string
    soupTag?: string
    targetGeneration?: string
}): string {
    if (offer.soupTag && offer.soupTag.length > 0) {
        return offer.soupTag
    }
    if (offer.targetGeneration && offer.targetGeneration.length > 0) {
        return offer.targetGeneration
    }
    return `${offer.channel}:${offer.targetVersion}`
}

export function getAcknowledgedFleetOfferId(scope: string): string | null {
    const memory = memoryAcknowledgedOfferByScope.get(scope)
    if (memory !== undefined) {
        return memory
    }
    try {
        return readLocalStorage()?.getItem(ackOfferKey(scope)) ?? null
    } catch {
        return null
    }
}

/** Remember this tip so the post-apply notice does not repeat. Also used to seed the first sighting. */
export function acknowledgeFleetOfferId(scope: string, offerId: string): void {
    memoryAcknowledgedOfferByScope.set(scope, offerId)
    const storage = readLocalStorage()
    if (!storage) {
        return
    }
    try {
        storage.setItem(ackOfferKey(scope), offerId)
    } catch {
        // QuotaExceededError — memory mirror still suppresses a repeat this session.
    }
}
