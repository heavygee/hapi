/**
 * Playwright screencast helpers — estate default for ANY recorded video.
 *
 * Videos are for humans. When recording is on:
 *   1. Annotated screencast (element highlight + moving pointer) — never raw `video: 'on'`
 *   2. `clickForHuman` / `dwellForHuman` — wait for the UI result, then dwell so a
 *      person can see it happened. Smash-cut robot clips fail even if `expect` passed.
 *
 * Requires Playwright >= 1.59 (screencast.showActions); cursor animation needs >= 1.61.
 *
 * @playwright/test fixtures:
 *   import { annotatedVideoUseOption } from './scripts/dev/playwright-annotated-video.mjs'
 *   use: { video: shouldRecordAnnotatedVideo() ? annotatedVideoUseOption('on') : 'off' }
 *
 * Programmatic (handoff .mjs scripts):
 *   import { startAnnotatedScreencast, stopAnnotatedScreencast, clickForHuman } from './playwright-annotated-video.mjs'
 *   await startAnnotatedScreencast(page, { path: 'localdocs/playwright-runs/demo.webm' })
 *   await clickForHuman(page.getByRole('button', { name: 'Send' }))
 *   await stopAnnotatedScreencast(page)
 */

/** Dwell after the UI result is on screen (human can register the click worked). */
export const HUMAN_DWELL_MS = 1000

/** Default overlays: element outline, action title, pointer glide between clicks. */
export const ANNOTATED_SHOW_ACTIONS = {
    position: 'top-right',
    cursor: 'pointer',
    duration: HUMAN_DWELL_MS,
    fontSize: 22,
}

/**
 * `use.video` value for @playwright/test when recording with action annotations.
 * @param {import('@playwright/test').VideoMode} mode
 * @param {import('@playwright/test').ViewportSize | undefined} size
 */
export function annotatedVideoUseOption(mode = 'on', size) {
    const option = {
        mode,
        show: {
            actions: {
                position: ANNOTATED_SHOW_ACTIONS.position,
                cursor: ANNOTATED_SHOW_ACTIONS.cursor,
                duration: ANNOTATED_SHOW_ACTIONS.duration,
                fontSize: ANNOTATED_SHOW_ACTIONS.fontSize,
            },
        },
    }
    if (size) option.size = size
    return option
}

export function shouldRecordAnnotatedVideo() {
    return process.env.HAPI_PEER_RECORD_VIDEO === '1' || process.env.PLAYWRIGHT_RECORD_VIDEO === '1'
}

/**
 * Start annotated screencast on a page (replaces raw `recordVideo` on browser context).
 * @param {import('playwright').Page} page
 * @param {{ path: string, showActions?: typeof ANNOTATED_SHOW_ACTIONS, size?: { width: number, height: number } }} options
 */
export async function startAnnotatedScreencast(page, options) {
    const { path, showActions = ANNOTATED_SHOW_ACTIONS, size } = options
    await page.screencast.start({ path, size })
    await page.screencast.showActions(showActions)
}

/** Stop screencast and finalize the file written by {@link startAnnotatedScreencast}. */
export async function stopAnnotatedScreencast(page) {
    await page.screencast.stop()
}

/** Resolve webm/mp4 paths under a handoff output directory. */
export function annotatedVideoPaths(dir, basename) {
    const webm = `${dir.replace(/\/$/, '')}/${basename}.webm`
    const mp4 = `${dir.replace(/\/$/, '')}/${basename}.mp4`
    return { webm, mp4 }
}

/**
 * Hold on the current frame so a human watching the clip can see the result.
 * Use AFTER the UI consequence is visible (toast, panel, navigation), not instead of waiting for it.
 * @param {import('playwright').Page} page
 * @param {number} [ms]
 */
export async function dwellForHuman(page, ms = HUMAN_DWELL_MS) {
    await page.waitForTimeout(ms)
}

/**
 * Click with human pacing: click, optional wait-for-result, then dwell.
 * The annotated screencast overlay shows *where* the click landed; the dwell shows *that it worked*.
 *
 * @param {import('playwright').Locator} locator
 * @param {{ waitFor?: () => Promise<unknown>, dwellMs?: number, click?: import('playwright').LocatorClickOptions }} [options]
 */
export async function clickForHuman(locator, options = {}) {
    const page = locator.page()
    await locator.click(options.click)
    if (options.waitFor) {
        await options.waitFor()
    }
    await dwellForHuman(page, options.dwellMs ?? HUMAN_DWELL_MS)
}
