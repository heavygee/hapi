import { describe, expect, it } from 'vitest'
import {
    FAN_MIN_CENTER_DIST_PX,
    FAN_PLATE_PX,
    FAN_RADIUS_PX,
    FAN_SAT_PX,
    FAN_TOOLS,
    fanSatTranslates,
    satCenterDistance
} from './operator-dock-fan-geometry'

describe('operator dock fan geometry (host overlay for hapi-inline#112)', () => {
    it('places four sats on a 90-180 even arc with room to spare', () => {
        const t = fanSatTranslates()
        expect(FAN_TOOLS).toEqual(['sessions', 'markup', 'mic', 'settings'])
        expect(t.sessions).toEqual({ x: 0, y: -FAN_RADIUS_PX })
        expect(t.settings).toEqual({ x: -FAN_RADIUS_PX, y: 0 })
        expect(FAN_PLATE_PX).toBeGreaterThanOrEqual(FAN_RADIUS_PX + 28 + FAN_SAT_PX / 2 + 8)
    })

    it('keeps every sat pair at least sat diameter + 10px apart', () => {
        const t = fanSatTranslates()
        for (let i = 0; i < FAN_TOOLS.length; i++) {
            for (let j = i + 1; j < FAN_TOOLS.length; j++) {
                const a = FAN_TOOLS[i]
                const b = FAN_TOOLS[j]
                expect(satCenterDistance(t[a], t[b]), `${a}↔${b}`).toBeGreaterThanOrEqual(
                    FAN_MIN_CENTER_DIST_PX
                )
            }
        }
    })

    it('documents why v0.10.1 CSS was wrong (settings/mic + markup/mic overlap)', () => {
        const v0101 = {
            settings: { x: -72, y: 4 },
            markup: { x: -64, y: -56 },
            sessions: { x: -12, y: -78 },
            mic: { x: -78, y: -20 }
        }
        expect(satCenterDistance(v0101.settings, v0101.mic)).toBeLessThan(FAN_SAT_PX)
        expect(satCenterDistance(v0101.markup, v0101.mic)).toBeLessThan(FAN_SAT_PX)
    })
})
