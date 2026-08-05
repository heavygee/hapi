import type { SessionSummary } from '@/types/api'

/** Platonic / primitive solid chosen for VR legibility (Tron-ish state glyph). */
export type OrbShapeKind =
    | 'sphere'
    | 'cube'
    | 'octahedron'
    | 'tetrahedron'
    | 'icosahedron'

/**
 * Shape priority: permission (cube) > attention (octahedron) > thinking > live > idle.
 */
export function resolveOrbShapeKind(session: SessionSummary, attention: boolean): OrbShapeKind {
    if (session.pendingRequestKinds.length > 0) {
        return 'cube'
    }
    if (attention) {
        return 'octahedron'
    }
    if (session.thinking) {
        return 'icosahedron'
    }
    if (session.active) {
        return 'sphere'
    }
    return 'tetrahedron'
}

export function orbShapeLabel(kind: OrbShapeKind): string {
    switch (kind) {
        case 'cube':
            return 'awaiting decision'
        case 'octahedron':
            return 'unseen / needs you'
        case 'icosahedron':
            return 'working'
        case 'sphere':
            return 'live'
        case 'tetrahedron':
            return 'idle'
    }
}
