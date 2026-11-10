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

## Hot-file union rules (predecessor scar tissue)

`SessionList` / `HappyComposer` / `SessionChat` — keep **both** the call site and the
declaration; prefer the fuller send-intent / helper module (`sessionRowHelpers`) over a
partial HEAD stub. `playwright.config` is the other usual landmine.
