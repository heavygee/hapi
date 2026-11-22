#!/usr/bin/env bun
/**
 * Tests for presence-audit.
 *
 * The case that matters most is case 2: an identifier the BASE had and one side
 * deliberately DELETED must not be reported as a loss. Getting that wrong is
 * how a tool talks you into re-adding code the fork removed on purpose — it is
 * the exact bug the first version of this check had.
 */
import { auditOne, auditTrees, identifiers } from './presence-audit.mjs'

let pass = 0, fail = 0
const ok = () => pass++
const bad = (m) => { fail++; console.error(`FAIL: ${m}`) }
const eqArr = (a, e, m) => (JSON.stringify(a) === JSON.stringify(e) ? ok() : bad(`${m}\n  got:      ${JSON.stringify(a)}\n  expected: ${JSON.stringify(e)}`))

// 1. an addition from each side that survived -> clean
{
    const r = auditOne({
        base: 'const shared = 1',
        ours: 'const shared = 1\nconst forkThing = 2',
        theirs: 'const shared = 1\nconst upstreamThing = 3',
        resolved: 'const shared = 1\nconst forkThing = 2\nconst upstreamThing = 3',
    })
    eqArr(r.lostOurs, [], 'no fork loss')
    eqArr(r.lostTheirs, [], 'no upstream loss')
}

// 2. THE REGRESSION CASE. base has `legacyHelper`; ours deleted it; theirs left
//    it alone. Honouring the deletion is correct and must NOT be a finding.
{
    const r = auditOne({
        base: 'const legacyHelper = 1\nconst keep = 2',
        ours: 'const keep = 2',
        theirs: 'const legacyHelper = 1\nconst keep = 2',
        resolved: 'const keep = 2',
    })
    eqArr(r.lostTheirs, [], 'a deliberate deletion by ours is not an upstream loss')
    eqArr(r.lostOurs, [], 'and not a fork loss either')
}

// 3. a genuine loss of an upstream addition is reported
{
    const r = auditOne({
        base: 'const shared = 1',
        ours: 'const shared = 1',
        theirs: 'const shared = 1\nconst upstreamFeature = 3',
        resolved: 'const shared = 1',
    })
    eqArr(r.lostTheirs, ['upstreamFeature'], 'upstream addition dropped must be reported')
}

// 4. a genuine loss of a fork addition is reported
{
    const r = auditOne({
        base: 'const shared = 1',
        ours: 'const shared = 1\nconst forkFeature = 2',
        theirs: 'const shared = 1',
        resolved: 'const shared = 1',
    })
    eqArr(r.lostOurs, ['forkFeature'], 'fork addition dropped must be reported')
}

// 5. comment-only mentions do not create additions. A comment naming a helper
//    it is deleting is the dominant false positive.
{
    const r = auditOne({
        base: 'const shared = 1',
        ours: 'const shared = 1\n// removed oldPingPeerOptions here\n/* also goneSymbol */',
        theirs: 'const shared = 1',
        resolved: 'const shared = 1',
    })
    eqArr(r.lostOurs, [], 'identifiers only ever in comments are not additions')
}

// 6. string-literal identifiers DO count — a tool name dropped from an
//    advertised list is exactly the loss this exists to catch.
{
    const r = auditOne({
        base: "tools = []",
        ours: "tools = ['search_content']",
        theirs: 'tools = []',
        resolved: 'tools = []',
    })
    eqArr(r.lostOurs, ['search_content'], 'a quoted tool name is a real addition')
}

// 7. JSX element and attribute names count (a lost render is invisible to a
//    symbol diff). Hyphenated attributes split on the hyphen, so `data-testid`
//    contributes `data` and `testid` too — harmless noise, because both occur
//    in essentially every file and so can never read as absent.
{
    const r = auditOne({
        base: '<div />',
        ours: '<div><PasskeySettings data-testid="passkeys" /></div>',
        theirs: '<div />',
        resolved: '<div />',
    })
    eqArr(r.lostOurs, ['PasskeySettings', 'data', 'passkeys', 'testid'].sort(), 'JSX section loss is reported')
}

// 8. hex-looking tokens are dropped (UUID halves in fixtures were a real
//    false positive in the sentinel sweep)
{
    const got = identifiers("const id = 'c88c8925'\nconst eb72fcacc7c8 = 1")
    eqArr([...got].filter(x => /^[0-9a-f]+$/.test(x)), [], 'hex-ish tokens filtered')
}

// 9. keywords are not identifiers
{
    const got = identifiers('export const value = function () { return undefined }')
    eqArr([...got].sort(), ['value'], 'only real names survive')
}

// 10. an addition that moved to a DIFFERENT file still reads as absent here.
//     That is correct: the audit is per-file and the operator must confirm the
//     move. Documented so the message is not mistaken for a bug.
{
    const r = auditOne({
        base: 'const a = 1',
        ours: 'const a = 1\nconst movedAway = 2',
        theirs: 'const a = 1',
        resolved: 'const a = 1',
    })
    eqArr(r.lostOurs, ['movedAway'], 'a relocated addition is still flagged for review')
}

// 11. block-comment CONTINUATION lines contribute nothing, even when they do
//     not start with `*`. This was 20 of 35 findings in a real audit.
{
    const got = identifiers([
        '/**',
        ' * The badge carries which state on inspection; the row-level',
        '   residency fade carries which rows at a glance, without a heartbeat',
        '   signal being drawn twice.',
        ' */',
        'const realCode = 1',
    ].join('\n'))
    eqArr([...got].sort(), ['realCode'], 'wrapped doc-comment prose is not code')
}

// 12. an inline block comment does not hide the code around it
{
    const got = identifiers('const before = 1 /* noiseWord */ + after')
    eqArr([...got].sort(), ['after', 'before'], 'code either side of an inline comment survives')
}

// 13. a trailing line comment does not hide the code before it
{
    const got = identifiers('const keepThis = 1 // dropThisWord')
    eqArr([...got].sort(), ['keepThis'], 'trailing line comment stripped')
}

// 14. code on the same line as a block-comment close is not lost
{
    const got = identifiers(['/* opener', 'middleNoise', '*/ const tailCode = 1'].join('\n'))
    eqArr([...got].sort(), ['tailCode'], 'code after a block close is kept')
}

// 15. a `*/` inside a string must not be mistaken for a comment close. Keep
//     the behaviour pinned: whatever it does, it must not throw or swallow
//     the rest of the file.
{
    const got = identifiers(['const pattern = "*/"', 'const afterPattern = 2'].join('\n'))
    eqArr([...got].includes('afterPattern'), true, 'parsing continues past a string containing */')
}

// --- auditTrees: file-level losses ---------------------------------------
const S = (...xs) => new Set(xs)

// 16. THE CASE THAT DEFEATED THE FIRST PROBE. A file in the BASE that one side
//     deleted and the other kept, absent from the resolution. `side - base`
//     and `fork & theirs` both miss it; this is how 53 real files hid.
{
    const r = auditTrees({
        base: S('a.ts', 'kept.ts'),
        fork: S('a.ts', 'kept.ts'),      // fork kept it
        theirs: S('kept.ts'),            // theirs deleted it
        resolved: S('kept.ts'),          // and it is not here
    })
    eqArr(r.absent, ['a.ts'], 'a base file kept by one side must be reported absent')
    eqArr(r.classes.theirsDeleted, ['a.ts'], 'classified as theirs-deleted, not as a definite loss')
    eqArr(r.definite, [], 'ambiguous class is NOT a definite loss')
}

// 17. the mirror case: base file the fork deleted and theirs kept
{
    const r = auditTrees({
        base: S('b.ts'), fork: S(), theirs: S('b.ts'), resolved: S(),
    })
    eqArr(r.classes.forkDeleted, ['b.ts'], 'classified as fork-deleted')
}

// 18. an addition by either side that is absent IS a definite loss
{
    const r = auditTrees({
        base: S(), fork: S('f.ts'), theirs: S('t.ts'), resolved: S(),
    })
    eqArr(r.classes.forkAdded, ['f.ts'], 'fork addition')
    eqArr(r.classes.theirsAdded, ['t.ts'], 'theirs addition')
    eqArr(r.definite, ['f.ts', 't.ts'], 'both are definite losses')
}

// 19. a file BOTH sides kept, absent here, is a definite loss
{
    const r = auditTrees({
        base: S('c.ts'), fork: S('c.ts'), theirs: S('c.ts'), resolved: S(),
    })
    eqArr(r.classes.keptByBoth, ['c.ts'], 'kept by both')
    eqArr(r.definite, ['c.ts'], 'nobody deleted it, so it is a loss')
}

// 20. nothing absent -> nothing reported
{
    const r = auditTrees({
        base: S('a.ts'), fork: S('a.ts'), theirs: S('a.ts'), resolved: S('a.ts'),
    })
    eqArr(r.absent, [], 'clean tree reports nothing')
    eqArr(r.orphanTests, [], 'and no orphan tests')
}

// 21. ORPHANED TEST: the test is gone, its implementation still ships. Never
//     ambiguous, and invisible to the compiler, the test run and the gate.
{
    const r = auditTrees({
        base: S('x.ts', 'x.test.ts'),
        fork: S('x.ts', 'x.test.ts'),
        theirs: S('x.ts'),
        resolved: S('x.ts'),
    })
    eqArr(r.orphanTests.map(o => o.test), ['x.test.ts'], 'orphaned test is reported')
    eqArr(r.orphanTests[0].impl, 'x.ts', 'and names the implementation that still ships')
    eqArr(r.orphanTests[0].side, 'fork', 'and which side had it')
}

// 22. a test whose implementation is ALSO gone is not an "orphan" — the whole
//     feature left, which the classes above already cover.
{
    const r = auditTrees({
        base: S('y.ts', 'y.test.ts'), fork: S('y.ts', 'y.test.ts'), theirs: S(), resolved: S(),
    })
    eqArr(r.orphanTests, [], 'not an orphan when the subject is gone too')
}

// 23. .test.tsx is recognised, and matched against a .tsx implementation
{
    const r = auditTrees({
        base: S('C.tsx', 'C.test.tsx'), fork: S('C.tsx', 'C.test.tsx'),
        theirs: S('C.tsx'), resolved: S('C.tsx'),
    })
    eqArr(r.orphanTests.map(o => o.test), ['C.test.tsx'], 'tsx test orphan detected')
}


// 24. A LINE COMMENT MENTIONING `/*` MUST NOT OPEN A BLOCK. This was a real
//     false negative: `// ... `/sessions/*` ...` in web/src/router.tsx set the
//     block flag and swallowed the remaining 338 lines, so createAppRouter and
//     normalizeRouterBasepath read as LOST and every genuine loss below that
//     line was invisible.
{
    const got = identifiers([
        'const before = 1',
        '// survives regardless of which `/sessions/*` child is actually matched',
        'const afterTheMention = 2',
        'function stillVisible() {}',
    ].join('\n'))
    eqArr(got.has('afterTheMention'), true, 'code after the mention is still read')
    eqArr(got.has('stillVisible'), true, 'and so is everything further down')
    eqArr(got.has('before'), true, 'and the line before it')
}

// 25. A genuine block opener on a line still opens a block.
{
    const got = identifiers([
        'const visible = 1 /* opener',
        'swallowedWord',
        '*/ const tailCode = 2',
    ].join('\n'))
    eqArr(got.has('visible'), true, 'code before the opener survives')
    eqArr(got.has('swallowedWord'), false, 'the comment body is excluded')
    eqArr(got.has('tailCode'), true, 'code after the close survives')
}

// 26. `//` inside a block comment does not end the block early (which would
//     strip the `*/` and leak the block state onward).
{
    const got = identifiers([
        '/* opener with a // inside it',
        'commentBody',
        '*/',
        'const afterBlock = 1',
    ].join('\n'))
    eqArr(got.has('commentBody'), false, 'body still excluded')
    eqArr(got.has('afterBlock'), true, 'block closed properly')
}

// 27. A URL in a string is not a line comment — `://` must not truncate.
{
    const got = identifiers("const url = 'https://example.com/x' + trailingIdent")
    eqArr(got.has('trailingIdent'), true, 'identifiers after a URL survive')
}

// 28. A real line comment AFTER a URL on the same line still works.
{
    const got = identifiers("const endpointUrl = 'https://x' // droppedWord")
    eqArr(got.has('droppedWord'), false, 'the real line comment is still stripped')
    eqArr(got.has('endpointUrl'), true, 'and the code before it is kept')
}

console.log(`presence-audit: ${pass} passed, ${fail} failed`)
process.exit(fail === 0 ? 0 : 1)
