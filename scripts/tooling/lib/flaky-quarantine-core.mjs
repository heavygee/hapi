/**
 * Flaky-test quarantine — pure decision core (no I/O, no network, no fs).
 *
 * GENERIC MECHANISM, FORK-ONLY DATA: this module and its CLI wrapper
 * (../flaky-quarantine.mjs) contain no heavygee/hapi-specific logic — any repo
 * with CI could use them unchanged. The data that gives them meaning
 * (config/flaky-quarantine.yaml: which tests, which issues, which owners) is
 * fork-specific. Keep that split when touching this file: if a change only
 * makes sense because of something about THIS repo, it belongs in the YAML or
 * the caller, not here. This is the shape an eventual standalone/upstream
 * extraction would take with the YAML left behind.
 *
 * Design (see heavygee/hapi issue thread for #273 / #274, the two seed
 * entries, and the review that shaped these rules):
 *
 *   - A quarantined test still runs and still reports. This module never
 *     hides a failure; it only decides whether a failure may be ignored for
 *     gate-pass purposes.
 *   - Signature match -> excused (non-blocking). Signature MISMATCH -> BLOCKS.
 *     Id-matching alone cannot tell "the same old flake" from "a new bug that
 *     landed in the same test" — comparing the failure text closes most of
 *     that gap. A warning nobody must act on trains people to ignore red, so
 *     a mismatch blocks rather than merely warns.
 *   - An expired entry excuses nothing. It is not a grace period; it is the
 *     entry falling out of the active set, so the next failure under that id
 *     is treated as an ordinary (blocking) failure until someone renews (with
 *     a reason) or removes it.
 *   - A ceiling on the number of ACTIVE (valid, non-expired) entries is a
 *     forcing function, not a decoration: once active count exceeds it, the
 *     gate fails regardless of whether today's tests pass, until someone
 *     cleans the registry up.
 */

/** Default max days an entry excuses anything before it must be renewed or removed. */
export const DEFAULT_EXPIRY_DAYS = 14;

/** Default ceiling on ACTIVE entries before the registry itself is the failure. */
export const DEFAULT_CEILING = 8;

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function parseDate(s, field, errors, id) {
    if (typeof s !== 'string' || !DATE_RE.test(s)) {
        errors.push({ id, field, message: `${field} must be an ISO date (YYYY-MM-DD), got ${JSON.stringify(s)}` });
        return null;
    }
    const d = new Date(`${s}T00:00:00Z`);
    if (Number.isNaN(d.getTime())) {
        errors.push({ id, field, message: `${field} is not a valid calendar date: ${s}` });
        return null;
    }
    return d;
}

function daysBetween(a, b) {
    return Math.round((b.getTime() - a.getTime()) / 86_400_000);
}

/**
 * Minimal block-scalar-unaware YAML read for the flat `quarantine:` list —
 * deliberately hand-rolled rather than pulling a parser dependency, matching
 * the house style in hapi-soup-excised-check.mjs / config/soup-excised.yaml.
 * Every field is a plain scalar on its own line; no nested lists except the
 * `quarantine:` top-level one.
 */
export function parseQuarantineYaml(text) {
    const entries = [];
    let current = null;
    for (const raw of text.split('\n')) {
        const line = raw.replace(/\s+$/, '');
        if (/^\s*#/.test(line) || !line.trim()) continue;
        const start = line.match(/^\s*-\s+id:\s*(.+)$/);
        if (start) {
            if (current) entries.push(current);
            current = { id: stripQuotes(start[1]), owner: null, issue: null, signature: null, added: null, expires: null, renewal_count: 0, renewal_reason: null };
            continue;
        }
        if (!current) continue;
        const kv = line.match(/^\s+(owner|issue|signature|added|expires|renewal_count|renewal_reason):\s*(.*)$/);
        if (!kv) continue;
        const [, key, rawVal] = kv;
        const val = stripQuotes(rawVal.trim());
        if (key === 'issue' || key === 'renewal_count') {
            current[key] = Number.parseInt(val, 10);
        } else {
            current[key] = val;
        }
    }
    if (current) entries.push(current);
    return entries;
}

function stripQuotes(s) {
    const t = s.trim();
    if (t.startsWith('"') && t.endsWith('"') && t.length >= 2) {
        // YAML double-quoted scalars support backslash escapes — a signature
        // that legitimately contains an embedded quoted type name (e.g.
        // `expected non-nil value of type "UICollectionView"`) is written as
        // \" in the file. Un-escaping \\ before \" matters so "\\\"" round-trips.
        return t.slice(1, -1).replace(/\\\\/g, '\\').replace(/\\"/g, '"');
    }
    if (t.startsWith("'") && t.endsWith("'") && t.length >= 2) {
        return t.slice(1, -1).replace(/''/g, "'");
    }
    return t;
}

/**
 * Schema + lifecycle validation. Pure and synchronous — issue-open-ness is
 * NOT checked here (that needs a network call); pass `issueStates` (a map of
 * issue number -> 'OPEN' | 'CLOSED') when the caller has fetched it, or omit
 * to skip that one check (used by unit tests that must stay network-free).
 *
 * Returns { valid, errors, expired } where `valid` is entries that are
 * schema-correct, issue-open (if checked), and NOT expired as of `today`.
 * Schema-invalid or closed-issue entries are dropped from `valid` and fail
 * closed (treated as if no quarantine exists for that id) rather than being
 * silently kept — see module doc.
 */
export function validateEntries(entries, { today, issueStates } = {}) {
    const now = today ?? new Date();
    const errors = [];
    const valid = [];
    const expired = [];

    for (const e of entries) {
        const localErrors = [];
        if (!e.id) localErrors.push({ id: e.id ?? '(no id)', field: 'id', message: 'id is required' });
        if (!e.owner) localErrors.push({ id: e.id, field: 'owner', message: 'owner is required — no anonymous quarantine entries' });
        if (!Number.isInteger(e.issue) || e.issue <= 0) {
            localErrors.push({ id: e.id, field: 'issue', message: 'issue must be a positive GitHub issue number' });
        }
        if (!e.signature) {
            localErrors.push({ id: e.id, field: 'signature', message: 'signature is required — "failed once" with no captured failure text is not sufficient evidence' });
        }
        const added = parseDate(e.added, 'added', localErrors, e.id);
        const expires = parseDate(e.expires, 'expires', localErrors, e.id);
        const renewalCount = Number.isInteger(e.renewal_count) ? e.renewal_count : 0;
        if (renewalCount > 0 && !e.renewal_reason) {
            localErrors.push({ id: e.id, field: 'renewal_reason', message: 'renewal_count > 0 requires a renewal_reason — renewal is a deliberate act with a reason attached, not a bumped date' });
        }
        if (added && expires) {
            const maxAllowedDays = DEFAULT_EXPIRY_DAYS + DEFAULT_EXPIRY_DAYS * renewalCount;
            const actualDays = daysBetween(added, expires);
            if (actualDays > maxAllowedDays) {
                localErrors.push({
                    id: e.id,
                    field: 'expires',
                    message: `expires is ${actualDays}d after added, but renewal_count=${renewalCount} only allows ${maxAllowedDays}d — bump renewal_count and add a renewal_reason to extend further`,
                });
            }
            if (actualDays <= 0) {
                localErrors.push({ id: e.id, field: 'expires', message: 'expires must be after added' });
            }
        }
        if (issueStates && Number.isInteger(e.issue) && issueStates[e.issue] && issueStates[e.issue] !== 'OPEN') {
            localErrors.push({
                id: e.id,
                field: 'issue',
                message: `issue #${e.issue} is ${issueStates[e.issue]}, not OPEN — a quarantined test whose issue is closed is either fixed or abandoned; remove the entry`,
            });
        }

        if (localErrors.length > 0) {
            errors.push(...localErrors);
            continue;
        }

        if (expires && daysBetween(expires, now) >= 0 && now.getTime() > expires.getTime()) {
            expired.push(e);
            continue;
        }

        valid.push(e);
    }

    return { valid, errors, expired };
}

/**
 * The actual gate decision. `results` is runner-agnostic:
 *   [{ id: string, failed: boolean, message: string }]
 * `validEntries` must already be schema-valid and non-expired (the output of
 * validateEntries().valid) — this function does not re-check lifecycle.
 */
export function evaluate({ validEntries, errors = [], expired = [], results, ceiling = DEFAULT_CEILING }) {
    const byId = new Map(validEntries.map((e) => [e.id, e]));
    const blocking = [];
    const excused = [];

    for (const r of results) {
        if (!r.failed) continue;
        const entry = byId.get(r.id);
        if (!entry) {
            blocking.push({ id: r.id, reason: 'not quarantined', message: r.message });
            continue;
        }
        const matches = typeof r.message === 'string' && r.message.includes(entry.signature);
        if (matches) {
            excused.push({ id: r.id, issue: entry.issue, owner: entry.owner });
        } else {
            blocking.push({
                id: r.id,
                reason: 'quarantined signature mismatch — treated as a new failure',
                message: r.message,
                expectedSignature: entry.signature,
            });
        }
    }

    const activeCount = validEntries.length;
    const ceilingExceeded = activeCount > ceiling;

    return {
        blocking,
        excused,
        activeCount,
        ceiling,
        ceilingExceeded,
        schemaErrors: errors,
        expiredEntries: expired,
        pass: blocking.length === 0 && errors.length === 0 && !ceilingExceeded,
    };
}
