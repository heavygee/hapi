/* HAPI host init for vendored operator-dock.js. App-owned; not the dock.
 * Visibility: /opmic knock OR localStorage hapi-operator-dock=true (Settings).
 * Keep in sync with web/src/lib/operator-dock-pref.ts
 *
 * Slice D / v0.11.6: package fail-closes H+fan when gate secret missing/bad.
 * Host probes any stored gate secret BEFORE init and clears a known-bad value so
 * the dock sheet opens empty (Quest: rejected sheet prefills stale secret; Save
 * without a clean paste re-sends junk → 403). Do not lasting-edit operator-dock.js.
 */
(function () {
    var PREF_KEY = 'hapi-operator-dock'
    var SECRET_KEY = 'hapiInlineSecret'
    var LEGACY_SECRET_KEY = 'operatorMicSecret'
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

    function getStoredSecret() {
        try {
            return (localStorage.getItem(SECRET_KEY) || localStorage.getItem(LEGACY_SECRET_KEY) || '').trim()
        } catch (e) {
            return ''
        }
    }

    function clearStoredSecret() {
        try {
            localStorage.removeItem(SECRET_KEY)
            localStorage.removeItem(LEGACY_SECRET_KEY)
        } catch (e) {}
    }

    function initDock() {
        if (typeof window.HapiInline.isReady === 'function' && window.HapiInline.isReady()) return
        window.HapiInline.init({
            appId: 'hapi-web',
            configUrl: '/hapi/config',
            navProvider: function () {
                return { route: location.pathname, app: 'hapi-web' }
            }
        })
    }

    function probeThenInit() {
        var secret = getStoredSecret()
        if (!secret) {
            initDock()
            return
        }
        fetch('/hapi/operator/sessions', {
            method: 'GET',
            headers: {
                Accept: 'application/json',
                'X-Hapi-Inline-Secret': secret,
                'X-Operator-Mic-Secret': secret
            },
            cache: 'no-store'
        }).then(function (res) {
            if (!res.ok) clearStoredSecret()
        }).catch(function () {
            // leave secret on network blip; dock will probe again
        }).then(function () {
            initDock()
        })
    }

    function boot() {
        if (!window.HapiInline || typeof window.HapiInline.init !== 'function') return
        persistKnock()
        var on = prefOn() || isKnock()
        applyAttr(on)
        if (!on) return
        probeThenInit()
    }

    window.HapiInlineHost = { boot: boot }
    boot()
})()
