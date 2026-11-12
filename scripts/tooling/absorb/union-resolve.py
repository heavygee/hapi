#!/usr/bin/env python3
"""Resolve the mechanically-provable subset of absorb conflicts, refuse the rest.

Written for the 2026-11-10 tip-forward absorb (91 files / 332 hunks). The point is
NOT to resolve everything — it is to clear the hunks where a correct answer is
provable, so human judgement is spent only where judgement is actually required.

Three rules, in order. Each is a containment test on the hunk's identifier set, so a
hunk only resolves when one side demonstrably says everything the other does:

  SUPERSET_THEIRS  theirs ⊇ ours  -> take theirs
  SUPERSET_OURS    ours ⊇ theirs  -> take ours
  IMPORT_UNION     both sides are pure import lines -> concatenate, dedup

Anything else is left conflicted on purpose. In particular a hunk where each side
has identifiers the other lacks is EXACTLY the case that deleted soup helpers while
leaving their call sites ("getTodoProgress is not defined"), so it must not be
guessed at.

--check prints the classification without writing, so the split can be inspected
before anything is touched.
"""
import re
import sys
from pathlib import Path

# Any length. A {2,} threshold made two DIFFERENT short-named declarations look
# like identical identifier sets, so a genuine two-way conflict classified as
# SUPERSET and got resolved silently in favour of one side.
ID = re.compile(r"[A-Za-z_][A-Za-z0-9_]*")
START, MID, END = "<<<<<<<", "=======", ">>>>>>>"


def ids(text: str) -> set:
    return set(ID.findall(text))


def is_imports(text: str) -> bool:
    lines = [l for l in text.splitlines() if l.strip()]
    return bool(lines) and all(
        l.lstrip().startswith(("import ", "from ")) or l.strip().endswith(";")
        for l in lines
    ) and any(l.lstrip().startswith("import ") for l in lines)


def split_hunks(text: str):
    """Yield (prefix, ours, theirs) tuples plus the trailing remainder."""
    out, rest = [], text
    while START in rest:
        a = rest.index(START)
        m = rest.index(MID, a)
        b = rest.index(END, m)
        eol = rest.index("\n", b) + 1
        ours = rest[rest.index("\n", a) + 1:m]
        theirs = rest[rest.index("\n", m) + 1:b]
        out.append((rest[:a], ours, theirs))
        rest = rest[eol:]
    return out, rest


def classify(ours: str, theirs: str) -> str:
    o, t = ids(ours), ids(theirs)
    # FIRST, before any containment rule: if both sides declare the SAME name,
    # they are competing implementations and only a human can pick. Identifier
    # sets cannot see the difference when two bodies differ solely in literals
    # or operators — `function aa() { return 1 }` vs `{ return 2 }` have
    # identical identifier sets, so a containment rule would silently take one.
    od, td = set(DECL.findall(ours)), set(DECL.findall(theirs))
    if od & td:
        return "MANUAL"
    # One side empty is a PURE ADDITION, not a competing version: the other side
    # simply gained a block here. Taking the non-empty side cannot drop anything.
    # (Missed on the first pass because both rules below require a non-empty set,
    # which left dozens of pure-addition hunks sitting in MANUAL.)
    if not ours.strip() and theirs.strip():
        return "SUPERSET_THEIRS"
    if not theirs.strip() and ours.strip():
        return "SUPERSET_OURS"
    if o and t and o <= t:
        return "SUPERSET_THEIRS"
    if o and t and t <= o:
        return "SUPERSET_OURS"
    if is_imports(ours) and is_imports(theirs):
        return "IMPORT_UNION"
    if additive(ours, theirs):
        return "ADDITIVE_UNION"
    return "MANUAL"


DECL = re.compile(
    r"\b(?:export\s+)?(?:async\s+)?"
    r"(?:function|const|let|var|class|type|interface|enum)\s+([A-Za-z_][A-Za-z0-9_]*)"
)


def balanced(text: str) -> bool:
    """Braces/parens/brackets balanced, ignoring those inside strings."""
    depth = {"{": 0, "(": 0, "[": 0}
    close = {"}": "{", ")": "(", "]": "["}
    quote = None
    prev = ""
    for ch in text:
        if quote:
            if ch == quote and prev != "\\":
                quote = None
            prev = ch
            continue
        if ch in "\"'`":
            quote = ch
        elif ch in depth:
            depth[ch] += 1
        elif ch in close:
            depth[close[ch]] -= 1
            if depth[close[ch]] < 0:
                return False
        prev = ch
    return quote is None and all(v == 0 for v in depth.values())


def additive(ours: str, theirs: str) -> bool:
    """Both sides are self-contained blocks declaring different things.

    Concatenation is then a real union rather than a guess: neither side is a
    competing version of the other's statement, so keeping both cannot drop
    behaviour. Refused when either side is unbalanced (we would be splicing a
    fragment) or when they declare a name in common (that IS a competing
    version, e.g. two implementations of the same function).
    """
    if not ours.strip() or not theirs.strip():
        return False
    if not balanced(ours) or not balanced(theirs):
        return False
    od, td = set(DECL.findall(ours)), set(DECL.findall(theirs))
    if not od or not td:
        return False
    return od.isdisjoint(td)


def resolve(path: Path, apply: bool):
    text = path.read_text()
    hunks, tail = split_hunks(text)
    if not hunks:
        return None
    verdicts, pieces = [], []
    for prefix, ours, theirs in hunks:
        v = classify(ours, theirs)
        verdicts.append(v)
        pieces.append(prefix)
        if v == "SUPERSET_THEIRS":
            pieces.append(theirs)
        elif v == "SUPERSET_OURS":
            pieces.append(ours)
        elif v == "ADDITIVE_UNION":
            # Self-contained blocks declaring different things: keeping both IS
            # the union. (Classification without a handler here silently did
            # nothing for a whole pass — the hunks fell through to MANUAL.)
            pieces.append(ours if ours.endswith("\n") or not ours else ours + "\n")
            pieces.append(theirs)
        elif v == "IMPORT_UNION":
            seen, merged = set(), []
            for line in ours.splitlines(True) + theirs.splitlines(True):
                if line.strip() and line not in seen:
                    seen.add(line)
                    merged.append(line)
            pieces.append("".join(merged))
        else:  # MANUAL — put the conflict back exactly as it was
            pieces.append(f"{START} HEAD\n{ours}{MID}\n{theirs}{END} origin/main\n")
    if apply:
        # Partial application is deliberate: mechanical hunks get resolved even in
        # a file that still has MANUAL ones, so hand-reading is spent only on the
        # hunks that actually need judgement. The file stays unmerged in the index
        # either way — git tracks that by stage, not by marker count.
        new = "".join(pieces) + tail
        # Never let the resolver drop an identifier our side had anywhere in the
        # file. This is the gate that the earlier vacuous check failed to be.
        ours_all = ids("".join(o for _, o, _ in hunks))
        if not ids(new) >= ours_all - ids("".join(t for _, _, t in hunks)):
            return verdicts + ["REFUSED_LOSS"]
        path.write_text(new)
    return verdicts


def main():
    apply = "--apply" in sys.argv
    files = [a for a in sys.argv[1:] if not a.startswith("--")]
    tally = {}
    clean = []
    for f in files:
        p = Path(f)
        if not p.exists():
            continue
        v = resolve(p, apply)
        if v is None:
            continue
        for x in v:
            tally[x] = tally.get(x, 0) + 1
        if "MANUAL" not in v and "REFUSED_LOSS" not in v:
            clean.append(f)
    for k in sorted(tally):
        print(f"  {k:16} {tally[k]}")
    print(f"fully-resolvable files: {len(clean)} of {len(files)}")
    for f in clean:
        print(f"RESOLVED {f}")


if __name__ == "__main__":
    main()
