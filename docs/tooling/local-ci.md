# Local CI for `heavygee/hapi` (oos-linux)

## Why this exists

Around **2026-10-08**, GitHub stopped dispatching Actions for `heavygee/hapi`
(`workflow_dispatch` → HTTP 422 **Actions has been disabled for this repository**).
Repo settings still report `actions/permissions.enabled: true`. Sibling personal
repos (e.g. `heavygee/upvrt`) and **Heavygee-Projects** org repos still run.

That is a **GitHub-controlled disable**, not a YAML bug. Self-hosted runners
cannot pull jobs until dispatch works again — the listener stays idle.

Meanwhile we still need a gate. This estate already has:

| Piece | Location |
|-------|----------|
| Self-hosted runner | `oos-linux-hapi-ci` → `~/actions-runner-hapi` |
| systemd unit | `actions.runner.heavygee-hapi.oos-linux-hapi-ci.service` |
| Labels | `self-hosted`, `Linux`, `X64`, `hapi` |
| Soup redeploy workflow | already `runs-on: [self-hosted, hapi]` |

## Two layers

### 1. Workflows prefer local runners (when Actions wakes up)

`Test` / `fixtures` use owner-conditional `runs-on`:

- `heavygee` → `[self-hosted, Linux, X64, hapi]`
- everyone else (upstream) → `ubuntu-latest`

Windows-hosted `windows-codex-mcp` is skipped on the fork; the same file runs
inside the Linux `test` job.

This avoids GitHub-hosted **minutes** once dispatch works. Public repos stay
free for Actions compute; the disable we hit was still account/repo gated.

### 2. Local CI bridge (works while Actions is dead)

`scripts/tooling/hapi-local-ci.sh` clones each candidate SHA on oos-linux, runs
the Test-equivalent suite, and posts **commit status** context `oos-linux/test`
via the Statuses API (that API still works when Actions dispatch does not).

```bash
# oneshot (main tip only)
hapi-local-ci.sh --once

# main + PRs updated in last 3 days
hapi-local-ci.sh --once --prs

# force tip
hapi-local-ci.sh --sha "$(gh api repos/heavygee/hapi/commits/main --jq .sha)"

# faster smoke
HAPI_LOCAL_CI_SKIP_E2E=1 hapi-local-ci.sh --once
```

Install the user timer (oos-linux) — needs a logged-in user session
(`XDG_RUNTIME_DIR=/run/user/$(id -u)`):

```bash
install -m 755 scripts/tooling/hapi-local-ci.sh ~/.local/bin/hapi-local-ci
mkdir -p ~/.config/systemd/user
cp scripts/tooling/systemd/hapi-local-ci.{service,timer} ~/.config/systemd/user/
systemctl --user daemon-reload
systemctl --user enable --now hapi-local-ci.timer
systemctl --user list-timers hapi-local-ci.timer
```

The unit runs `hapi-local-ci --once --prs` every 5 minutes; successes are
skipped on later ticks.

Logs: `/work/hapi-local-ci/logs/<sha>.log`

## Operator unlock checklist (restore real GHA)

1. Open https://github.com/settings/billing → **Budgets and alerts** — raise or
   clear any Actions stop-budget (personal free plans hard-stop).
2. Open https://github.com/heavygee/hapi/settings/actions — confirm Actions
   enabled (API already says yes; UI may still show GitHub-controlled disable).
3. If still 422 on dispatch: **GitHub Support** (docs call this out explicitly).
4. Optional nuclear: transfer fork to `Heavygee-Projects` (org Actions are
   healthy today) and re-register `oos-linux-hapi-ci` against the new URL —
   high blast radius; do not do from an agent shell without operator TTY.

## Related

- Issue: `heavygee/hapi#243`
- Estate inventory: `~/coding/server-setup/docs/runbooks/github-self-hosted-runners.md`
