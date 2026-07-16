import { FileTouchAccumulator, type FileTouch } from '@hapi/protocol'
import type { ChatBlock } from '@/chat/types'

export type { FileTouch }

/**
 * Walks the normalized ChatBlock tree (including subagent children) and returns
 * the files this session touched, ranked by activity. The classification of
 * "what is a file touch" lives in @hapi/protocol so the hub and future XR
 * surfaces derive the same aggregates from their own traversals.
 */
export function collectFileTouches(blocks: ChatBlock[]): FileTouch[] {
    const acc = new FileTouchAccumulator()
    const walk = (bs: ChatBlock[]) => {
        for (const b of bs) {
            if (b.kind !== 'tool-call') continue
            acc.add(b.tool.name, b.tool.input)
            if (b.children.length) walk(b.children)
        }
    }
    walk(blocks)
    return acc.result()
}
