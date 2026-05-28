import { Hono } from 'hono'
import { existsSync } from 'node:fs'
import { join } from 'node:path'

const SESSION_DIR = process.env.SOUL_SESSION_DIR ?? '/home/heavygee/coding/SOUL/.session'

function portraitPath(ext: 'webp' | 'png' | 'jpg'): string | null {
    const name = ext === 'jpg' ? 'portrait-latest.jpg' : `portrait-latest.${ext}`
    const full = join(SESSION_DIR, name)
    return existsSync(full) ? full : null
}

/** Tailnet-only static portrait for Jessica interior-life markdown (no JWT — browser <img> cannot send Bearer). */
export function createJessicaMoodRoutes(): Hono {
    const app = new Hono()

    app.get('/jessica-mood/portrait.webp', (c) => {
        const path = portraitPath('webp') ?? portraitPath('png')
        if (!path) {
            return c.text('Portrait not found', 404)
        }
        const mime = path.endsWith('.webp') ? 'image/webp' : 'image/png'
        return new Response(Bun.file(path), {
            headers: {
                'Content-Type': mime,
                'Cache-Control': 'no-store'
            }
        })
    })

    app.get('/jessica-mood/portrait.png', (c) => {
        const path = portraitPath('png') ?? portraitPath('webp')
        if (!path) {
            return c.text('Portrait not found', 404)
        }
        const mime = path.endsWith('.png') ? 'image/png' : 'image/webp'
        return new Response(Bun.file(path), {
            headers: {
                'Content-Type': mime,
                'Cache-Control': 'no-store'
            }
        })
    })

    return app
}
