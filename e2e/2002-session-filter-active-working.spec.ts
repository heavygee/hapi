/**
 * #2002 proof: Active + Working lenses in the combined filter menu.
 * Fixture-backed (same chrome as session-list-blocked) so we do not need a full peer hub.
 */
import { expect, test } from '@playwright/test'
import {
    clickForHuman,
    dwellForHuman,
} from '../scripts/dev/playwright-annotated-video.mjs'

const FIXTURE = '/e2e-fixtures/session-list-blocked-fixture.html'

test.describe('#2002 Active + Working session list filters', () => {
    test('operator opens funnel menu and sees Active + Working options', async ({ page }) => {
        await page.goto(FIXTURE)
        await page.waitForSelector('[data-testid="session-list-filter-menu"]')

        await clickForHuman(page.getByTestId('session-list-filter-menu'), {
            waitFor: () => expect(page.getByTestId('session-list-filter-working')).toBeVisible(),
        })

        await expect(page.getByTestId('session-list-filter-active')).toBeVisible()
        await expect(page.getByTestId('session-list-filter-working')).toBeVisible()
        await expect(page.getByTestId('session-list-filter-active')).toHaveAttribute('aria-checked', 'false')
        await expect(page.getByTestId('session-list-filter-working')).toHaveAttribute('aria-checked', 'false')

        await clickForHuman(page.getByTestId('session-list-filter-active'), {
            waitFor: () => expect(page.getByTestId('session-list-filter-active')).toHaveAttribute('aria-checked', 'true'),
        })

        await clickForHuman(page.getByTestId('session-list-filter-working'), {
            waitFor: () => expect(page.getByTestId('session-list-filter-working')).toHaveAttribute('aria-checked', 'true'),
        })

        await dwellForHuman(page, 1200)
        await page.screenshot({
            path: 'localdocs/playwright-runs/2002-session-filter-active-working.png',
            fullPage: false,
        })
    })
})
