/*
 * BEFORE-fix peer-stack proof: /share picker shows summary while sidebar shows name.
 * Fork main only. Run with --no-up against an already-up peer stack.
 */

import { execFileSync } from 'node:child_process'
import { mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { test, expect, type Page } from '@playwright/test'

const hubUrl = (process.env.HAPI_PEER_WEB_URL ?? process.env.HAPI_PEER_HUB_URL ?? '').replace(/\/$/, '')
const accessToken = process.env.HAPI_PEER_CLI_TOKEN ?? process.env.HAPI_PEER_ACCESS_TOKEN ?? ''
const artifactRoot = process.env.HAPI_PEER_WORKTREE ?? process.cwd()
const mirrorRoot = process.cwd()

const SIDEBAR_SHOT = resolve(artifactRoot, 'localdocs/playwright-runs/share-title-parity-before-sidebar.png')
const SHARE_SHOT = resolve(artifactRoot, 'localdocs/playwright-runs/share-title-parity-before-share.png')

const SIDEBAR_NAME = 'hub runner version governance'
const SUMMARY_TEXT = 'HAPI Skill Lookup'

function requirePeerEnv(): void {
    if (!hubUrl || !accessToken) {
        throw new Error(
            'Missing peer stack env. Run hapi-peer-stack up then use --no-up with run-e2e-on-peer-stack.mjs'
        )
    }
}

function seedMismatchedSession(): { sessionId: string } {
    const out = execFileSync(
        'node',
        [
            resolve(mirrorRoot, 'scripts/dev/seed-share-title-mismatch-session.mjs'),
            '--hub-url',
            hubUrl,
            '--token',
            accessToken,
        ],
        { encoding: 'utf8' },
    ).trim()
    const data = JSON.parse(out) as { sessionId?: string }
    if (!data.sessionId) {
        throw new Error(`seed failed: ${out}`)
    }
    return { sessionId: data.sessionId }
}

async function injectAuth(page: Page): Promise<void> {
    const storageKey = `hapi_access_token::${hubUrl}`
    await page.addInitScript(({ key, token }) => {
        localStorage.setItem(key, token)
    }, { key: storageKey, token: accessToken })
}

async function seedShareTransfer(page: Page, transferId: string): Promise<void> {
    await page.evaluate(async ({ id }) => {
        const payload = {
            title: 'Title parity before-fix',
            text: 'Proof payload for share picker title mismatch',
            url: '',
            files: [] as Array<{ name: string; type: string; blob: Blob }>,
            createdAt: Date.now(),
        }
        await new Promise<void>((resolvePromise, reject) => {
            const request = indexedDB.open('hapi-share-transfers', 1)
            request.onupgradeneeded = () => {
                const db = request.result
                if (!db.objectStoreNames.contains('transfers')) {
                    db.createObjectStore('transfers', { keyPath: 'id' })
                }
            }
            request.onsuccess = () => {
                const db = request.result
                const tx = db.transaction('transfers', 'readwrite')
                tx.objectStore('transfers').put({ id, ...payload })
                tx.oncomplete = () => {
                    db.close()
                    resolvePromise()
                }
                tx.onerror = () => {
                    db.close()
                    reject(tx.error ?? new Error('share-transfer put failed'))
                }
            }
            request.onerror = () => reject(request.error ?? new Error('IDB open failed'))
        })
    }, { id: transferId })
}

test.describe('share session title parity — BEFORE fix', () => {
    test.beforeAll(() => {
        requirePeerEnv()
    })

    test('sidebar shows name; /share shows summary (bug)', async ({ page }) => {
        seedMismatchedSession()

        await injectAuth(page)
        await page.goto('/sessions', { waitUntil: 'domcontentloaded', timeout: 60_000 })
        await expect(page.getByText(SIDEBAR_NAME).first()).toBeVisible({ timeout: 60_000 })

        mkdirSync(dirname(SIDEBAR_SHOT), { recursive: true })
        await page.screenshot({ path: SIDEBAR_SHOT, fullPage: false })

        const transferId = `share-title-before-${Date.now()}`
        await seedShareTransfer(page, transferId)
        await page.goto(`/share?id=${encodeURIComponent(transferId)}`, {
            waitUntil: 'domcontentloaded',
            timeout: 60_000,
        })

        await expect(page.getByText('Share to HAPI')).toBeVisible({ timeout: 60_000 })
        await expect(page.getByText(SUMMARY_TEXT).first()).toBeVisible({ timeout: 30_000 })
        await expect(page.getByRole('button', { name: new RegExp(SIDEBAR_NAME) })).toHaveCount(0)

        mkdirSync(dirname(SHARE_SHOT), { recursive: true })
        await page.screenshot({ path: SHARE_SHOT, fullPage: false })
    })
})
