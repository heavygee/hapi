export interface CloudSpeechRecognitionResult {
    readonly isFinal: boolean
    readonly 0: { readonly transcript: string }
}

export interface CloudSpeechRecognitionEvent extends Event {
    readonly results: { readonly length: number; readonly [index: number]: CloudSpeechRecognitionResult }
}

export interface CloudSpeechRecognition extends EventTarget {
    continuous: boolean
    interimResults: boolean
    lang: string
    onresult: ((event: CloudSpeechRecognitionEvent) => void) | null
    onerror: ((event: Event & { error?: string }) => void) | null
    onend: (() => void) | null
    start: () => void
    stop: () => void
    abort: () => void
}

export interface CloudSpeechRecognitionConstructor {
    new(): CloudSpeechRecognition
}

/**
 * The classic (non-on-device) Web Speech API: `window.SpeechRecognition` or
 * its vendor-prefixed `webkitSpeechRecognition` form. Unlike the on-device
 * extension in browserLocalSpeech.ts, this never calls `available()` or sets
 * `processLocally` — it always sends audio to the browser vendor's own cloud
 * recognizer (Google for Chromium, Apple for Safari). That sidesteps the
 * #1348 WebView renderer-crash risk by construction, since that crash was
 * specific to the on-device `available({processLocally: true})` bridge, not
 * to this decade-old constructor/start/onresult surface. So no UA Client
 * Hints gate is needed here — plain feature detection is sufficient, and
 * this is expected to work on real mobile browsers (Chrome for Android,
 * Safari on iOS) where the on-device provider cannot.
 *
 * Firefox does not implement either form and is correctly reported as
 * unsupported. Safari's implementation has known quirks (auto-stop on
 * silence, limited `continuous` support) but is a genuine, functioning
 * cloud recognizer, not a partial/crash-prone shape.
 */
function currentCloudSpeechRecognitionConstructor(): unknown {
    const global = globalThis as typeof globalThis & {
        SpeechRecognition?: unknown
        webkitSpeechRecognition?: unknown
    }
    return global.SpeechRecognition ?? global.webkitSpeechRecognition
}

export function getBrowserCloudSpeechSupport(
    environment: { speechRecognition?: unknown } = {}
): CloudSpeechRecognitionConstructor | null {
    const candidate = environment.speechRecognition ?? currentCloudSpeechRecognitionConstructor()
    return typeof candidate === 'function' ? candidate as CloudSpeechRecognitionConstructor : null
}

export function hasBrowserCloudSpeechSupport(): boolean {
    return getBrowserCloudSpeechSupport() !== null
}
