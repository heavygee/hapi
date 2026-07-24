# Send-on-request bundle (for Cursor)

When Mohit asks for the harness + data, attach exactly these four files. All are
sanitized (fabricated host `hapi.tail7733ee.ts.net`; `tiann`/`oos-linux` are
public). Do **NOT** attach `outside-cursor-results.json` or
`transcripts-redacted.md` — those come from the real-host arms (redacted, but
they reference the live estate more than needed).

| File | What it is |
|------|------------|
| `cursor-doubled-char-receipts.md` | Self-contained write-up: claim, protocol, results table, verbatim transcripts, "where to look" |
| `run-recall-distance.py` | The reproducible distance-recall harness (fabricated host; sessions deleted after scoring) |
| `recall-distance-results.json` | Full per-session transcripts + emission counts (claude + codex) |
| `recall-distance-rollup.json` | Aggregate: faithful vs dropped emissions per flavor |

Staged copy ready to zip: `/tmp/cursor-send-bundle/` (rebuild with the block in
this file's git history if the tmp dir is gone).

Protocol summary to quote if they want it inline: per fresh session, no tools —
(1) seed the three identifiers, ask for `ack`; (2) one unrelated arithmetic turn
(distance); (3) "from memory, don't re-read above" → 4-6 line onboarding note
re-emitting all three; (4) same again as a 3-line bash snippet. Every re-emission
in turns 3-4 scored faithful vs mangled. N=8 per flavor.
