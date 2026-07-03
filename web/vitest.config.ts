import { defineConfig, mergeConfig, type UserConfig } from 'vitest/config'
import viteConfigFn from './vite.config'

// vite.config.ts exports a function; resolve it for 'test' mode so IWER stubs
// are NOT applied during tests (we want real IWER for any WebXR E2E tests).
const viteConfig = (typeof viteConfigFn === 'function'
    ? viteConfigFn({ mode: 'test', command: 'serve', isSsrBuild: false, isPreview: false })
    : viteConfigFn) as UserConfig

export default mergeConfig(
    viteConfig,
    defineConfig({
        test: {
            globals: false,
            environment: 'jsdom',
            include: ['src/**/*.test.{ts,tsx}'],
            setupFiles: ['./src/test/setup.ts'],
        },
    })
)
