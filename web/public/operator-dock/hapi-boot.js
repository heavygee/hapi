/* HAPI host init for vendored operator-dock.js. App-owned; not the dock.
 * Visibility: /opmic knock OR localStorage hapi-operator-dock=true (Settings).
 * Keep in sync with web/src/lib/operator-dock-pref.ts
 */
(function () {
    var PREF_KEY = 'hapi-operator-dock'
    var UNLOCK_PATHS = { '/opmic': 1, '/mic': 1, '/unlock': 1 }

    function normalizePathname(pathname) {
        var raw = String(pathname || '/').trim() || '/'
        if (raw === '/') return '/'
        return raw.replace(/\/+$/, '') || '/'
    }

    function isKnock() {
        if (UNLOCK_PATHS[normalizePathname(location.pathname)]) return true
        try {
            return new URLSearchParams(location.search).has('opmic')
        } catch (e) {
            return false
        }
    }

    function prefOn() {
        try {
            return localStorage.getItem(PREF_KEY) === 'true'
        } catch (e) {
            return false
        }
    }

    function applyAttr(on) {
        document.documentElement.setAttribute('data-hapi-operator-dock', on ? 'on' : 'off')
    }

    function persistKnock() {
        if (!isKnock()) return
        try {
            localStorage.setItem(PREF_KEY, 'true')
        } catch (e) {}
    }

    function boot() {
        if (!window.HapiInline || typeof window.HapiInline.init !== 'function') return
        persistKnock()
        var on = prefOn() || isKnock()
        applyAttr(on)
        if (!on) return
        if (typeof window.HapiInline.isReady === 'function' && window.HapiInline.isReady()) return
        window.HapiInline.init({
            appId: 'hapi-web',
            configUrl: '/hapi/config',
            navProvider: function () {
                return { route: location.pathname, app: 'hapi-web' }
            }
        })
    }

    window.HapiInlineHost = { boot: boot }
    boot()
})()
