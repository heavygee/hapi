import { FileTouchAccumulator, type FileActivity, type FileTouch } from '@hapi/protocol'
import type { ChatBlock } from '@/chat/types'

export type { FileTouch, FileActivity }

export type FileAttention = {
    touches: FileTouch[]
    activity: FileActivity
}

/**
 * Walks the normalized ChatBlock tree (including subagent children) and returns
 * path-ranked file touches plus an activity summary (including Cursor ACP
 * pathless Read File / Edit File counts).
 */
export function collectFileAttention(blocks: ChatBlock[]): FileAttention {
    const acc = new FileTouchAccumulator()
    const walk = (bs: ChatBlock[]) => {
        for (const b of bs) {
            if (b.kind !== 'tool-call') continue
            acc.add(b.tool.name, b.tool.input, b.tool.result)
            if (b.children.length) walk(b.children)
        }
    }
    walk(blocks)
    return { touches: acc.result(), activity: acc.activitySummary() }
}

/** @deprecated Prefer collectFileAttention — kept for call-site compatibility. */
export function collectFileTouches(blocks: ChatBlock[]): FileTouch[] {
    return collectFileAttention(blocks).touches
}
