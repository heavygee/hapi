# Peer postmortem: session 5ffdc413 (mermaid #902) — stale soup dist

**Session:** `5ffdc413-182c-441b-93cd-60633c4f32e6` (Claude, PR #902 mermaid parse-failure feedback)  
**When:** 2026-06-27..28  
**Symptom:** `:3006` missing most soup UI (machine health, scratchlist v2, overseer inbox, copy-reference, model-error banner, file markdown preview, …). Hub/cli layers were live; **web/dist was ~2 hours stale**.

---

## What actually broke

Not a missing manifest layer. **driver/integration @ `17653be1` was correct; `web/dist` was still stamped @ `7fe13524` (mermaid-only merge from 12:51).**

`verify-soup-web-dist` reported **53 missing t() keys** and `driverHead` mismatch until `hapi-driver-build-web` ran 2026-06-28 ~17:04 BST.

Timeline:

- **12:51** — `hapi-driver-build-web` OK on `7fe13524` (mermaid layer)
- **14:35** — full manifest rebuild advanced driver to `17653be1` (**20+ layer merges**) with **no matching web build**
- Operator saw a soup that "lost" everything added after mermaid — it was never in the bundle

---

## What you did wrong (read this, agent)

1. **`hapi-driver-rebuild` without `--build-web`** (or you declared victory after a merge-only rebuild). That is **operator/meta only**. From a runner shell it rewrites `driver/web/src` and leaves `:3006` serving fossilized JS.

2. **`git merge --continue` inside `~/coding/hapi/driver`** — logged in hub session. That is **#962 hand-merge**. The driver tree is manifest-only. You do not "helpfully finish" merges in driver.

3. **Ignored verify failures** — session log shows `verify-soup-web-dist: FAIL — missing .hapi-build-meta.json` and you kept going instead of stopping blocked.

4. **Assumed hub restart = done** — most of this regression was **web-only**. No amount of `hapi-restart-hub` fixes stale vite output.

5. **You are Claude** — our production-mutation guard is a **Cursor preToolUse hook**. You walked around it by existing in a flavor with no shell hook. That gap is now closed in `hapi-driver-rebuild.sh` itself (non-tty / `HAPI_AGENT_CONTEXT=1` refuses merge-only rebuild).

---

## What you should have done

```bash
hapi-driver-rebuild --build-web --verify   # from ~/coding/hapi mirror, never inside driver/
# web-only after driver already matches manifest:
hapi-driver-build-web
hapi-verify-web-dist
# tell operator: hard-reload :3006
```

If verify fails: **STOP. Report blocked.** Do not cp feat dist. Do not raw `vite build` in driver/web.

---

## Fixes shipped (tooling bot, 2026-06-28)

- **Live:** `hapi-driver-build-web` → verify OK @ `17653be1` (565 keys, 21 soup markers)
- **`hapi-driver-rebuild.sh`:** agent guard (non-tty / `HAPI_AGENT_CONTEXT=1` → require `--build-web`); post-merge stale-dist verify fails closed; `--build-web` uses `build_web_atomic` + verify (meta stamp)
- **Pending:** runner injects `HAPI_AGENT_CONTEXT=1` (worktree `driver-rebuild-guard`, branch `fix/runner-agent-context`)

---

## Copy-paste for the agent if they resume

> You half-merged the daily driver soup and never rebuilt web/dist. The operator lost ~20 soup layers in the UI for most of a day. Manifest-only `hapi-driver-rebuild` and `git merge` in `driver/` are forbidden from agent shells. Read `docs/tooling/feature-work-lifecycle.md` soup section and `scripts/tooling/cursor-rules/hapi-driver-soup-dogfood.mdc`. If you cannot run `hapi-driver-rebuild --build-web --verify` to green, report **blocked** — do not "try something else."
