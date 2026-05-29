/// <reference lib="webworker" />
import { precacheAndRoute } from 'workbox-precaching'
import { registerRoute } from 'workbox-routing'
import { CacheFirst, NetworkFirst } from 'workbox-strategies'
import { ExpirationPlugin } from 'workbox-expiration'

declare const self: ServiceWorkerGlobalScope & {
    __WB_MANIFEST: Array<string | { url: string; revision?: string }>
}

type PushPayload = {
    title: string
    body?: string
    icon?: string
    badge?: string
    tag?: string
    data?: {
        type?: string
        sessionId?: string
        url?: string
        requestId?: string
    }
}

type HubAuth = {
    baseUrl: string
    token: string
}

/** Chromium notification extensions (inline reply, action buttons). */
type HapiNotificationAction = {
    action: string
    title: string
    icon?: string
    type?: 'button' | 'text'
    placeholder?: string
}

type HapiNotificationOptions = NotificationOptions & {
    actions?: HapiNotificationAction[]
}

type HapiNotificationEvent = NotificationEvent & {
    reply?: string
}

const HUB_URL_KEY = 'hapi_hub_url'
const ACCESS_TOKEN_PREFIX = 'hapi_access_token::'

precacheAndRoute(self.__WB_MANIFEST)

registerRoute(
    ({ url }) => url.pathname === '/api/sessions',
    new NetworkFirst({
        cacheName: 'api-sessions',
        networkTimeoutSeconds: 10,
        plugins: [
            new ExpirationPlugin({
                maxEntries: 10,
                maxAgeSeconds: 60 * 5
            })
        ]
    })
)

registerRoute(
    ({ url }) => /^\/api\/sessions\/[^/]+$/.test(url.pathname),
    new NetworkFirst({
        cacheName: 'api-session-detail',
        networkTimeoutSeconds: 10,
        plugins: [
            new ExpirationPlugin({
                maxEntries: 20,
                maxAgeSeconds: 60 * 5
            })
        ]
    })
)

registerRoute(
    ({ url }) => url.pathname === '/api/machines',
    new NetworkFirst({
        cacheName: 'api-machines',
        networkTimeoutSeconds: 10,
        plugins: [
            new ExpirationPlugin({
                maxEntries: 5,
                maxAgeSeconds: 60 * 10
            })
        ]
    })
)

registerRoute(
    /^https:\/\/cdn\.socket\.io\/.*/,
    new CacheFirst({
        cacheName: 'cdn-socketio',
        plugins: [
            new ExpirationPlugin({
                maxEntries: 5,
                maxAgeSeconds: 60 * 60 * 24 * 30
            })
        ]
    })
)

registerRoute(
    /^https:\/\/telegram\.org\/.*/,
    new CacheFirst({
        cacheName: 'cdn-telegram',
        plugins: [
            new ExpirationPlugin({
                maxEntries: 5,
                maxAgeSeconds: 60 * 60 * 24 * 7
            })
        ]
    })
)

function readHubAuth(): HubAuth | null {
    try {
        const baseUrl = localStorage.getItem(HUB_URL_KEY) ?? self.location.origin
        const token = localStorage.getItem(`${ACCESS_TOKEN_PREFIX}${baseUrl}`)
        if (!token) {
            return null
        }
        return { baseUrl, token }
    } catch {
        return null
    }
}

function resolveAppUrl(path: string, baseUrl: string): string {
    const normalized = path.startsWith('/') ? path : `/${path}`
    return new URL(normalized, baseUrl).href
}

async function hubFetch(
    auth: HubAuth,
    path: string,
    init: RequestInit
): Promise<Response> {
    const url = resolveAppUrl(path, auth.baseUrl)
    return fetch(url, {
        ...init,
        headers: {
            'content-type': 'application/json',
            authorization: `Bearer ${auth.token}`,
            ...(init.headers ?? {})
        }
    })
}

async function sendSessionMessage(auth: HubAuth, sessionId: string, text: string): Promise<boolean> {
    const response = await hubFetch(auth, `/api/sessions/${encodeURIComponent(sessionId)}/messages`, {
        method: 'POST',
        body: JSON.stringify({
            text,
            localId: crypto.randomUUID()
        })
    })
    return response.ok
}

async function approvePermission(
    auth: HubAuth,
    sessionId: string,
    requestId: string
): Promise<boolean> {
    const response = await hubFetch(
        auth,
        `/api/sessions/${encodeURIComponent(sessionId)}/permissions/${encodeURIComponent(requestId)}/approve`,
        { method: 'POST', body: '{}' }
    )
    return response.ok
}

async function denyPermission(
    auth: HubAuth,
    sessionId: string,
    requestId: string
): Promise<boolean> {
    const response = await hubFetch(
        auth,
        `/api/sessions/${encodeURIComponent(sessionId)}/permissions/${encodeURIComponent(requestId)}/deny`,
        { method: 'POST', body: '{}' }
    )
    return response.ok
}

async function focusOrOpenSession(url: string): Promise<void> {
    const target = new URL(url)
    const clients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true })
    for (const client of clients) {
        const clientUrl = new URL(client.url)
        if (clientUrl.origin !== target.origin) {
            continue
        }
        await client.focus()
        if ('navigate' in client && typeof client.navigate === 'function') {
            await client.navigate(url)
            return
        }
    }
    await self.clients.openWindow(url)
}

function buildNotificationOptions(payload: PushPayload): HapiNotificationOptions {
    const data = payload.data
    const type = data?.type
    const sessionId = data?.sessionId
    const base: HapiNotificationOptions = {
        body: payload.body ?? '',
        icon: payload.icon ?? '/pwa-192x192.png',
        badge: payload.badge ?? '/pwa-64x64.png',
        data,
        tag: payload.tag,
        requireInteraction: type === 'permission-request' || type === 'ready'
    }

    if (!sessionId) {
        return base
    }

    if (type === 'ready') {
        return {
            ...base,
            actions: [
                {
                    action: 'reply',
                    title: 'Reply',
                    type: 'text',
                    placeholder: 'Tell the agent what to do…'
                },
                {
                    action: 'open',
                    title: 'Open',
                    type: 'button'
                }
            ]
        }
    }

    if (type === 'permission-request' && data.requestId) {
        return {
            ...base,
            actions: [
                {
                    action: 'allow',
                    title: 'Allow',
                    type: 'button'
                },
                {
                    action: 'deny',
                    title: 'Deny',
                    type: 'button'
                },
                {
                    action: 'open',
                    title: 'Open',
                    type: 'button'
                }
            ]
        }
    }

    return {
        ...base,
        actions: [
            {
                action: 'open',
                title: 'Open',
                type: 'button'
            }
        ]
    }
}

async function showActionFailed(title: string, body: string): Promise<void> {
    await self.registration.showNotification(title, {
        body,
        tag: 'hapi-action-failed',
        icon: '/pwa-192x192.png'
    })
}

self.addEventListener('push', (event) => {
    const payload = event.data?.json() as PushPayload | undefined
    if (!payload) {
        return
    }

    const title = payload.title || 'HAPI'
    event.waitUntil(
        self.registration.showNotification(title, buildNotificationOptions(payload))
    )
})

self.addEventListener('notificationclick', (event: HapiNotificationEvent) => {
    event.notification.close()
    const data = event.notification.data as PushPayload['data'] | undefined
    const sessionId = data?.sessionId
    const requestId = data?.requestId
    const path = data?.url ?? (sessionId ? `/sessions/${sessionId}` : '/')
    const action = event.action

    const run = async () => {
        const auth = readHubAuth()
        const authBase = auth?.baseUrl ?? self.location.origin
        const appUrl = resolveAppUrl(path, authBase)

        if (action === 'reply') {
            const reply = event.reply?.trim()
            if (!reply || !sessionId) {
                await focusOrOpenSession(appUrl)
                return
            }
            if (!auth) {
                await showActionFailed('HAPI', 'Sign in on your phone, then try again.')
                await focusOrOpenSession(appUrl)
                return
            }
            const ok = await sendSessionMessage(auth, sessionId, reply)
            if (!ok) {
                await showActionFailed('HAPI', 'Could not send your reply. Open the session to retry.')
                await focusOrOpenSession(appUrl)
            }
            return
        }

        if (action === 'allow' && sessionId && requestId) {
            if (!auth) {
                await showActionFailed('HAPI', 'Sign in on your phone, then try again.')
                await focusOrOpenSession(appUrl)
                return
            }
            const ok = await approvePermission(auth, sessionId, requestId)
            if (!ok) {
                await showActionFailed('HAPI', 'Could not approve. Open the session to retry.')
                await focusOrOpenSession(appUrl)
            }
            return
        }

        if (action === 'deny' && sessionId && requestId) {
            if (!auth) {
                await showActionFailed('HAPI', 'Sign in on your phone, then try again.')
                await focusOrOpenSession(appUrl)
                return
            }
            const ok = await denyPermission(auth, sessionId, requestId)
            if (!ok) {
                await showActionFailed('HAPI', 'Could not deny. Open the session to retry.')
                await focusOrOpenSession(appUrl)
            }
            return
        }

        await focusOrOpenSession(appUrl)
    }

    event.waitUntil(run())
})
