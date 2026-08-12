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

    // Even 90°→180° arc, R=108, plate 168. Drop when hapi-inline#112 tags.
    // Keep in sync with web/src/lib/operator-dock-fan-geometry.ts
    function injectFanGeometryFix() {
        if (document.getElementById('hapi-host-fan-geometry-112')) return
        var css = [
            '.opdock--cluster-open .opdock-cluster{width:168px;height:168px}',
            '.opdock--cluster-open .opdock-sat[data-tool="sessions"]{transform:translate(0px,-108px) scale(1)!important}',
            '.opdock--cluster-open .opdock-sat[data-tool="markup"]{transform:translate(-54px,-94px) scale(1)!important}',
            '.opdock--cluster-open .opdock-sat[data-tool="mic"]{transform:translate(-94px,-54px) scale(1)!important}',
            '.opdock--cluster-open .opdock-sat[data-tool="settings"]{transform:translate(-108px,0px) scale(1)!important}'
        ].join('')
        var style = document.createElement('style')
        style.id = 'hapi-host-fan-geometry-112'
        style.setAttribute('data-hapi-inline-issue', '112')
        style.textContent = css
        ;(document.head || document.documentElement).appendChild(style)
    }

    function boot() {
        if (!window.HapiInline || typeof window.HapiInline.init !== 'function') return
        persistKnock()
        var on = prefOn() || isKnock()
        applyAttr(on)
        if (!on) return
        injectFanGeometryFix()
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
