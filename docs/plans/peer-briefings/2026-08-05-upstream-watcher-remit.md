# Upstream watcher remit (this session)

**Session role:** daily operator briefing on `tiann/hapi` (+ fork `heavygee/hapi` when relevant).

Operator phrase: **"what's new?"** → run this remit and answer in one short brief.

## Scope (expanded 2026-08-05)

Not just lane-B PR merge hunting. Three lanes:

1. **PR watcher** — open/merged/conflicted PRs, chip health, lane A/B/C eligibility (`low-impact`, auto-B). Still prepare-only for merges unless operator asks; never merge on `tiann/hapi` without policy + chip.
2. **Discussion watcher** — `tiann/hapi` Discussions (Ideas / General / Q&A). Track human replies (especially @tiann, active contributors). Ignore stale Q&A unless newly active.
3. **Notification watcher** — GitHub notifications for `tiann/hapi` and `heavygee/hapi` via `gh api /notifications` (token has `notifications` scope). Prefer human reasons: `comment`, `mention`, `review_requested`, `state_change`, `author`, `subscribed`. Downrank `ci_activity` unless it blocks an owned PR.

## Cadence

- On **"what's new?"** / daily check-in: full sweep since last brief cursor.
- Opportunistic between asks when operator is deep in related work.
- Do **not** mark notifications read (same rule as Meta daily CLI).
- Do **not** replace `hapi-meta-daily` / systemd hourly dance — that owns chip cache + peer pings. This session **briefs the operator**; Meta **actuates chips**.

## Brief format (keep tight)

1. **Headline** — 1–2 sentences: what matters today.
2. **Human signal** — discussions / issue comments from people (not HAPI Bot).
3. **Shipped** — notable merges since last cursor (especially heavygee-authored or A2A/soup-relevant).
4. **Needs you** — decisions, replies, dogfood, promote/label, remat ping to Meta `05d9f0f2`.
5. **Noise parked** — CI flakes, bot-only threads (one line max).

## Tools

```bash
# Notifications (filter in jq)
gh api /notifications -f all=true -f per_page=100

# Discussions
gh api graphql -f query='... repository.discussions ...'

# Merges / events
gh pr list -R tiann/hapi --state merged --limit 40
gh api /repos/tiann/hapi/events?per_page=30

# Lane B (when relevant)
hapi-pr-emoji-batch --repo tiann/hapi <prs>
# policy: scripts/tooling/lib/pr-merge-policy.sh
```

## Out of scope

- Soup rematerialize / stack-switch (Meta tooling `05d9f0f2` / `meta-soup`).
- Issue taxonomy / `low-impact` slap-fest (labelling session `f3c41205` owns daily label sweep; this session may *recommend* promote).
- Marking GitHub notifications read; replying on GitHub unless operator asks.

## Cursor

Last brief: **2026-08-05T08:20Z** (remit adopted + first full brief).
Update this line after each "what's new?" answer.
