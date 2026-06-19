import { test, expect } from '@playwright/test'

test.describe('voice persistence chrome', () => {
    test('pill and receiving indicator survive route changes', async ({ page }) => {
        await page.goto('/e2e-fixtures/voice-persistence-fixture.html')

        await expect(page.getByTestId('voice-focus-pill')).toHaveText(/voice → Alpha worker/)
        await expect(page.getByTestId('session-card-session-a').getByTestId('voice-receiving-indicator')).toBeVisible()
        await expect(page.getByTestId('session-card-session-b').getByTestId('voice-receiving-indicator')).toHaveCount(0)

        await page.getByTestId('nav-session-b').click()
        await expect(page.getByTestId('route-label')).toHaveText('route:session-b')
        await expect(page.getByTestId('voice-focus-pill')).toHaveText(/voice → Alpha worker/)
        await expect(page.getByTestId('session-card-session-a').getByTestId('voice-receiving-indicator')).toBeVisible()

        await page.getByTestId('nav-settings').click()
        await expect(page.getByTestId('settings-view')).toBeVisible()
        await expect(page.getByTestId('voice-focus-pill')).toBeVisible()
        await expect(page.getByTestId('session-card-session-a').getByTestId('voice-receiving-indicator')).toBeVisible()
    })
})
