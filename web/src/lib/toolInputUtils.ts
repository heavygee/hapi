// getInputString / getInputStringAny moved to @hapi/protocol so hub + web share
// the same tool-input readers. Re-exported here to keep existing web imports stable.
export { getInputString, getInputStringAny } from '@hapi/protocol'

export function truncate(text: string, maxLen: number): string {
    if (text.length <= maxLen) return text
    return text.slice(0, maxLen - 3) + '...'
}
