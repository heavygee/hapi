# Git commit hooks (fork)

Install once per clone:

```bash
~/coding/hapi/scripts/tooling/install-git-hooks.sh
```

Sets `core.hooksPath` → `scripts/tooling/git-hooks/` (pre-commit, commit-msg, **pre-push**).

Policy source: `scripts/tooling/lib/fork-path-policy.sh` (resolved from **`HAPI_PRIMARY`** mirror when absent in a feature worktree).

## Tiered policy (2026-06-23)

**Goal:** as many **safe** files as possible on public `heavygee/hapi`; never leak fork canon to **`upstream`**. **`docs/plans/`** is pushable to **`origin`** (public fork roadmap).

### GitHub-safe on `origin/main` (push allowed)

- **`docs/tooling/`** — workflow SSOT, intake, driver-soup mechanics, peer-stack, estate migration
- **`docs/plans/`** — peer briefings, integration depth, postmortems (fork public; still blocked on **upstream** PRs)
- **`docs/operator/`** — fork agent canon, layout, operator stubs
- **`.cursor/rules/`** — worktree layout, product-code guard, operator-fork rule
- **`CLAUDE.md`**, **`scripts/tooling/`** — when content-clean (no tailnet hostnames in diff)

### Never tracked / never push

- **`localdocs/`**, **`web/public/xr-poc/`**, **`AGENTS.local.md`**, **`.specstory/`** (SpecStory CLI history; global `~/.config/git/ignore` too)

### Upstream + `origin` PR-bound branches (`feat/*`, `fix/*`, `soup/*`)

- No **`docs/operator/`**, **`docs/plans/`**, **`.cursor/rules/operator*`** in outgoing push

**Infra branches** on `origin` (`main`, `tooling/*`, `docs/*`, `driver/*`, `garden/*`) may carry operator + tooling docs.

### Content scans (all pushes)

- Product code: no `jessica-mood` routes, SOUL references
- **Tailnet hostnames** (operator MagicDNS — see `check-operator-leaks.sh` patterns) — blocked in product diffs; also scanned in **`docs/operator`**, **`docs/tooling`**, **`.cursor/rules`** when pushing to `origin`

## Hook summary

| Layer | Blocks |
|-------|--------|
| **pre-commit** | never-tracked paths; secrets; persona routes in product; tailnet URLs in staged docs |
| **pre-push** | Tiered by **`$1` remote** + branch — see `fork-path-policy.sh` |
| **commit-msg** | `docs/plans/`, SOUL, persona tokens; tailnet URLs |

## Overrides

| Variable | Use |
|----------|-----|
| `HAPI_ALLOW_OPERATOR_LEAK=1` | Emergency — skip tailnet hostname scan |
| `HAPI_SKIP_COMMIT_HOOKS=1` | Emergency — disables all three hooks |

## Public GitHub text (issues / PRs)

Git hooks do **not** run on `gh issue create`. Before filing upstream issues or PRs:

```bash
scripts/tooling/gh-public-body-check.sh /tmp/issue-body.md
gh issue create --body-file /tmp/issue-body.md ...
```

Use generic wording: "operator tailnet hub" — not MagicDNS hostnames.

## Upstream PR branches

Product PRs to `tiann/hapi` must not include fork paths — `git diff --name-only upstream/main...HEAD` should never list `docs/operator/` or `docs/plans/`.
