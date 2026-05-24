import { createHash } from 'node:crypto'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const publicPath = resolve(__dirname, '../public/xr-poc/index.html')
const distPath = resolve(__dirname, '../dist/xr-poc/index.html')

if (!existsSync(publicPath)) {
    console.warn('[stamp-xr-poc] skip: missing public/xr-poc/index.html')
    process.exit(0)
}

const source = readFileSync(publicPath, 'utf8')
const hash = createHash('sha256')
    .update(source.replaceAll('__XR_POC_BUILD__', '').replaceAll('__XR_POC_BUILT_AT__', ''))
    .digest('hex')
    .slice(0, 10)
const builtAt = new Date().toISOString()
const stamped = source
    .replaceAll('__XR_POC_BUILD__', hash)
    .replaceAll('__XR_POC_BUILT_AT__', builtAt)

if (!existsSync(distPath)) {
    console.warn('[stamp-xr-poc] skip: missing dist/xr-poc/index.html (run vite build first)')
    process.exit(0)
}

writeFileSync(distPath, stamped)

const buildInfoPath = resolve(__dirname, '../dist/xr-poc/build-info.json')
writeFileSync(buildInfoPath, `${JSON.stringify({ build: hash, builtAt }, null, 2)}\n`)

console.log(`[stamp-xr-poc] xr-poc build ${hash} @ ${builtAt}`)
