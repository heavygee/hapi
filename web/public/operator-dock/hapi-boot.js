/* HAPI host init for vendored operator-dock.js. App-owned; not the dock. */
(function () {
    if (!window.HapiInline || typeof window.HapiInline.init !== 'function') return
    window.HapiInline.init({
        appId: 'hapi-web',
        configUrl: '/hapi/config',
        navProvider: function () {
            return { route: location.pathname, app: 'hapi-web' }
        }
    })
})()
