import base from './playwright.config'

export default {
    ...base,
    use: {
        ...base.use,
        video: 'on' as const,
        launchOptions: {
            ...(base.projects?.[0]?.use?.launchOptions ?? {}),
        },
    },
    outputDir: 'localdocs/playwright-runs/test-output',
}
