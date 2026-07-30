/*
 * Playwright smoke for EventsDebugControls (#22). Uses the isolated vite
 * fixture (no hub auth). After hapi-driver-rebuild, the same panel lives
 * at Settings → Voice → Advanced on :3006.
 */

import { test, expect } from '@playwright/test'

test.describe('events debug viewer e2e', () => {
    test('expands, loads fixture events, refresh works', async ({ page }) => {
        await page.goto('/e2e-fixtures/events-debug-fixture.html')
        await expect(page.getByTestId('events-debug-fixture')).toBeVisible()

        const toggle = page.getByRole('button', { name: 'Overseer events (debug)' })
        await expect(toggle).toHaveAttribute('aria-expanded', 'false')

        await toggle.click()
        await expect(toggle).toHaveAttribute('aria-expanded', 'true')
        await expect(page.getByText('Substrate smoke event')).toBeVisible()
        await expect(page.getByText('1 rows')).toBeVisible()

        await page.evaluate(() => {
            window.__eventsDebugE2E!.setEvents([
                {
                    id: 2,
                    ts: Date.UTC(2026, 5, 19, 13, 0, 0),
                    sourceKind: 'hub',
                    sourceRef: null,
                    eventType: 'stale',
                    attentionCandidate: 1,
                    summary: 'Refreshed row',
                    provenance: 'session_end_fallback',
                    relatedSessionId: 'sess-smoke-02',
                    payloadJson: null,
                    severity: null,
                },
            ])
        })

        await page.getByRole('button', { name: 'Refresh' }).click()
        await expect(page.getByText('Refreshed row')).toBeVisible()
        await expect(page.getByText('attention')).toBeVisible()
    })

    test('shows error state when fetch fails', async ({ page }) => {
        await page.goto('/e2e-fixtures/events-debug-fixture.html')
        await page.evaluate(() => window.__eventsDebugE2E!.setError('boom'))

        const toggle = page.getByRole('button', { name: 'Overseer events (debug)' })
        await toggle.click()
        await expect(page.getByText('fixture fetch failed')).toBeVisible()
    })
})
