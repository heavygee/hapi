type TitleWriteOptions = {
    allowTitleUpdate?: boolean
    titleLocked?: boolean
    /** Override process-wide name-once policy for tests. */
    nameOnce?: boolean
}

const record = (value: unknown): Record<string, unknown> | null =>
    value !== null && typeof value === 'object' && !Array.isArray(value)
        ? value as Record<string, unknown> : null

let nameOnceEnabled = false

/** Hub settings apply this so create/update paths auto-lock under name_once. */
export function setNameOnceTitlePolicyEnabled(enabled: boolean): void {
    nameOnceEnabled = enabled === true
}

export function isNameOnceTitlePolicyEnabled(): boolean {
    return nameOnceEnabled
}

/** Durable titles exclude provisional promptTitle (does not block naming). */
export function metadataHasDurableTitle(meta: Record<string, unknown> | null | undefined): boolean {
    if (!meta) return false
    if (typeof meta.name === 'string' && meta.name.trim().length > 0) return true
    const summary = meta.summary
    if (summary && typeof summary === 'object' && !Array.isArray(summary)) {
        const text = (summary as { text?: unknown }).text
        if (typeof text === 'string' && text.trim().length > 0) return true
    }
    return false
}

/** Only a user title save may change the lock; enforce against the raw persisted row. */
export function preserveSessionTitle(prior: unknown, incoming: unknown, options?: TitleWriteOptions): unknown {
    const previous = record(prior)
    const nameOnce = options?.nameOnce ?? nameOnceEnabled
    const locked = options?.titleLocked ?? (previous?.titleLocked === true)
    const protectTitle = previous?.titleLocked === true && !options?.allowTitleUpdate
    const next = record(incoming)
    if (!next && !locked && !protectTitle && !nameOnce) return incoming
    const result = { ...(next ?? previous ?? {}) }
    delete result.titleLocked
    if (protectTitle) {
        for (const key of ['name', 'summary'] as const) {
            if (Object.prototype.hasOwnProperty.call(previous, key)) result[key] = previous![key]
            else delete result[key]
        }
    }
    if (locked) {
        result.titleLocked = true
    } else if (nameOnce && metadataHasDurableTitle(result)) {
        // name_once: first durable title sticks. Explicit unlock (titleLocked:false)
        // leaves the padlock open until the next agent/user title write.
        if (!options?.allowTitleUpdate) {
            result.titleLocked = true
        } else if (options?.titleLocked === undefined) {
            result.titleLocked = true
        }
    }
    return result
}
