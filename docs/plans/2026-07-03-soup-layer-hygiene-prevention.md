# Soup layer hygiene — postmortem + prevention proposal

**Date:** 2026-07-03  
**Trigger:** `hapi-driver-rebuild` failures + Bun crash from conflict markers during Cursor ACP remote resume (#991) soup promotion  
**Audience:** operator, tooling bot (implementation owner), feature peers  
**Related:** [`driver-soup.md`](../tooling/driver-soup.md) § stale merge-tips, [`2026-06-28-mermaid-soup-stale-dist-postmortem.md`](peer-briefings/2026-06-28-mermaid-soup-stale-dist-postmortem.md)

---

## Executive summary

Peer #991 **partially unskunked** the driver tree on proxmox. The git merge stack is clean again, but **web/dist is stale**, **oos-linux hub is not verified on the fix**, and **no mechanical gate** stops the next fat merge-tip from landing in the manifest. This doc lists what was fixed, what remains, and a concrete tooling proposal.

---

## What was unskunked (2026-07-03, Peer #991)

| Item | Before | After |
|------|--------|-------|
| `driver/integration` | Mid-merge, conflict markers in `cursorAcpRemoteLauncher.ts`, Bun crash | Clean @ `62c2f47d`, no conflict markers |
| `fix/soup-markdown-renderer-types` | In manifest, **0 commits** vs upstream (pure stale tip) | **Dropped** from manifest |
| `feat/cursor-model-error-bridge` | **12-commit fat tip** duplicating detect-layer work | **Thinned** to 5 cherry-picks on `feat/cursor-detect-inline-model-errors` |
| `fix/runner-agent-context` | Merge-tip risk | **Thinned** to 1 commit (`a0a19a3e`) |
| Layer 28 (`fix/cursor-acp-remote-resume-ready`) | Blocked on `rpcGateway` / `machines.ts` conflicts | Merged; **rerere** recorded for replay |
| Proxmox hub (`:3006`, driver stack) | Old resume spawn-then-merge | **`hapi-restart-hub`** with fix live |
| Emergency `git checkout --ours` | Unresolved driver damage | Superseded by proper merge + commit |

---

## What is NOT unskunked yet

**Blocking or high-risk**

- **`web/dist` stale** — `hapi-verify-web-dist` FAIL (4 codex new-session copy keys + head mismatch). Rebuild aborted on memory pressure (swap 100%, ~2 GiB MemAvailable). UI may not reflect merged soup layers.
- **oos-linux tailnet hub** — #991 repro topology is `hapi-hub-oos` on `.79` + proxmox runner. Only proxmox `:3006` got restart. **Web Resume on tailnet is unverified** until oos-linux runs driver `@62c2f47d` or later.
- **Tailnet dogfood** — operator has not confirmed web Resume on a previously failing inactive ACP session.

**Hygiene / debt**

- **Orphan branch** `fix/soup-markdown-renderer-types` + worktree `soup-markdown-ts` still exist (branch = upstream tip, no purpose).
- **Manifest comment drift** — footer still says model-error hub path "lives in fix/soup-markdown-renderer-types" (layer dropped 2026-07-03).
- **No automated layer audit** — nothing rejects fat merge-tips before `hapi-driver-rebuild`.
- **Peer postmortems not filed** — session `902b7f8a` (model-error-bridge) has no peer briefing like mermaid `5ffdc413`.

**Operator process (unchanged until tooling lands)**

- Revive inactive ACP sessions **one at a time** on memory-tight proxmox.
- `hapi-safe-revive-session` remains canonical until tailnet Resume is verified.

---

## Who skunked it (for operator bollocking)

| Actor | Session / worktree | Violation |
|-------|-------------------|-----------|
| **model-error-bridge peer** | HAPI `902b7f8a`, worktree `model-error-bridge` | Fat merge-tip branch (~12 commits duplicating detect layer); driver merge `f5be1057` Co-authored-by Cursor |
| **markdown-renderer layer** | worktree `soup-markdown-ts` | Stale layer (0 delta vs upstream); wrong cherry-picks in June; never dropped when superseded |
| **Recovery CursorRemote** | HAPI `8dda7bbc` | Emergency `checkout --ours` on driver (secondary damage, not root cause) |
| **Historical reference** | HAPI `5ffdc413` (mermaid) | merge-only rebuild, `git merge` in driver/, ignored verify |

Git commit author is always operator identity — use **HAPI session ID + worktree** for attribution.

---

## Prevention proposal (for tooling bot)

Goal: **fail closed before** `hapi-driver-rebuild` mutates `driver/integration`, not after Bun crashes or rebuild fights the same files for the Nth time.

### Tier A — `check-soup-layer-hygiene.sh` (pre-rebuild gate)

**Invoke from:** `hapi-driver-rebuild.sh` after manifest parse, **before** `git checkout -B driver/integration`.

**Per manifest layer** (in order), given `PRIMARY` clone and parsed `{type, ref}`:

1. **Resolve ref** — same logic as rebuild (`branch` / `integrate` / `pr`).
2. **Zero-delta guard** — if `git rev-list --count upstream/main..$ref` = 0 → **FAIL** with message: "layer `$ref` has no commits beyond upstream/main; drop from manifest or refresh branch."
3. **Fat-tip guard** — if count > `HAPI_SOUP_LAYER_MAX_COMMITS` (default **8**) → **FAIL** unless `HAPI_SOUP_LAYER_OVERRIDE=1` in operator TTY (same gate pattern as systemctl override).
4. **Duplicate-work guard** — for layer index `i > 0`, let `prev` = resolved ref of layer `i-1`. If any commit in `prev..$ref` is already reachable from `upstream/main..prev` → **WARN** (default) or **FAIL** with `--strict`.
5. **Merge-commit guard** — if tip is a merge commit with two parents neither of which is `prev` → **FAIL**: "integration merge-tip; reset branch to prev + cherry-pick feature SHAs."
6. **Conflict-marker guard** — if branch tree contains `^<<<<<<< ` → **FAIL** (scan changed files vs upstream/main).

**Output:** one line per layer: `OK layer 27/28 feat/cursor-model-error-bridge (+5 vs prev, +5 vs upstream)` or `FAIL layer 24/28 ...`.

**Exit:** 0 all OK; 1 any FAIL; 2 WARN-only (when not `--strict`).

### Tier B — manifest edit discipline

**Script:** `hapi-manifest-add-layer.sh <branch> [--after <layer-ref>]`

- Runs Tier A checks against **proposed** layer list before writing YAML.
- Requires `--worktree` path or `--session` HAPI id comment block (template from `new-feature-intake.md` §0).
- Refuses `--after` if dependency order would violate duplicate-work guard.

**Policy:** agents must use this script; raw manifest YAML edits get a pre-rebuild warning pointing at the script.

### Tier C — rebuild hardening (extend existing scripts)

1. **`hapi-driver-rebuild.sh`** — after all layers merge, if `BUILD_WEB=0` and verify script exists → already fails on stale dist; **add:** if hygiene check was skipped (`HAPI_SKIP_SOUP_HYGIENE=1`) print banner.
2. **Post-merge marker scan** — after each layer merge in rebuild loop, `git grep '^<<<<<<< '` in driver → abort immediately (before next layer compounds damage).
3. **`hapi-driver-rebuild` agent guard** — already requires `--build-web` from agent shells; **extend message** to cite hygiene failures and link this doc.

### Tier D — multi-hub deploy checklist (operator doc snippet)

When soup changes hub/cli behavior (e.g. #991):

- [ ] `hapi-driver-rebuild --build-web --verify` green on proxmox
- [ ] `hapi-restart-hub` on proxmox `:3006`
- [ ] **If tailnet hub separate:** deploy same driver SHA to oos-linux + restart `hapi-hub-oos`
- [ ] Record deployed SHA in #991 / peer briefing before declaring "ready for remote dogfood"

Add to [`feature-work-lifecycle.md`](../tooling/feature-work-lifecycle.md) soup promotion section (tooling bot).

### Tier E — peer accountability template

When hygiene gate FAILs, tooling prints:

```
BLOCKED: layer feat/foo is a merge-tip (+47 vs upstream).
Owner: check manifest comment for HAPI session / worktree.
Fix: cd worktrees/foo && git reset --hard <dependency-layer> && git cherry-pick <shas>
Doc: docs/plans/2026-07-03-soup-layer-hygiene-prevention.md
```

Require manifest layer comments:

```yaml
  # Worktree: ~/coding/hapi/worktrees/model-error-bridge
  # Peer session: 902b7f8a-...
  # Layer tip: 332c722c (+5 vs feat/cursor-detect-inline-model-errors)
  - branch: feat/cursor-model-error-bridge
```

---

## Implementation order (tooling bot)

1. **Tier A script + wire into rebuild** — highest ROI, ~150 LOC bash + tests in `scripts/tooling/check-soup-layer-hygiene.test.sh`
2. **Tier C post-merge marker scan** — trivial, prevents Bun crash class
3. **Tier B manifest helper** — optional UX; Tier A catches abuse anyway
4. **Tier D doc patch** — operator process, no code
5. **Tier E comment template** — manifest convention + lint in Tier A

---

## Definition of done (this incident fully closed)

- [ ] `hapi-driver-build-web` + `hapi-verify-web-dist` green on proxmox
- [ ] oos-linux hub on driver `@62c2f47d+` (or operator confirms single-hub topology)
- [ ] Tailnet web Resume verified on one previously failing inactive ACP session
- [ ] Tier A hygiene gate landed in tooling
- [ ] Orphan branch `fix/soup-markdown-renderer-types` deleted; manifest footer comment fixed
- [ ] Peer briefing filed for session `902b7f8a` (optional but recommended for bollocking paper trail)

---

## References

- Incident briefing: [`peer-briefings/2026-07-03-peer-cursor-acp-remote-resume.md`](peer-briefings/2026-07-03-peer-cursor-acp-remote-resume.md)
- Upstream issue: [tiann/hapi#991](https://github.com/tiann/hapi/issues/991)
- Existing stale merge-tip rule: [`driver-soup.md`](../tooling/driver-soup.md) lines 233–249
