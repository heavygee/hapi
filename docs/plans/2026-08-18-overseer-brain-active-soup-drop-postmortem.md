# Postmortem: Overseer Set active 404 (soup dropped PUT /brain/active)

> Incident: 2026-08-18 operator on `/overseer` picked OpenAI + `gpt-5.6-luna`, green "74 chat models", then **HTTP 404** on Set active. Not OpenAI. Not the model id. Live `PUT /api/overseer/brain/active` was gone from the hub. Fork issue [heavygee/hapi#133](https://github.com/heavygee/hapi/issues/133) (closed after restore).

## What the operator saw

Web Brain panel (soup-healed) listed profiles and proxied `GET /api/overseer/brains/openai/models` (74 models). Set active called `PUT /api/overseer/brain/active`. Hub returned plain `404 Not Found`. `ApiClient` rendered `HTTP 404 : 404 Not Found`.

Live curl before restore: `GET /brains` 200 with **no `active`**, `PUT /brain/active` 404.

## What actually dropped

The **hub handler**, not the page. Classic split-brain:

| Surface | After 2026-08-04 remat | Why it lived or died |
|---------|------------------------|----------------------|
| `/overseer` route + `OverseerBrainPanel` | Restored | Heal `a786d6a8e` ("restore overseer admin console **web** files") |
| `SettingsStore` / `overseer_settings` DDL / `getSettings()` | Restored | Heal `3d47e56b3` (typecheck after AGY/overseer half-merges) |
| `GET /overseer/brains` + `GET /brains/:id/models` | Survived | Lived on earlier overseer layers still in the manifest |
| `PUT`/`GET /overseer/brain/active` + `resolveBrainSelection()` | **Gone** | Never in a heal. Next remat rebuilt without `feat/overseer-admin-console` |

`GET` models green + `PUT` 404 is the tell: UI and store came back; the write contract did not.

## Timeline (mechanical)

| When (UTC) | What | SHA |
|------------|------|-----|
| 2026-07-31 | Stack `feat/overseer-admin-console` (#103) in **repo** manifest | `92e8b90b1` |
| 2026-08-01..02 | Feature + dogfood tip (runtime brain switch) | `23a0bf94b`, `10e3c265b` |
| 2026-08-03 21:12 | Remat **merged** admin-console + relay-ping + converse-context into soup WIP | `cb82959dc` et al. `PUT` **present** |
| 2026-08-04 09:57 | **Sweep:** "sync manifest drops" aligned **repo** manifest to live `~/.config/hapi/driver-manifest.yaml`. Commit message names merged #897. Diff also **deletes four still-needed layers** | `1d4644037` |
| 2026-08-04 16:16 | Next remat stacks dispositions → replay-harness. Admin-console is not in the recipe. `PUT` **absent** | merge `52cf9f8db` / `9bf99e820` |
| 2026-08-04 16:22 | Heal restores web console files so remat **builds**. Comment admits the thin stack dropped BrainPanel. Does not restore hub `PUT` | `a786d6a8e` |
| 2026-08-04 16:41 | Heal restores store + `getSettings()` for typecheck. Still no `PUT` | `3d47e56b3` |
| 2026-08-18 | Operator 404. Thin restore `driver/overseer-brain-active` @ `498430d3c`; surgical remat; live PUT 200 | issue #133 |

Dropped from the recipe in `1d4644037` (all `- branch:` lines):

- `feat/sse-patch-extend-session-state`
- `feat/overseer-admin-console` (fork PR **#103, still OPEN**)
- `feat/overseer-relay-ping` (fork PR **#104, still OPEN**)
- `feat/overseer-converse-context` (fork PR **#106, still OPEN**)

None of those three overseer PRs ever merged. This was not Gate A after upstream merge. It was a hygiene copy that treated a stale live override as truth.

## Why the soup dropped it (root cause, not the SHA)

Three slices. All required.

### 1. Dual manifest, inverted sync

Canonical rebuild path since 2026-07-05 (`2da857ad9`) is **repo** `config/driver-manifest.yaml` (`hapi-manifest-path.sh`: env → repo → `~/.config` fallback).

Docs and leftover scripts still tell agents to edit **`~/.config/hapi/driver-manifest.yaml`**:

- `docs/tooling/driver-soup.md` soup-rebuild-owner paragraph
- Gate A paste in `docs/operator/AGENTS.md` ("Drop your soup layer(s) from ~/.config/…")
- `scripts/tooling/cursor-rules/hapi-driver-soup-dogfood.mdc`
- `hapi-use-worktree.sh` help, `hapi-sync-fork-main.sh` "Next:", `probe-remat-tip-forward.sh` **defaults to ~/.config**

`#103` was stacked in the **repo** (`92e8b90b1`). Live `~/.config` backups from 2026-07-14 never had `feat/overseer-admin-console`. Live file as of 2026-08-15 still does not. So:

1. Remat from **repo** absorbed the feature (Aug 3).
2. Sweep copied **live → repo** ("align with ~/.config").
3. Repo lost layers live never listed.
4. Next remat from repo rebuilt without them.

Dropping a layer is not a checkout of old soup. The next rematerialize **omits the merge**. Already-absorbed commits are not ancestors of a from-recipe rebuild.

### 2. Commit message lie + open-PR layers

`1d4644037` subject: drop merged #897 + session-open smoke. Body does not name the overseer stack. Reviewing the commit as written would miss a four-layer dogfood deletion.

A layer whose **fork PR is still OPEN** is not a "merged drop." Gate A copy does not apply. There was no issue-state check.

### 3. Partial heal optimized for typecheck, not the contract

`a786d6a8e` / `3d47e56b3` are honest about "web files" / "typecheck after half-merges." Remat went green. `/overseer` rendered. Persist-active was never in the compile graph once the panel called a missing route.

Soup-critical mount check (`createOverseerRoutes(`) passed: the **module** was mounted. The **handler inside the module** was not. That class had no needle until heal `103-restore-overseer-brain-active.patch` + `REQUIRED_HANDLERS_IN_MODULE` (2026-08-18).

## Who (session, not git author)

Git author is always operator identity. Attribution is HAPI session + worktree.

| Actor | Role |
|-------|------|
| Tooling meta-bot `[cursor - tooling/meta bot](/sessions/05d9f0f2-9273-4137-933c-07459a1146a2)` | Remat owner (`config/remat-escalate.yaml`). `1d4644037` is `chore(tooling):` + Co-authored-by Cursor. Owns manifest hygiene / "sync drops." **This is the session to ping.** |
| Same kitchen, later same day | Heals `a786d6a8e` + `3d47e56b3` - compile rescue, not a second independent drop |
| Feature lane #103 / #104 / #106 | Did not delete the layer. Stacked it. Still OPEN |

Not the PR watcher (`9f5f7e1d`). Kitchen, not upstream classify.

## What is restored (2026-08-18)

- Thin layer `driver/overseer-brain-active` @ `498430d3c` (last in repo manifest)
- Heal `scripts/tooling/soup-heals/103-restore-overseer-brain-active.patch`
- Mounts-check needle `app.put('/overseer/brain/active'`
- Surgical remat onto live `driver/integration` (did **not** absorb 108 upstream native-app commits)
- Live verify: `PUT` openai/`gpt-4o` → 200; `GET /brains.active` matches; unknown profile → 400

`~/.config/hapi/driver-manifest.yaml` still **lacks** `driver/overseer-brain-active`. A repeat "align repo to live" would drop it again.

## Kill criteria (estate)

- Manifest drop of a layer whose `heavygee/hapi` PR/issue is **OPEN** → **forbidden** unless the operator names that branch in the same turn.
- "Sync repo ↔ ~/.config" that **deletes** `- branch:` lines without listing them in the commit body → **bug**.
- Soup heal that restores a **web client** for an API the hub no longer serves → **incomplete**. Typecheck green is not the contract.
- `GET /brains/:id/models` 200 + `PUT /brain/active` 404 → **split-brain**, not "OpenAI is down."
- Claiming dogfood green for `/overseer` Set active without curling the PUT → **unverified**.

## Remediation (tooling meta-bot owns 1-4)

1. **Stop inverted sync.** Repo `config/driver-manifest.yaml` is the recipe. `~/.config` is a stale override. Do not copy live → repo in a way that deletes layers. Either delete the override, or make it a generated mirror of repo (one writer).
2. **Fix leftover defaults** that still point at `~/.config`: `probe-remat-tip-forward.sh`, dogfood Cursor rule, `hapi-use-worktree` help, Gate A paste, `driver-soup.md` rebuild-owner line, `hapi-sync-fork-main.sh` "Next:".
3. **Drop gate:** refuse to remove a `- branch:` whose fork PR is OPEN (gh), unless `HAPI_MANIFEST_DROP_OPEN_PR=1` + TTY / named branch.
4. **Handler needles** when a soup-only route grows a dogfood-critical verb (pattern: heal 103). Mount-only checks are not enough.
5. **Do not** re-stack fat `feat/overseer-admin-console` as the soup layer - the thin restore is the dogfood contract. #103/#104/#106 still need a real absorb-or-close decision; that is product, not this 404.

## Not this incident

- OpenAI API / `gpt-5.6-luna` (valid Chat Completions id; models list proved reachability)
- Hub auth (401 vs 404)
- The 108-commit `upstream/main` native-app lag (surgical remat correctly skipped it)
- PR watcher / hourly classify
