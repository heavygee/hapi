# Claude Code pre-PR hook — canonical deployment

**Fixed 2026-09-07.** The pre-PR checklist hook was firing on **every** Bash call on oos-linux,
including `ls`, `curl`, `grep` and peer pings. A gate that fires on everything is read as noise, and
the day it fires on a real `gh pr create` it gets skimmed past like the previous few hundred — its
own text cites PR #692 as the reason it exists, and the false positives were training that lesson out.

## The bug (oos-linux only)

`.claude/settings.local.json` (operator-local, gitignored) had:

```json
{ "matcher": "Bash",
  "hooks": [ { "type": "command",
               "if": "Bash(gh pr create*)",
               "command": "echo '{…STOP — MANDATORY PRE-PR CHECKLIST…}'" } ] }
```

Two problems:
1. `matcher: "Bash"` matches **every** Bash call.
2. The intended scoping sat in a per-hook `"if"` field. Whatever that field is meant to do, it
   **demonstrably did not gate anything** — observed firing on dozens of non-PR commands.
3. The command was a bare `echo` that never read the hook payload, so it *could not* know what
   command was running even in principle.

## The fix — reuse, do not reinvent

proxmox already had the correct solution. Canonical script (identical on both machines, md5
`a1cf2f795c05a265e6435f11fd6089d9`):

    ~/.local/bin/pr-create-prehook-claude.sh

It reads stdin, extracts `.tool_input.command`, and matches **only the first non-empty line** —
so a heredoc body that merely mentions `gh pr create` does not trip it. Fires on
`gh pr create`, `gh-ll pr create`, `hapi-pr-create`; silent otherwise.

Settings shape (note `cat |` — the hook must be fed the payload):

```json
{ "type": "command",
  "command": "cat | /home/heavygee/.local/bin/pr-create-prehook-claude.sh",
  "statusMessage": "Pre-PR checklist..." }
```

## Machine status

| Machine | State |
|---|---|
| **oos-linux** | **Fixed.** Script installed, `.claude/settings.local.json` rewritten, `if` removed. |
| **proxmox** | **Already correct.** Uses `cat \| script`; its sibling `pr-git-push-prehook-claude.sh` self-gates too, so the redundant `"if"` there is harmless. |
| **teemo** | **NOT DONE — unreachable.** `~/.ssh/id_ed25519_heavygee_desktop` is absent from oos-linux, so `ssh heavygee-desktop` fails auth. Needs the key restored, then: copy the script and apply the same settings shape. Teemo is Windows — confirm the hook runs under a shell that has `jq` and can execute the `.sh`, or port it, before assuming parity. |

## Verification (run after any change)

    S=~/.local/bin/pr-create-prehook-claude.sh
    echo '{"tool_input":{"command":"ls -la"}}' | $S                       # must be SILENT
    printf '%s' '{"tool_input":{"command":"cat <<EOF\ngh pr create\nEOF"}}' | $S   # must be SILENT
    echo '{"tool_input":{"command":"gh pr create --title x"}}' | $S       # must EMIT json

A hook that cannot produce a silent negative is not a gate, it is a banner.

## Related

The production-mutation guard (`hapi-claude-pretooluse-guard.sh`) does **not** have the
first-line refinement, and consequently blocked two messages today whose *body text* quoted
rebuild/restart commands — no such command was ever executed. Same class of false positive,
different guard; not fixed here, flagged for whoever owns it.
