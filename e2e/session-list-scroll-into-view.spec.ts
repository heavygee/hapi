import { expect, test, type Locator, type Page } from '@playwright/test'

const FIXTURE = '/e2e-fixtures/session-list-scroll-fixture.html'

function scroller(page: Page): Locator {
    return page.locator('.session-list-scrollbar-left')
}

function row(page: Page, sessionId: string): Locator {
    return page.locator(`[data-session-id="${sessionId}"]`)
}

async function scrollTop(page: Page): Promise<number> {
    return scroller(page).evaluate(element => element.scrollTop)
}

/** Edge offsets of the row relative to the scroll port, in CSS pixels. */
async function edgeOffsets(page: Page, sessionId: string): Promise<{
    top: number
    bottom: number
}> {
    const port = (await scroller(page).boundingBox())!
    const box = (await row(page, sessionId).boundingBox())!
    return { top: box.y - port.y, bottom: (box.y + box.height) - (port.y + port.height) }
}

/**
 * True when the row's own top edge is what a click would hit — the project
 * header is `position: sticky`, so "scrolled to the top edge" is not the same
 * as "the operator can see the row".
 */
async function isRowTopUnobstructed(page: Page, sessionId: string): Promise<boolean> {
    return row(page, sessionId).evaluate(element => {
        const box = element.getBoundingClientRect()
        const hit = document.elementFromPoint(box.left + box.width / 2, box.top + 2)
        return hit !== null && element.contains(hit)
    })
}

test.describe('session list scroll into view', () => {
    test('reveals a deep-linked session that mounts below the fold', async ({ page }) => {
        await page.goto(`${FIXTURE}?selected=session-30`)
        await row(page, 'session-30').waitFor()
        await page.waitForTimeout(500) // Reveal follows the project open animation.

        expect(await scrollTop(page)).toBeGreaterThan(0)
        const offsets = await edgeOffsets(page, 'session-30')
        expect(offsets.top).toBeGreaterThanOrEqual(-1)
        expect(offsets.bottom).toBeLessThanOrEqual(1)
    })

    test('reveals a programmatically selected session by its nearest edge', async ({ page }) => {
        await page.goto(FIXTURE)
        await row(page, 'session-0').waitFor()
        expect(await scrollTop(page)).toBe(0)

        await page.evaluate(() => window.selectSession('session-30'))
        await page.waitForTimeout(500)

        // Nearest-edge, not centered: the row sits flush with the bottom edge.
        const offsets = await edgeOffsets(page, 'session-30')
        expect(Math.abs(offsets.bottom)).toBeLessThan(2)
        expect(offsets.top).toBeGreaterThan(0)
    })

    test('reveals a selected session above the fold by its top edge', async ({ page }) => {
        await page.goto(FIXTURE)
        await row(page, 'session-30').scrollIntoViewIfNeeded()
        await page.waitForTimeout(100)
        const before = await scrollTop(page)
        expect(before).toBeGreaterThan(0)

        await page.evaluate(() => window.selectSession('session-10'))
        await page.waitForTimeout(500)

        expect(await scrollTop(page)).toBeLessThan(before)
        const offsets = await edgeOffsets(page, 'session-10')
        expect(offsets.top).toBeGreaterThanOrEqual(-1)
        expect(offsets.bottom).toBeLessThanOrEqual(1)
        // Flush with the top edge would park the row behind the sticky header.
        expect(await isRowTopUnobstructed(page, 'session-10')).toBe(true)
    })

    test('clears the sticky project header instead of hiding the row behind it', async ({ page }) => {
        await page.goto(FIXTURE)
        await row(page, 'session-20').waitFor()
        // Park the row's top edge just under the sticky header, where the old
        // "is it in the scroll port" answer would have been yes.
        await row(page, 'session-20').evaluate(element => element.scrollIntoView({ block: 'start' }))
        await page.waitForTimeout(100)
        expect(await isRowTopUnobstructed(page, 'session-20')).toBe(false)

        await page.evaluate(() => window.selectSession('session-20'))
        await page.waitForTimeout(500)

        expect(await isRowTopUnobstructed(page, 'session-20')).toBe(true)
    })

    test('leaves the list alone when the selected session is already visible', async ({ page }) => {
        await page.goto(FIXTURE)
        await row(page, 'session-20').waitFor()
        await row(page, 'session-20').evaluate(element => element.scrollIntoView({ block: 'center' }))
        await page.waitForTimeout(100)
        const before = await scrollTop(page)

        await page.evaluate(() => window.selectSession('session-20'))
        await page.waitForTimeout(500)

        expect(await scrollTop(page)).toBe(before)
    })

    test('expands a collapsed project and then reveals its row', async ({ page }) => {
        await page.goto(`${FIXTURE}?collapsed`)
        await row(page, 'session-0').waitFor()
        expect(await scrollTop(page)).toBe(0)

        await page.evaluate(() => window.selectSession('session-30'))
        await page.waitForTimeout(600) // 0.25s collapsible-panel transition plus settling.

        await expect(row(page, 'session-30')).toBeVisible()
        const offsets = await edgeOffsets(page, 'session-30')
        expect(offsets.top).toBeGreaterThanOrEqual(-1)
        expect(offsets.bottom).toBeLessThanOrEqual(1)
    })

    test('does not re-scroll to the selected session on later activity updates', async ({ page }) => {
        await page.goto(FIXTURE)
        await page.evaluate(() => window.selectSession('session-30'))
        await page.waitForTimeout(500)

        // The user scrolls elsewhere, then unrelated sessions keep updating.
        await scroller(page).evaluate(element => { element.scrollTop = 0 })
        for (const patch of [{ active: true, thinking: true }, { thinking: false }]) {
            await page.evaluate(patch => window.updateSession('session-5', patch), patch)
            await page.waitForTimeout(350)
        }

        expect(await scrollTop(page)).toBe(0)
    })

    test('reveals a selected session whose machine is filtered out of the list', async ({ page }) => {
        // Sessions alternate between the alpha and beta machines; the list is scoped
        // to alpha, so session-31 (beta) has no row to begin with.
        await page.goto(`${FIXTURE}?machines&machine=alpha`)
        await row(page, 'session-0').waitFor()
        await expect(row(page, 'session-31')).toHaveCount(0)

        await page.evaluate(() => window.selectSession('session-31'))
        await page.waitForTimeout(600)

        // Opening a session must not leave the list with no row for it — the
        // machine scope keeps the open session the way the other lenses do.
        await expect(row(page, 'session-31')).toHaveCount(1)
        const offsets = await edgeOffsets(page, 'session-31')
        expect(offsets.top).toBeGreaterThanOrEqual(-1)
        expect(offsets.bottom).toBeLessThanOrEqual(1)
        expect(await isRowTopUnobstructed(page, 'session-31')).toBe(true)
    })

    test('names the machine on an off-machine group so it cannot read as a duplicate', async ({ page }) => {
        // Even indices are alpha, odd beta; `sharedpaths` pairs them, so
        // session-30 (alpha) and session-31 (beta) share /project-15.
        await page.goto(`${FIXTURE}?machines&machine=alpha&sharedpaths`)
        await row(page, 'session-30').waitFor()

        await page.evaluate(() => window.selectSession('session-31'))
        await page.waitForTimeout(600)
        await expect(row(page, 'session-31')).toHaveCount(1)

        const titles = await page.$$eval('[data-session-group-header][title="/project-15"]',
            headers => headers.map(h => h.textContent?.trim() ?? ''))
        expect(titles).toHaveLength(2)
        expect(new Set(titles).size).toBe(2)
        expect(titles.some(t => t.includes('beta'))).toBe(true)
    })

    test('drops the off-machine row again once another session is selected', async ({ page }) => {
        await page.goto(`${FIXTURE}?machines&machine=alpha`)
        await row(page, 'session-0').waitFor()

        await page.evaluate(() => window.selectSession('session-31'))
        await page.waitForTimeout(600)
        await expect(row(page, 'session-31')).toHaveCount(1)

        await page.evaluate(() => window.selectSession('session-2'))
        await page.waitForTimeout(600)
        await expect(row(page, 'session-31')).toHaveCount(0)
    })

    test('yields to a wheel gesture made during the reveal', async ({ page }) => {
        await page.goto(`${FIXTURE}?collapsed`)
        await row(page, 'session-0').waitFor()

        await page.evaluate(() => window.selectSession('session-30'))
        await scroller(page).dispatchEvent('wheel')
        await scroller(page).evaluate(element => { element.scrollTop = 0 })
        await page.waitForTimeout(600)

        expect(await scrollTop(page)).toBe(0)
    })
})
