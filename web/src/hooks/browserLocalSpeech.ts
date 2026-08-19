export interface LocalSpeechRecognitionResult {
    readonly isFinal: boolean
    readonly 0: { readonly transcript: string }
}

export interface LocalSpeechRecognitionEvent extends Event {
    readonly results: { readonly length: number; readonly [index: number]: LocalSpeechRecognitionResult }
}

export interface LocalSpeechRecognition extends EventTarget {
    continuous: boolean
    interimResults: boolean
    lang: string
    processLocally: boolean
    onresult: ((event: LocalSpeechRecognitionEvent) => void) | null
    onerror: ((event: Event & { error?: string }) => void) | null
    onend: (() => void) | null
    start: () => void
    stop: () => void
    abort: () => void
}

export interface LocalSpeechRecognitionConstructor {
    new(): LocalSpeechRecognition
    prototype: LocalSpeechRecognition
}

export type LocalSpeechRecognitionAvailability = (
    options: { langs: string[]; processLocally: true }
) => Promise<string> | string

export interface BrowserLocalSpeechEnvironment {
    userAgent?: string
    userAgentData?: { platform?: string; mobile?: boolean }
    speechRecognition?: unknown
}

export interface BrowserLocalSpeechSupport {
    constructor: LocalSpeechRecognitionConstructor
    available: LocalSpeechRecognitionAvailability
}

function currentUserAgent(): string {
    return typeof navigator === 'undefined' ? '' : navigator.userAgent
}

function currentSpeechRecognition(): unknown {
    return (globalThis as typeof globalThis & {
        SpeechRecognition?: unknown
    }).SpeechRecognition
}

function currentUserAgentData(): BrowserLocalSpeechEnvironment['userAgentData'] {
    return (typeof navigator === 'undefined'
        ? undefined
        : (navigator as Navigator & { userAgentData?: BrowserLocalSpeechEnvironment['userAgentData'] }).userAgentData)
}

const SAFE_DESKTOP_PLATFORMS = new Set(['Windows', 'macOS', 'Linux', 'Chrome OS'])

/**
 * The experimental on-device speech API is eligible only with explicit,
 * trustworthy User-Agent Client Hints that identify a desktop platform.
 * Mobile is excluded for two independent reasons, not one:
 *
 * 1. Some Android WebView/OEM runtimes expose a partial shape whose native
 *    `available()` call crashes the renderer rather than rejecting a promise
 *    (github.com/tiann/hapi issue #1348) — this is a genuine crash risk
 *    specific to embedded WebView engines, not to "mobile" as a category.
 * 2. Independently, as of this writing Chromium has not shipped bundled
 *    on-device speech models on Android at all: real Chrome for Android
 *    exposes this API shape but `available({processLocally: true})` always
 *    resolves "unavailable". iOS Safari and Firefox for Android don't
 *    implement the on-device extension (no UA-CH either, so they already
 *    fail this gate on shape/signal grounds).
 *
 * Because of (2), narrowing this gate to exclude only WebView engines
 * (e.g. via the "Android WebView" UA-CH brand) would not unlock any real
 * capability today, while (1) means getting that narrowing wrong would
 * reopen a renderer-crashing regression for no benefit. Revisit only once
 * Chromium ships bundled on-device models for Android — at that point
 * WebView-specific brand detection is the right next step, not a blanket
 * mobile allowance.
 */
export function isConfirmedDesktopSpeechEnvironment(
    _userAgent: string,
    userAgentData?: BrowserLocalSpeechEnvironment['userAgentData']
): boolean {
    return userAgentData?.mobile === false
        && typeof userAgentData.platform === 'string'
        && SAFE_DESKTOP_PLATFORMS.has(userAgentData.platform)
}

function staticAvailabilityMethod(candidate: Function): LocalSpeechRecognitionAvailability | null {
    for (let target: object | null = candidate; target && target !== Function.prototype; target = Object.getPrototypeOf(target)) {
        const descriptor = Object.getOwnPropertyDescriptor(target, 'available')
        if (descriptor) return typeof descriptor.value === 'function'
            ? descriptor.value as LocalSpeechRecognitionAvailability
            : null
    }
    return null
}

/**
 * Checks only the browser API shape. It intentionally does not instantiate
 * recognition or call the experimental `SpeechRecognition.available()` method.
 */
export function getBrowserLocalSpeechSupport(
    environment: BrowserLocalSpeechEnvironment = {}
): BrowserLocalSpeechSupport | null {
    const userAgent = environment.userAgent ?? currentUserAgent()
    const userAgentData = environment.userAgentData ?? currentUserAgentData()
    if (!isConfirmedDesktopSpeechEnvironment(userAgent, userAgentData)) return null

    const candidate = environment.speechRecognition ?? currentSpeechRecognition()
    if (typeof candidate !== 'function') return null
    const constructor = candidate as LocalSpeechRecognitionConstructor
    if (!constructor.prototype || !('processLocally' in constructor.prototype)) return null
    const available = staticAvailabilityMethod(candidate)
    return available ? { constructor, available } : null
}

export function hasBrowserLocalSpeechSupport(): boolean {
    return getBrowserLocalSpeechSupport() !== null
}
