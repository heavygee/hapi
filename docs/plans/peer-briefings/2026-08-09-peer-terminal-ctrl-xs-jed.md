# Peer briefing: mobile terminal Ctrl+X / Ctrl+S (Jed save)

**Spawned:** 2026-08-09  
**Worktree:** `/home/heavygee/coding/hapi/worktrees/terminal-ctrl-x-s`  
**Branch:** `fix/terminal-ctrl-xs-jed` (from `upstream/main`)  
**Lane:** **B** (`low-impact`) — operator wants issue + implement + **open upstream PR** (prepare-only merge; do not `gh pr merge` unless operator TTY directs).

## Problem

On compact Direct → Control keypad (phone/Quest), operator uses **Jed** (Emacs mode). Save is **Ctrl+X then Ctrl+S**.

- Dedicated chords exist for `Ctrl+C` / `Ctrl+D` / `Ctrl+Z` / `Ctrl+L` but **not** `Ctrl+X` / `Ctrl+S`.
- Sticky **Ctrl** + soft-keyboard `x` / `s` is unreliable (IME / focus); operator cannot complete the chord.

Proof screenshot: `/tmp/hapi-blobs/.../Screenshot_20260809-141614.png` (also copy under briefing assets if useful).

## Discovery

No open upstream issue for this specifically. Related closed: [#66](https://github.com/tiann/hapi/issues/66) (quick keys feature).

Code: `web/src/routes/sessions/terminal.tsx` → `COMPACT_DIRECT_INPUTS.control` (~129–142). Sticky path: `useQuickKeyInput` / `applyModifierState` in `web/src/components/QuickKeys/QuickKeys.tsx` (Ctrl + single letter → C0). Dedicated buttons send raw `\u0003` etc.

## Fix (locked)

1. Add **Ctrl+X** (`\u0018`) and **Ctrl+S** (`\u0013`) to the Control page alongside other Ctrl+* chords.
2. Squeeze layout: prefer keep existing keys; if density forces a trade, demote **Ctrl+L** (clear) before dropping interrupt/EOF/suspend — or move Ctrl+L to Shell page / long-press. Document choice in PR.
3. Smoke sticky Ctrl + letter if easy; primary deliverable is **dedicated buttons** (Jed-reliable).
4. Tests for the new sequences in terminal quick-key tests if present.

## Process

1. File upstream issue on `tiann/hapi` (cite Jed Emacs save; mobile Control pad).
2. Implement on this branch.
3. Peer-stack / soup dogfood when ready.
4. **Open upstream PR** with `Fixes #<issue>`, apply **`low-impact`** (lane B). Attach `hapi link-pr`. Title = workstream only.
5. Do **not** merge on `tiann/hapi` unless operator with controlling TTY explicitly directs lane B merge.

Hard rules: product edits only in this worktree; no operator docs in PR diff.
