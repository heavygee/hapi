import { basename } from 'path'
import { lstat, readFile } from 'node:fs/promises'
import { logger } from '@/ui/logger'

export type GeneratedImageMetadata = {
    id: string
    fileName: string
    content: Buffer
    mimeType: string
    createdAt: number
}

export const MAX_GENERATED_IMAGE_BYTES = 25 * 1024 * 1024
/** Approx max base64 chars for MAX_GENERATED_IMAGE_BYTES (+ padding slack). */
export const MAX_GENERATED_IMAGE_BASE64_CHARS = Math.ceil(MAX_GENERATED_IMAGE_BYTES * 4 / 3) + 4
const MAX_GENERATED_IMAGE_TOTAL_BYTES = 100 * 1024 * 1024
const MAX_GENERATED_IMAGE_COUNT = 100
const DEFAULT_PATH_REGISTER_RETRIES = 3
const PATH_REGISTER_RETRY_DELAY_MS = 50

const generatedImages = new Map<string, GeneratedImageMetadata>()
let generatedImageBytes = 0

/** Decode inline media base64 only after a cheap length gate (avoids huge Buffer allocations). */
export function decodeGeneratedImageBase64(data: string): Buffer | null {
    if (data.length > MAX_GENERATED_IMAGE_BASE64_CHARS) {
        return null
    }
    const bytes = Buffer.from(data, 'base64')
    if (bytes.byteLength > MAX_GENERATED_IMAGE_BYTES) {
        return null
    }
    return bytes
}

export function detectImageMimeType(bytes: Uint8Array): string | null {
    if (bytes.length >= 8
        && bytes[0] === 0x89
        && bytes[1] === 0x50
        && bytes[2] === 0x4e
        && bytes[3] === 0x47
        && bytes[4] === 0x0d
        && bytes[5] === 0x0a
        && bytes[6] === 0x1a
        && bytes[7] === 0x0a) {
        return 'image/png'
    }

    if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
        return 'image/jpeg'
    }

    if (bytes.length >= 6) {
        const header = ascii(bytes, 0, 6)
        if (header === 'GIF87a' || header === 'GIF89a') {
            return 'image/gif'
        }
    }

    if (bytes.length >= 12 && ascii(bytes, 0, 4) === 'RIFF' && ascii(bytes, 8, 12) === 'WEBP') {
        return 'image/webp'
    }

    if (bytes.length >= 12
        && bytes[0] === 0x00
        && bytes[1] === 0x00
        && bytes[2] === 0x00
        && ascii(bytes, 4, 8) === 'ftyp'
        && (ascii(bytes, 8, 12) === 'avif' || ascii(bytes, 8, 12) === 'avis')) {
        return 'image/avif'
    }

    return null
}

function ascii(bytes: Uint8Array, start: number, end: number): string {
    return String.fromCharCode(...bytes.subarray(start, end))
}

export function registerGeneratedImage(args: { id: string; path: string; mimeType: string; bytes: Uint8Array; fileName?: string | null }): GeneratedImageMetadata {
    const content = Buffer.from(args.bytes)
    if (content.byteLength > MAX_GENERATED_IMAGE_BYTES) {
        throw new Error('Image is too large to display inline')
    }

    const previous = generatedImages.get(args.id)
    if (previous) {
        generatedImageBytes -= previous.content.byteLength
    }

    const metadata: GeneratedImageMetadata = {
        id: args.id,
        fileName: args.fileName || basename(args.path) || `${args.id}.png`,
        content,
        mimeType: args.mimeType,
        createdAt: Date.now()
    }
    generatedImages.set(args.id, metadata)
    generatedImageBytes += content.byteLength

    evictOldGeneratedImages()

    return metadata
}

function evictOldGeneratedImages(): void {
    while (generatedImages.size > MAX_GENERATED_IMAGE_COUNT || generatedImageBytes > MAX_GENERATED_IMAGE_TOTAL_BYTES) {
        const oldestId = generatedImages.keys().next().value
        if (!oldestId) break
        const oldest = generatedImages.get(oldestId)
        if (oldest) {
            generatedImageBytes -= oldest.content.byteLength
        }
        generatedImages.delete(oldestId)
    }
}

export function getGeneratedImage(id: string): GeneratedImageMetadata | null {
    return generatedImages.get(id) ?? null
}

export function clearGeneratedImages(): void {
    generatedImages.clear()
    generatedImageBytes = 0
}

function sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms))
}

function isRetryablePathError(error: unknown): boolean {
    if (!error || typeof error !== 'object') return false
    const code = 'code' in error ? String(error.code) : ''
    return code === 'ENOENT' || code === 'EBUSY' || code === 'EAGAIN'
}

/**
 * Read + validate + snapshot a local image path into the generated-image store.
 * Retries briefly on ENOENT/EBUSY so writers that notify before flush completes can catch up.
 * Returns null on failure (never throws); logs each attempt.
 */
export async function registerGeneratedImageFromPath(args: {
    id: string
    path: string
    fileName?: string | null
    retries?: number
}): Promise<GeneratedImageMetadata | null> {
    const attempts = Math.max(1, args.retries ?? DEFAULT_PATH_REGISTER_RETRIES)
    let lastError: unknown

    for (let attempt = 1; attempt <= attempts; attempt += 1) {
        try {
            const info = await lstat(args.path)
            if (!info.isFile()) {
                throw new Error('Path is not a regular file')
            }
            if (info.size > MAX_GENERATED_IMAGE_BYTES) {
                throw new Error('Image is too large to display inline')
            }
            const bytes = await readFile(args.path)
            const mimeType = detectImageMimeType(bytes)
            if (!mimeType) {
                throw new Error('Unsupported image content')
            }
            return registerGeneratedImage({
                id: args.id,
                path: args.path,
                fileName: args.fileName,
                mimeType,
                bytes,
            })
        } catch (error) {
            lastError = error
            const message = error instanceof Error ? error.message : String(error)
            const retryable = isRetryablePathError(error) && attempt < attempts
            logger.debug(
                `[generatedImages] registerFromPath attempt ${attempt}/${attempts} failed for ${args.path}: ${message}`
                    + (retryable ? ' (retrying)' : ''),
            )
            if (!retryable) {
                break
            }
            await sleep(PATH_REGISTER_RETRY_DELAY_MS * attempt)
        }
    }

    const finalMessage = lastError instanceof Error ? lastError.message : String(lastError)
    logger.warn(`[generatedImages] Failed to register image from path after ${attempts} attempt(s): ${args.path} (${finalMessage})`)
    return null
}
