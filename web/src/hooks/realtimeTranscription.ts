import { DEEPGRAM_TRANSCRIPTION_MODEL } from '@hapi/protocol/voice'
import {
    getBrowserCloudSpeechSupport
} from './browserCloudSpeech'
import {
    getBrowserLocalSpeechSupport,
    type LocalSpeechRecognition,
    type LocalSpeechRecognitionAvailability,
    type LocalSpeechRecognitionConstructor,
    type LocalSpeechRecognitionEvent
} from './browserLocalSpeech'

export interface RealtimeTranscriptionCallbacks {
    onConnected: () => void
    onPartial: (text: string) => void
    onFinal: (text: string) => void
    onError: (error: Error) => void
}

export interface RealtimeTranscriptionSession {
    stop: () => Promise<void>
    cancel: () => void
}

type TokenFactory = () => Promise<string>

function joinTranscriptParts(...parts: string[]): string {
    return parts.map((part) => part.trim()).filter(Boolean).join(' ')
}

function errorMessage(value: unknown, fallback: string): Error {
    return value instanceof Error ? value : new Error(fallback)
}

export async function startOpenAIRealtimeTranscription(options: {
    getToken: TokenFactory
    signal?: AbortSignal
    callbacks: RealtimeTranscriptionCallbacks
}): Promise<RealtimeTranscriptionSession> {
    const stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true }
    })
    try {
        options.signal?.throwIfAborted()
    } catch (error) {
        stream.getTracks().forEach((track) => track.stop())
        throw error
    }
    let peer: RTCPeerConnection
    let channel: RTCDataChannel
    try {
        peer = new RTCPeerConnection()
        channel = peer.createDataChannel('oai-events')
    } catch (error) {
        stream.getTracks().forEach((track) => track.stop())
        throw error
    }
    let partial = ''
    let finished = false
    let stopping = false
    let stopTimer: ReturnType<typeof setTimeout> | null = null

    const cleanup = () => {
        if (stopTimer) clearTimeout(stopTimer)
        stopTimer = null
        stream.getTracks().forEach((track) => track.stop())
        channel.close()
        peer.close()
    }
    const finish = (text: string) => {
        if (finished) return
        finished = true
        cleanup()
        options.callbacks.onFinal(text)
    }
    const fail = (value: unknown) => {
        if (finished) return
        finished = true
        cleanup()
        options.callbacks.onError(errorMessage(value, 'OpenAI realtime transcription failed'))
    }

    try {
        const track = stream.getAudioTracks()[0]
        if (!track) throw new Error('No microphone audio track is available')
        peer.addTrack(track, stream)
        channel.addEventListener('message', (event) => {
            let data: {
                type?: string
                delta?: string
                transcript?: string
                error?: { message?: string }
            }
            try {
                data = JSON.parse(String(event.data)) as typeof data
            } catch {
                return
            }
            if (data.type === 'conversation.item.input_audio_transcription.delta' && data.delta) {
                partial += data.delta
                options.callbacks.onPartial(partial)
            } else if (data.type === 'conversation.item.input_audio_transcription.completed') {
                finish(data.transcript ?? partial)
            } else if (data.type === 'error') {
                fail(new Error(data.error?.message || 'OpenAI realtime transcription failed'))
            }
        })
        peer.addEventListener('connectionstatechange', () => {
            if (!finished && (peer.connectionState === 'failed' || peer.connectionState === 'closed')) {
                fail(new Error('OpenAI realtime transcription disconnected'))
            }
        })

        const offer = await peer.createOffer()
        await peer.setLocalDescription(offer)
        const token = await options.getToken()
        const response = await fetch('https://api.openai.com/v1/realtime/calls', {
            method: 'POST',
            headers: {
                Authorization: `Bearer ${token}`,
                'Content-Type': 'application/sdp'
            },
            body: offer.sdp,
            signal: options.signal
                ? AbortSignal.any([options.signal, AbortSignal.timeout(15_000)])
                : AbortSignal.timeout(15_000)
        })
        if (!response.ok) throw new Error(`OpenAI realtime connection failed (HTTP ${response.status})`)
        await peer.setRemoteDescription({ type: 'answer', sdp: await response.text() })
        await new Promise<void>((resolve, reject) => {
            if (channel.readyState === 'open') return resolve()
            const timeout = setTimeout(() => reject(new Error('OpenAI realtime connection timed out')), 10_000)
            const onAbort = () => {
                clearTimeout(timeout)
                reject(options.signal?.reason)
            }
            options.signal?.addEventListener('abort', onAbort, { once: true })
            channel.addEventListener('open', () => {
                clearTimeout(timeout)
                options.signal?.removeEventListener('abort', onAbort)
                resolve()
            }, { once: true })
            channel.addEventListener('error', () => {
                clearTimeout(timeout)
                options.signal?.removeEventListener('abort', onAbort)
                reject(new Error('OpenAI realtime connection failed'))
            }, { once: true })
        })
        options.callbacks.onConnected()
    } catch (error) {
        fail(error)
        throw error
    }

    return {
        stop: async () => {
            if (finished || stopping) return
            stopping = true
            stream.getTracks().forEach((track) => track.stop())
            if (channel.readyState !== 'open') return finish(partial)
            channel.send(JSON.stringify({ type: 'input_audio_buffer.commit' }))
            await new Promise<void>((resolve) => {
                stopTimer = setTimeout(() => {
                    clearInterval(check)
                    finish(partial)
                    resolve()
                }, 2_500)
                const check = setInterval(() => {
                    if (!finished) return
                    clearInterval(check)
                    resolve()
                }, 25)
            })
        },
        cancel: () => {
            if (finished) return
            finished = true
            cleanup()
        }
    }
}

export async function startDeepgramRealtimeTranscription(options: {
    getToken: TokenFactory
    language?: string
    signal?: AbortSignal
    callbacks: RealtimeTranscriptionCallbacks
}): Promise<RealtimeTranscriptionSession> {
    const stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true }
    })
    try {
        options.signal?.throwIfAborted()
    } catch (error) {
        stream.getTracks().forEach((track) => track.stop())
        throw error
    }
    let token: string
    try {
        token = await options.getToken()
    } catch (error) {
        stream.getTracks().forEach((track) => track.stop())
        throw error
    }
    const query = new URLSearchParams({
        model: DEEPGRAM_TRANSCRIPTION_MODEL,
        smart_format: 'true',
        interim_results: 'true',
        endpointing: 'false'
    })
    if (options.language) query.set('language', options.language)
    const mimeType = [
        'audio/webm;codecs=opus',
        'audio/webm',
        'audio/ogg;codecs=opus'
    ].find((type) => typeof MediaRecorder.isTypeSupported !== 'function' || MediaRecorder.isTypeSupported(type))
    let socket: WebSocket
    let recorder: MediaRecorder
    try {
        socket = new WebSocket(`wss://api.deepgram.com/v1/listen?${query}`, ['bearer', token])
        recorder = mimeType ? new MediaRecorder(stream, { mimeType }) : new MediaRecorder(stream)
    } catch (error) {
        stream.getTracks().forEach((track) => track.stop())
        throw error
    }
    let committed = ''
    let interim = ''
    let finished = false
    let stopping = false
    let stopTimer: ReturnType<typeof setTimeout> | null = null

    const cleanup = () => {
        if (stopTimer) clearTimeout(stopTimer)
        stopTimer = null
        recorder.ondataavailable = null
        recorder.onstop = null
        if (recorder.state !== 'inactive') recorder.stop()
        stream.getTracks().forEach((track) => track.stop())
        if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ type: 'CloseStream' }))
        socket.close()
    }
    const finish = (text: string) => {
        if (finished) return
        finished = true
        cleanup()
        options.callbacks.onFinal(text)
    }
    const fail = (value: unknown) => {
        if (finished) return
        finished = true
        cleanup()
        options.callbacks.onError(errorMessage(value, 'Deepgram realtime transcription failed'))
    }

    recorder.ondataavailable = (event) => {
        if (event.data.size > 0 && socket.readyState === WebSocket.OPEN) socket.send(event.data)
    }
    recorder.onerror = () => fail(new Error('Audio recording failed'))
    recorder.onstop = () => {
        if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ type: 'Finalize' }))
    }
    socket.addEventListener('message', (event) => {
        let data: {
            type?: string
            is_final?: boolean
            from_finalize?: boolean
            channel?: { alternatives?: Array<{ transcript?: string }> }
            description?: string
        }
        try {
            data = JSON.parse(String(event.data)) as typeof data
        } catch {
            return
        }
        if (data.type === 'Error') return fail(new Error(data.description || 'Deepgram realtime transcription failed'))
        if (data.type !== 'Results') return
        const text = data.channel?.alternatives?.[0]?.transcript ?? ''
        if (data.is_final) {
            committed = joinTranscriptParts(committed, text)
            interim = ''
        } else {
            interim = text
        }
        const current = joinTranscriptParts(committed, interim)
        options.callbacks.onPartial(current)
        if (stopping && data.is_final && data.from_finalize) finish(current)
    })
    socket.addEventListener('close', () => {
        if (!finished && !stopping) fail(new Error('Deepgram realtime transcription disconnected'))
    })

    await new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error('Deepgram realtime connection timed out')), 10_000)
        const onAbort = () => {
            clearTimeout(timeout)
            reject(options.signal?.reason)
        }
        options.signal?.addEventListener('abort', onAbort, { once: true })
        socket.addEventListener('open', () => {
            clearTimeout(timeout)
            options.signal?.removeEventListener('abort', onAbort)
            recorder.start(250)
            options.callbacks.onConnected()
            resolve()
        }, { once: true })
        socket.addEventListener('error', () => {
            clearTimeout(timeout)
            options.signal?.removeEventListener('abort', onAbort)
            reject(new Error('Deepgram realtime connection failed'))
        }, { once: true })
    }).catch((error) => {
        fail(error)
        throw error
    })

    return {
        stop: async () => {
            if (finished || stopping) return
            stopping = true
            if (recorder.state !== 'inactive') recorder.stop()
            else if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ type: 'Finalize' }))
            await new Promise<void>((resolve) => {
                stopTimer = setTimeout(() => {
                    clearInterval(check)
                    finish(joinTranscriptParts(committed, interim))
                    resolve()
                }, 2_500)
                const check = setInterval(() => {
                    if (!finished) return
                    clearInterval(check)
                    resolve()
                }, 25)
            })
        },
        cancel: () => {
            if (finished) return
            finished = true
            cleanup()
        }
    }
}

export const BROWSER_LOCAL_AVAILABILITY_TIMEOUT_MS = 10_000

interface BrowserLocalAvailabilityProbe {
    readonly available: LocalSpeechRecognitionAvailability
    readonly constructor: LocalSpeechRecognitionConstructor
    readonly language: string
    readonly subscribers: Set<BrowserLocalAvailabilitySubscriber>
}

interface BrowserLocalAvailabilitySubscriber {
    resolve: (status: string) => void
    reject: (error: unknown) => void
}

const browserLocalAvailabilityProbes = new WeakMap<LocalSpeechRecognitionConstructor, Map<string, BrowserLocalAvailabilityProbe>>()

function browserLocalProbeMap(constructor: LocalSpeechRecognitionConstructor): Map<string, BrowserLocalAvailabilityProbe> {
    let probes = browserLocalAvailabilityProbes.get(constructor)
    if (!probes) {
        probes = new Map()
        browserLocalAvailabilityProbes.set(constructor, probes)
    }
    return probes
}

function getBrowserLocalAvailabilityProbe(options: {
    available: LocalSpeechRecognitionAvailability
    constructor: LocalSpeechRecognitionConstructor
    language: string
}): BrowserLocalAvailabilityProbe {
    const probes = browserLocalProbeMap(options.constructor)
    const existing = probes.get(options.language)
    if (existing) return existing

    const probe: BrowserLocalAvailabilityProbe = {
        ...options,
        subscribers: new Set()
    }
    probes.set(options.language, probe)
    queueMicrotask(() => {
        if (probe.subscribers.size === 0) {
            probes.delete(options.language)
            return
        }
        Promise.resolve()
            .then(() => probe.available.call(probe.constructor, { langs: [probe.language], processLocally: true }))
            .then(
                (status) => settleBrowserLocalAvailabilityProbe(probes, probe, (subscriber) => subscriber.resolve(status)),
                (error) => settleBrowserLocalAvailabilityProbe(probes, probe, (subscriber) => subscriber.reject(error))
            )
    })
    return probe
}

function settleBrowserLocalAvailabilityProbe(
    probes: Map<string, BrowserLocalAvailabilityProbe>,
    probe: BrowserLocalAvailabilityProbe,
    notify: (subscriber: BrowserLocalAvailabilitySubscriber) => void
): void {
    if (probes.get(probe.language) !== probe) return
    probes.delete(probe.language)
    const subscribers = Array.from(probe.subscribers)
    probe.subscribers.clear()
    subscribers.forEach(notify)
}

export function getBrowserLocalAvailabilityProbeSubscriberCountForTesting(
    constructor: object,
    language: string
): number {
    return browserLocalAvailabilityProbes
        .get(constructor as LocalSpeechRecognitionConstructor)
        ?.get(language)
        ?.subscribers.size ?? 0
}

function abortError(signal: AbortSignal): unknown {
    return signal.reason ?? new Error('On-device speech recognition availability check was aborted')
}

async function checkBrowserLocalSpeechAvailability(options: {
    available: LocalSpeechRecognitionAvailability
    constructor: LocalSpeechRecognitionConstructor
    language: string
    signal?: AbortSignal
}): Promise<string> {
    options.signal?.throwIfAborted()
    const probe = getBrowserLocalAvailabilityProbe(options)

    return await new Promise<string>((resolve, reject) => {
        let settled = false
        const subscriber: BrowserLocalAvailabilitySubscriber = { resolve, reject }
        const detach = () => probe.subscribers.delete(subscriber)
        const finish = (callback: () => void) => {
            if (settled) return
            settled = true
            clearTimeout(timeout)
            options.signal?.removeEventListener('abort', onAbort)
            detach()
            callback()
        }
        const timeout = setTimeout(() => {
            finish(() => reject(new Error('On-device speech recognition availability check timed out')))
        }, BROWSER_LOCAL_AVAILABILITY_TIMEOUT_MS)
        const onAbort = () => finish(() => reject(abortError(options.signal!)))
        if (options.signal?.aborted) {
            onAbort()
            return
        }
        probe.subscribers.add(subscriber)
        options.signal?.addEventListener('abort', onAbort, { once: true })
        subscriber.resolve = (status) => finish(() => resolve(status))
        subscriber.reject = (error) => finish(() => reject(error))
    })
}

interface WebSpeechRecognitionResultLike {
    readonly isFinal: boolean
    readonly 0: { readonly transcript: string }
}

interface WebSpeechRecognitionEventLike extends Event {
    readonly results: { readonly length: number; readonly [index: number]: WebSpeechRecognitionResultLike }
}

interface WebSpeechRecognitionLike {
    onresult: ((event: WebSpeechRecognitionEventLike) => void) | null
    onerror: ((event: Event & { error?: string }) => void) | null
    onend: (() => void) | null
    start: () => void
    stop: () => void
    abort: () => void
}

/**
 * Shared event-adapter and stop/cancel lifecycle for any Web Speech API
 * variant (on-device or classic/cloud) once it has been constructed and
 * configured by its caller. `errorLabel` distinguishes error messages
 * between variants (e.g. "On-device transcription" vs "Browser cloud
 * transcription") without duplicating this ~60-line adapter per variant.
 *
 * `softEndErrorCodes` and `treatUnexpectedEndAsFinish` default to the
 * original on-device behavior (any unexpected error/end is fatal), which
 * matches desktop Chrome's continuous on-device recognizer never stopping
 * itself. The classic/cloud variant opts into softer handling because
 * mobile browsers legitimately stop recognition on their own mid-session
 * (Safari auto-stops on silence; `no-speech` is a routine timeout, not a
 * failure) — treating those as fatal would break the exact continuous
 * mobile dictation this provider exists to support.
 */
function runWebSpeechRecognitionSession(
    recognition: WebSpeechRecognitionLike,
    callbacks: RealtimeTranscriptionCallbacks,
    options: {
        errorLabel: string
        softEndErrorCodes?: ReadonlySet<string>
        treatUnexpectedEndAsFinish?: boolean
    }
): RealtimeTranscriptionSession {
    const { errorLabel, softEndErrorCodes, treatUnexpectedEndAsFinish } = options
    let current = ''
    let finished = false
    let stopping = false

    const finish = () => {
        if (finished) return
        finished = true
        callbacks.onFinal(current)
    }
    recognition.onresult = (event) => {
        // A result can arrive after `stop()`'s timeout already finalized the
        // session (e.g. a slow cloud round-trip on a mobile network) — once
        // finished, ignore late events instead of resurrecting stale partial
        // text into a UI that already moved on.
        if (finished) return
        const finalParts: string[] = []
        const interimParts: string[] = []
        for (let index = 0; index < event.results.length; index += 1) {
            const result = event.results[index]
            const transcript = result?.[0]?.transcript ?? ''
            if (result?.isFinal) finalParts.push(transcript)
            else interimParts.push(transcript)
        }
        current = joinTranscriptParts(...finalParts, ...interimParts)
        callbacks.onPartial(current)
    }
    recognition.onerror = (event) => {
        if (event.error === 'aborted' && stopping) return
        if (event.error && softEndErrorCodes?.has(event.error)) return
        finished = true
        callbacks.onError(new Error(event.error ? `${errorLabel} failed: ${event.error}` : `${errorLabel} failed`))
    }
    recognition.onend = () => {
        if (stopping || treatUnexpectedEndAsFinish) finish()
        else if (!finished) {
            finished = true
            callbacks.onError(new Error(`${errorLabel} stopped`))
        }
    }
    recognition.start()
    callbacks.onConnected()

    return {
        stop: async () => {
            if (finished || stopping) return
            stopping = true
            recognition.stop()
            await new Promise<void>((resolve) => {
                const timeout = setTimeout(() => {
                    clearInterval(check)
                    finish()
                    resolve()
                }, 2_500)
                const check = setInterval(() => {
                    if (!finished) return
                    clearInterval(check)
                    clearTimeout(timeout)
                    resolve()
                }, 25)
            })
        },
        cancel: () => {
            if (finished) return
            finished = true
            recognition.abort()
        }
    }
}

export async function startBrowserLocalTranscription(options: {
    language?: string
    signal?: AbortSignal
    callbacks: RealtimeTranscriptionCallbacks
}): Promise<RealtimeTranscriptionSession> {
    options.signal?.throwIfAborted()
    const support = getBrowserLocalSpeechSupport()
    if (!support) throw new Error('On-device speech recognition is not supported by this browser')
    const language = options.language || navigator.language
    // `available()` is deferred to a microtask so an abort between start and
    // native invocation detaches its only consumer before touching the API.
    options.signal?.throwIfAborted()
    if (await checkBrowserLocalSpeechAvailability({ ...support, language, signal: options.signal }) !== 'available') {
        throw new Error(`On-device speech recognition is not installed for ${language}`)
    }
    options.signal?.throwIfAborted()

    const recognition = new support.constructor()
    recognition.continuous = true
    recognition.interimResults = true
    recognition.lang = language
    recognition.processLocally = true
    return runWebSpeechRecognitionSession(recognition, options.callbacks, { errorLabel: 'On-device transcription' })
}

const BROWSER_CLOUD_SOFT_END_ERROR_CODES = new Set(['no-speech'])

export async function startBrowserCloudTranscription(options: {
    language?: string
    signal?: AbortSignal
    callbacks: RealtimeTranscriptionCallbacks
}): Promise<RealtimeTranscriptionSession> {
    options.signal?.throwIfAborted()
    const constructor = getBrowserCloudSpeechSupport()
    if (!constructor) throw new Error('Browser cloud speech recognition is not supported by this browser')

    // Deliberately no `available()` probe and no `processLocally` — this is the
    // classic Web Speech API, which always uses the browser vendor's cloud
    // recognizer and never touches the on-device bridge that caused #1348.
    const recognition = new constructor()
    recognition.continuous = true
    recognition.interimResults = true
    recognition.lang = options.language || navigator.language
    return runWebSpeechRecognitionSession(recognition, options.callbacks, {
        errorLabel: 'Browser cloud transcription',
        softEndErrorCodes: BROWSER_CLOUD_SOFT_END_ERROR_CODES,
        treatUnexpectedEndAsFinish: true
    })
}
