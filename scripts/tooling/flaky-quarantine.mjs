#!/usr/bin/env bun
/**
 * flaky-quarantine — tracked quarantine for intermittently-failing tests.
 *
 * GENERIC MECHANISM, FORK-ONLY DATA: see the header of
 * lib/flaky-quarantine-core.mjs — this CLI and that module contain no
 * heavygee/hapi-specific logic and are a candidate for an eventual
 * standalone/upstream extraction. config/flaky-quarantine.yaml (the data) is
 * fork-specific and stays behind.
 *
 * A quarantined test still runs and still reports. This tool never hides a
 * failure — it only decides whether a failure may be excused for gate-pass
 * purposes, based on three rules (see core module for the why):
 *   1. Known id + matching failure signature  -> excused (non-blocking)
 *   2. Known id + DIFFERENT failure signature -> BLOCKS (new/real failure)
 *   3. Expired entry (regardless of signature) -> BLOCKS
 * Plus: more than --ceiling active entries -> the registry itself BLOCKS,
 * independent of whether today's tests pass.
 *
 * Usage:
 *   flaky-quarantine.mjs validate [--registry PATH] [--ceiling N] [--repo OWNER/NAME] [--skip-issue-check]
 *   flaky-quarantine.mjs check --results PATH.json --package PREFIX [--runner-exit-code N] [--registry PATH] [--repo OWNER/NAME] [--skip-issue-check]
 *   flaky-quarantine.mjs from-vitest-json PATH.json           # adapter: vitest --reporter=json -> normalized results
 *   flaky-quarantine.mjs from-xcodebuild-log PATH.log          # adapter: xcodebuild test stdout  -> normalized results
 *
 * `--repo` (default: parsed from the `origin` git remote, falling back to
 * heavygee/hapi) is where issue-open-ness is checked — this tool has no
 * heavygee/hapi-specific logic, so a reused copy elsewhere must not silently
 * keep checking THIS repo's issue numbers.
 * `--runner-exit-code N` (check only) tells the gate decision that the test
 * runner itself exited N. If N is non-zero and --results contains no failed
 * entries at all, that is a runner-level crash (import error, zero tests
 * discovered) with nothing to attribute to a specific test — it BLOCKS
 * unconditionally rather than silently passing because nothing matched.
 *
 * `check` reads normalized results from --results, or from stdin if omitted.
 * `--package PREFIX` (e.g. "cli") restricts BOTH which registry entries are
 * validated (schema/issue-open) AND which are eligible to excuse a failure to
 * ids starting with "PREFIX:". Without it, a schema problem or a closed issue
 * on an entry for a package this invocation never touched (e.g. an `ios:`
 * entry during a cli-only run) would fail the gate for a reason that has
 * nothing to do with what actually ran — exactly the cross-package coupling
 * this flag exists to prevent. The CEILING is deliberately NOT scoped by
 * package (see `validate`, always whole-registry) — it is meant to be felt
 * everywhere once the registry as a whole gets too big, by design.
 * Exit codes:
 *   check:    0 = gate passes. 1 = blocking failure(s), OR a --package-scoped
 *             registry entry is invalid — either way, the gate must stop.
 *   validate: 0 = registry OK. 2 = schema error or over ceiling (distinct
 *             code so a dedicated lint step can tell "registry itself is
 *             broken" apart from "a test failed"). Always whole-registry.
 */
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { parseQuarantineYaml, validateEntries, evaluate, DEFAULT_CEILING } from './lib/flaky-quarantine-core.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(HERE, '..', '..');

const argv = process.argv.slice(2);
const cmd = argv[0];
const flag = (name, fallback) => {
    const i = argv.indexOf(`--${name}`);
    return i >= 0 && argv[i + 1] ? argv[i + 1] : fallback;
};
const has = (name) => argv.includes(`--${name}`);

const registryPath = flag('registry', join(REPO_ROOT, 'config/flaky-quarantine.yaml'));
const ceiling = Number.parseInt(flag('ceiling', String(DEFAULT_CEILING)), 10);
const skipIssueCheck = has('skip-issue-check');

/**
 * Default repo for the issue-open check. Hardcoding heavygee/hapi would make
 * this generic tool silently check the WRONG repo's issue numbers if reused
 * elsewhere (as the module header says it's designed for) or if this repo is
 * ever transferred — derive from the origin remote, falling back to the
 * fork's own slug only when that fails (e.g. no git context at all).
 */
function detectRepo() {
    // `gh repo view`'s default resolution is NOT reliable here: this repo
    // carries multiple remotes (origin=heavygee/hapi, upstream=tiann/hapi,
    // plus contributor forks), and `gh repo view` has been observed to
    // resolve to upstream rather than origin in this exact mirror. Parse
    // `origin` explicitly instead of trusting gh's own default.
    const r = spawnSync('git', ['-C', REPO_ROOT, 'remote', 'get-url', 'origin'], { encoding: 'utf8' });
    if (r.status === 0) {
        const m = r.stdout.trim().match(/[/:]([^/:]+\/[^/.]+?)(\.git)?$/);
        if (m) return m[1];
    }
    return 'heavygee/hapi';
}
const repo = flag('repo', null) ?? detectRepo();

function loadEntries() {
    if (!existsSync(registryPath)) return [];
    return parseQuarantineYaml(readFileSync(registryPath, 'utf8'));
}

function fetchIssueStates(entries) {
    if (skipIssueCheck) return {};
    const nums = [...new Set(entries.map((e) => e.issue).filter((n) => Number.isInteger(n)))];
    const states = {};
    for (const n of nums) {
        const r = spawnSync('gh', ['issue', 'view', String(n), '--repo', repo, '--json', 'state', '--jq', '.state'], { encoding: 'utf8' });
        states[n] = r.status === 0 ? r.stdout.trim() : 'UNKNOWN';
    }
    return states;
}

function printValidation({ errors, expired, valid }) {
    console.log(`flaky-quarantine: ${valid.length} active, ${expired.length} expired, ${errors.length} schema error(s) (registry: ${registryPath})`);
    for (const e of expired) {
        console.log(`  EXPIRED (no longer excuses anything): ${e.id} — issue #${e.issue}, owner ${e.owner}, expired ${e.expires}`);
    }
    for (const err of errors) {
        console.error(`  INVALID [${err.field}] ${err.id}: ${err.message}`);
    }
    for (const e of valid) {
        console.log(`  active: ${e.id} — issue #${e.issue}, owner ${e.owner}, expires ${e.expires}`);
    }
}

function runValidate() {
    const entries = loadEntries();
    const issueStates = fetchIssueStates(entries);
    const result = validateEntries(entries, { issueStates });
    printValidation(result);
    const activeCount = result.valid.length;
    const ceilingExceeded = activeCount > ceiling;
    if (ceilingExceeded) {
        console.error(`flaky-quarantine: CEILING EXCEEDED — ${activeCount} active entries > ceiling ${ceiling}. Clean up before adding more.`);
    }
    const ok = result.errors.length === 0 && !ceilingExceeded;
    console.log(ok ? 'flaky-quarantine: validate OK' : 'flaky-quarantine: validate FAILED');
    process.exit(ok ? 0 : 2);
}

function runCheck() {
    const resultsPath = flag('results', null);
    const raw = resultsPath ? readFileSync(resultsPath, 'utf8') : readFileSync(0, 'utf8');
    const results = JSON.parse(raw);

    const pkg = flag('package', null);
    let entries = loadEntries();
    if (pkg) {
        entries = entries.filter((e) => e.id === pkg || e.id.startsWith(`${pkg}:`));
    } else {
        console.error('flaky-quarantine: WARNING — check running with no --package filter; every registry entry (all packages) participates in this gate\'s pass/fail, including unrelated ones. Pass --package to scope this.');
    }
    const issueStates = fetchIssueStates(entries);
    const { valid, errors, expired } = validateEntries(entries, { issueStates });
    printValidation({ valid, errors, expired });

    const runnerExitCode = Number.parseInt(flag('runner-exit-code', '0'), 10);
    const verdict = evaluate({ validEntries: valid, errors, expired, results, ceiling, runnerExitCode });

    console.log(`flaky-quarantine: ${verdict.excused.length} failure(s) excused, ${verdict.blocking.length} blocking, ${verdict.activeCount}/${verdict.ceiling} active`);
    for (const x of verdict.excused) {
        console.log(`  EXCUSED: ${x.id} (issue #${x.issue}, owner ${x.owner}) — known signature`);
    }
    for (const b of verdict.blocking) {
        console.error(`  BLOCKING: ${b.id} — ${b.reason}`);
        if (b.expectedSignature) {
            console.error(`    expected signature: ${JSON.stringify(b.expectedSignature)}`);
            console.error(`    actual message:     ${JSON.stringify((b.message ?? '').slice(0, 200))}`);
        }
    }
    if (verdict.ceilingExceeded) {
        console.error(`flaky-quarantine: CEILING EXCEEDED — ${verdict.activeCount} active entries > ceiling ${ceiling}. Gate fails until the registry is cleaned up, independent of test results.`);
    }

    process.exit(verdict.pass ? 0 : 1);
}

/** Adapter: vitest `--reporter=json` -> normalized [{id, failed, message}]. */
function fromVitestJson(path, pkgPrefix) {
    const data = JSON.parse(readFileSync(path, 'utf8'));
    const out = [];
    for (const file of data.testResults ?? []) {
        for (const a of file.assertionResults ?? []) {
            out.push({
                id: `${pkgPrefix}:${a.fullName}`,
                failed: a.status === 'failed',
                message: (a.failureMessages ?? []).join('\n'),
            });
        }
    }
    return out;
}

/**
 * Adapter: `xcodebuild test` plain stdout -> normalized results. Parses the
 * `error: -[Module.Class method] : <message>` lines xcodebuild emits for
 * each XCTest failure. Only emits failed entries (xcodebuild's plain stdout
 * does not cleanly enumerate every PASSED test by id the way vitest JSON
 * does) — sufficient for this gate, which only ever needs to classify
 * failures, never passes.
 */
function fromXcodebuildLog(path) {
    const text = readFileSync(path, 'utf8');
    const out = [];
    const re = /error: -\[\S+\.(\w+) (\w+)\] : (.+)$/gm;
    let m;
    while ((m = re.exec(text))) {
        const [, cls, method, message] = m;
        out.push({ id: `ios:${cls}/${method}`, failed: true, message: message.trim() });
    }
    return out;
}

switch (cmd) {
    case 'validate':
        runValidate();
        break;
    case 'check':
        runCheck();
        break;
    case 'from-vitest-json': {
        const results = fromVitestJson(argv[1], flag('package', 'cli'));
        console.log(JSON.stringify(results, null, 2));
        break;
    }
    case 'from-xcodebuild-log': {
        const results = fromXcodebuildLog(argv[1]);
        console.log(JSON.stringify(results, null, 2));
        break;
    }
    default:
        console.error('Usage: flaky-quarantine.mjs <validate|check|from-vitest-json|from-xcodebuild-log> [...]');
        process.exit(2);
}
