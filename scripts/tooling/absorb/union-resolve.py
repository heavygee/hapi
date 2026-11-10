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

ID = re.compile(r"[A-Za-z_][A-Za-z0-9_]{2,}")
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
    if o and t and o <= t:
        return "SUPERSET_THEIRS"
    if o and t and t <= o:
        return "SUPERSET_OURS"
    if is_imports(ours) and is_imports(theirs):
        return "IMPORT_UNION"
    return "MANUAL"


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
