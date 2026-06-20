/** Meta Quest Browser ships `OculusBrowser/` in the UA (Quest 1-3, Pro, 3S). */
export function isQuestBrowser(userAgent: string = typeof navigator !== 'undefined' ? navigator.userAgent : ''): boolean {
    return /OculusBrowser/i.test(userAgent)
}
