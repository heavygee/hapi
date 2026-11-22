#!/usr/bin/env bun
/**
 * Tests for presence-audit.
 *
 * The case that matters most is case 2: an identifier the BASE had and one side
 * deliberately DELETED must not be reported as a loss. Getting that wrong is
 * how a tool talks you into re-adding code the fork removed on purpose — it is
 * the exact bug the first version of this check had.
 */
import { auditOne, identifiers } from './presence-audit.mjs'

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

console.log(`presence-audit: ${pass} passed, ${fail} failed`)
process.exit(fail === 0 ? 0 : 1)
