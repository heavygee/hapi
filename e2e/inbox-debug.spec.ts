/*
 * Playwright smoke for InboxDebugControls (#23).
 */

import { test, expect } from '@playwright/test'

test.describe('inbox debug viewer e2e', () => {
    test('expands, loads fixture items, action buttons work', async ({ page }) => {
        await page.goto('/e2e-fixtures/inbox-debug-fixture.html')
        await expect(page.getByTestId('inbox-debug-fixture')).toBeVisible()

        const toggle = page.getByRole('button', { name: 'Attention inbox (debug)' })
        await expect(toggle).toHaveAttribute('aria-expanded', 'false')

        await toggle.click()
        await expect(toggle).toHaveAttribute('aria-expanded', 'true')
        await expect(page.getByText('CI auth failed on push')).toBeVisible()
        await expect(page.getByText('feat: inbox substrate')).toBeVisible()
        await expect(page.getByText('1 items')).toBeVisible()
        await expect(page.getByText('BLOCKED tier')).toBeVisible()

        await page.getByRole('button', { name: 'done', exact: true }).click()
        await page.getByRole('button', { name: 'Refresh' }).click()
        await expect(page.getByText('1 items')).toBeVisible()
    })

    test('shows error state when fetch fails', async ({ page }) => {
        await page.goto('/e2e-fixtures/inbox-debug-fixture.html')
        await page.evaluate(() => window.__inboxDebugE2E!.setError('boom'))

        const toggle = page.getByRole('button', { name: 'Attention inbox (debug)' })
        await toggle.click()
        await expect(page.getByText('fixture fetch failed')).toBeVisible()
    })
})
