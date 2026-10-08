/**
 * #1996 proof: blocked lens lives in the combined filter menu.
 * Fixture-backed (same chrome as session-list-blocked) so we do not need a full peer hub.
 * Run from worktree with PLAYWRIGHT_RECORD_VIDEO=1 for annotated MP4/WebM.
 */
import { expect, test } from '@playwright/test'
import {
    clickForHuman,
    dwellForHuman,
} from '../scripts/dev/playwright-annotated-video.mjs'

const FIXTURE = '/e2e-fixtures/session-list-blocked-fixture.html'

test.describe('#1996 consolidate blocked into filter menu', () => {
    test('operator opens funnel menu and enables Blocked', async ({ page }) => {
        await page.goto(FIXTURE)
        await page.waitForSelector('[data-testid="blocked-section"]')

        await expect(page.getByTestId('blocked-lens-toggle')).toHaveCount(0)
        await expect(page.getByTestId('blocked-jump-pill')).toBeVisible()
        // Unfiltered list shows ordinary project rows beyond the blocked section.
        const beforeCount = await page.locator('[data-session-id]').count()
        expect(beforeCount).toBeGreaterThan(11)

        await clickForHuman(page.getByTestId('session-list-filter-menu'), {
            waitFor: () => expect(page.getByTestId('session-list-filter-blocked')).toBeVisible(),
        })

        await clickForHuman(page.getByTestId('session-list-filter-blocked'), {
            waitFor: async () => {
                await expect(page.getByTestId('session-list-filter-blocked')).toHaveAttribute('aria-checked', 'true')
                await expect(page.getByTestId('session-blocked-chip')).toHaveCount(11)
            },
        })

        // Close the menu so the narrowed list (not the dropdown) is the proof frame.
        await page.keyboard.press('Escape')
        await expect(page.getByRole('menu', { name: 'Filter sessions' })).toHaveCount(0)
        const afterCount = await page.locator('[data-session-id]').count()
        expect(afterCount).toBeLessThan(beforeCount)
        expect(afterCount).toBe(11)
        await expect(page.getByTestId('blocked-jump-pill')).toBeVisible()

        await dwellForHuman(page, 1200)
        await page.screenshot({
            path: 'localdocs/playwright-runs/1996-consolidate-blocked-filter.png',
            fullPage: false,
        })
    })
})
