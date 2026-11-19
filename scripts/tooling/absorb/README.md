# Absorb replay lists

Classification lists committed during a large tip-forward absorb so a killed turn
loses no verified work. Each pass is reproducible in one scripted run rather than
re-done by hand.

## The rule that produced `*-safe-theirs.txt`

Take `origin/main`'s side **only** where it provably drops nothing:

```bash
comm -23 <(git show :2:"$f" | ids) <(git show :3:"$f" | ids)   # empty => safe
```

`--theirs` on a hot chat file without this gate has burned the fleet twice, deleting
soup helpers while leaving their call sites (`getTodoProgress is not defined`). The
predecessor's verdict on the identifier gate: *"exactly the right refusal."*

## Squash-merge: ancestry lies about our own upstream PRs

> Ancestry answers "is our commit reachable?" Content answers "is our change present?"
> **Squash-merge makes those diverge on purpose.**

`tiann/hapi` squash-merges, so a fork commit never appears as an ancestor of
`upstream/main` even when the merged code is byte-identical to ours. On 2026-11-10 this
seat ran `git rev-list --count <fork-sha> ^upstream/main`, got non-zero, and declared
upstream's `#1424` session-jobs an independent parallel implementation — inventing a
"product decision" over 56% of the absorb. It was **our own PR**, merged hours earlier,
and upstream's copy was a superset (579 lines vs 350, +11 exported symbols).

Before calling upstream work a parallel implementation: check for a merged
heavygee → `tiann/hapi` PR, check the **author** field, and check whether the behaviour
is present in upstream's file content. Only then absorb it as *ours coming home*.

Full policy: `docs/operator/tooling-meta-role.md` § 3c.

## Additions are not overlaps

The rule that broke the 2026-11-19 absorb: **"soup wins overlapping edits"
applied to files and hunks where upstream was *adding* exports or files.** An
addition has no overlapping lines, so soup-wins is not a tie-break there — it
is silent deletion. That absorb composed a tip missing 209 of the 293 files
upstream had added (163 absent, 46 zero-byte) plus 61 exported symbols from
`shared/src/apiTypes.ts`, and the full gate still read EXIT=0 because every
lost implementation file had its test emptied or dropped in the same pass.

Soup wins **only** where there is a genuine competing edit. Upstream additions
are taken, always. The same scar is recorded in `2026-11-12-ROUND2-STATE.md`
("upstream additions the merge dropped — restore from `origin/main`"), so this
is recurring, not a one-off.

Enforced by `scripts/tooling/hapi-soup-base-completeness-check.mjs`, wired into
the remat before promote (always, not only under `--verify`).

## Which tool for which shape

| Tool | Use |
|---|---|
| `union-resolve.py [--apply] <files>` | **Canonical mechanical resolver.** Classifies each hunk SUPERSET_OURS / SUPERSET_THEIRS / IMPORT_UNION / ADDITIVE_UNION / MANUAL, refuses same-name competing bodies, refuses unbalanced fragments, and refuses to write at all if any fork identifier would vanish (REFUSED_LOSS). `--check` prints the split without writing. Covered by `union-resolve.test.sh` (7 cases, refusals included). |
| `port-fork-symbols.mjs` | Contract files where picking a side loses exports. Carries one side and appends the top-level definitions the other side has and it lacks. Lists same-name-different-definition collisions for review instead of guessing. |
| `orphan-imports.py` | Imports left pointing at symbols no longer present. |

A second line-multiset resolver (`resolve-safe-hunks.mjs`) was written on
2026-11-19 and removed the same day: `union-resolve.py` already did the job and
does it more carefully — it checks for a shared *declared name* before any
containment rule, which a line-multiset comparison cannot see. Commits dated
that day reference the deleted tool; its resolutions live on in rerere. Extend
`union-resolve.py` rather than adding another resolver.

## Fork fixes outside a conflict region need a heal, not a resolution

`rerere` replays **conflicted regions only**. A fork fix applied to a line git
treated as common context is silently discarded by the next compose — and in
full-recipe mode every run recomposes from the base, so "silently discarded"
means gone. Two cases from the 2026-11-19 compose, both now heals:

- `soup-heals/109` — the mermaid `<render-issue>` system-injection prefix.
  Upstream refactored the prefix list into `transcriptEntry.ts` and does not
  carry the tag, so without it mermaid parse-failure hints render as if the
  human typed them.
- `soup-heals/110` — serial `/stop-session` in the runner concurrency test.
  Parallel stops race the control server and flake on busy hosts.

## Hot-file union rules (predecessor scar tissue)

`SessionList` / `HappyComposer` / `SessionChat` — keep **both** the call site and the
declaration; prefer the fuller send-intent / helper module (`sessionRowHelpers`) over a
partial HEAD stub. `playwright.config` is the other usual landmine.
