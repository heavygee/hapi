import { logger } from "@/ui/logger";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { getProjectPathCandidates } from "./path";

export function claudeCheckSession(sessionId: string, path: string) {
    const tried: string[] = [];
    for (const projectDir of getProjectPathCandidates(path)) {
        const sessionFile = join(projectDir, `${sessionId}.jsonl`);
        tried.push(sessionFile);
        if (!existsSync(sessionFile)) {
            continue;
        }

        const sessionData = readFileSync(sessionFile, 'utf-8').split('\n');
        const hasGoodMessage = !!sessionData.find((v) => {
            try {
                return typeof JSON.parse(v).uuid === 'string'
            } catch {
                return false;
            }
        });
        if (hasGoodMessage) {
            return true;
        }
    }

    logger.debug(`[claudeCheckSession] Path ${tried.join(' | ')} does not exist`);
    return false;
}
