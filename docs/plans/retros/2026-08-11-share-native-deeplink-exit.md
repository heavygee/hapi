# Exit reflection: share-native-deeplink (PR #1413)

> Canon: [`feature-work-lifecycle.md` § Exit reflection](../../tooling/feature-work-lifecycle.md#exit-reflection-gate-a--knowledge-cleanup)

## Shipped as

- PR(s): tiann/hapi#1413 (Fixes #1412); squash `a0621194`
- Absorber (if superseded): n/a
- Session: `2bd956ae-62ec-4ac9-824b-f72ba75b977f` (Peer #1412: share native deeplink)

## Non-code residue

- Estate "locked" query contract (`?url=&text=&title=`) lost to Codex Major + operator correction: fragment wins because hub `logger()` sees the first GET. Companions must ship the hash shape (Quest APK 1.1.33); 1.1.32 query misses ingest.
- StrictMode + scrub-hash is a real footgun: capture fragment in `useState` + memoize `putShareTransfer` on a ref, or remount loses the handoff.
- Soup layer tip drifted (`driver/share-native-deeplink` → `feat/share-native-fileurl`); drop comment must name the **live** `- branch:` line, not only the original union tip.
- Chip said wait-on-tiann while operator promoted `low-impact` — trust the label over stale size-cap action text for lane B.
- Cold VIEW into an already-open PWA may need hard-reload before fragment ingest sticks (headset dogfood note).
- `fileUrl` companion fetch was undogfooded at merge; text/url hash path was headset-proven.

## Promote?

- [x] `lifecycle / tooling doc` — optional one-liner under share / deep-link: "native companions use `/share#…`; query content hits hub access logs"
- [ ] `none` — also fine if Meta prefers no AGENTS churn

(Primary judgment: light doc note only if Meta wants High-signal; otherwise none.)

## Open questions / landmines

- Multi-file native handoff still needs Web Share Target POST (or multiple `fileUrl`s — not shipped).
- Remat wave must rebuild after this DROPPED layer settles with other wave peers — do not mid-wave remat from this session.

## Skip

- n/a (non-trivial contract + StrictMode lessons)
