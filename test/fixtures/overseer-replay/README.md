# Overseer replay fixtures

Synthetic captured-event-stream snapshots for the Step 2.75 replay harness
(`hub/src/overseer/replayHarness.ts`). Each file is a `ReplaySnapshot`: sessions
+ events (+ optional event links, baseline inbox items, dispatch envelopes,
worker messages).

**These are synthetic and hand-authored. They are NOT production transcripts.**
The Overseer contracts doc §7 (transcript retention) forbids using real operator
transcripts as fixtures; the replay harness only ever runs against invented
streams shaped to exercise a specific golden scenario.

Golden scenarios are drawn from the prioritization doc §6 table. Time-relative
fixtures (`aging-and-stale.json`) bake a fixed reference epoch into the data; the
test passes that same `now` explicitly so the scenario is deterministic rather
than wall-clock dependent. The reference epoch is `1700000000000`
(2023-11-14T22:13:20Z).
