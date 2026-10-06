/*
 * OBSOLETE / WRONG PRODUCT MODEL - superseded by tiann/hapi#1457 / PR #1458.
 * #1431/#1432 lifted project-pin folders above In progress; operator reverted that.
 * Use e2e/peer/1457-project-pin-intra-group-only.spec.ts instead.
 * This file kept only so old run docs do not 404; test is skipped.
 */

import { test } from '@playwright/test'

test.describe('1431 project pin above In progress (obsolete)', () => {
    test.skip(true, 'Superseded by #1457 - project pins must NOT lift folders above In progress')
    test('project-pin group precedes In progress which precedes other groups', async () => {
        // intentionally empty - skipped
    })
})
