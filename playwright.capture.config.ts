import { annotatedVideoUseOption } from './scripts/dev/playwright-annotated-video.mjs'
import base from './playwright.config'

export default {
    ...base,
    use: {
        ...base.use,
        // Force-on still uses annotated overlays — never raw `video: 'on'`.
        video: annotatedVideoUseOption('on'),
        launchOptions: {
            ...(base.projects?.[0]?.use?.launchOptions ?? {}),
        },
    },
    outputDir: 'localdocs/playwright-runs/test-output',
}
