#!/usr/bin/env python3
"""Apply per-hunk resolutions to a conflicted file from an explicit directive list.

For hot files where union-resolve.py correctly refuses every hunk (SessionList.tsx
had all 41 as MANUAL: 117 soup-only symbols against 79 main-only), the work is
genuine reading. This exists so the *applying* step is mechanical and auditable
once the reading is done — a human decides each hunk, this writes exactly that
and nothing else.

Directives: comma-separated INDEX=CHOICE over 1-based hunk order.
  ours    keep HEAD / soup side
  theirs  keep the incoming side
  both    ours then theirs (the usual answer when each side added something)
  botht   theirs then ours (when ordering matters, e.g. decls before use)
  drop    neither (only for genuinely dead regions)

Refuses unless every hunk in the file is accounted for, so a half-specified
file cannot be written and silently lose the hunks nobody looked at. Verify
with --check first; it prints the plan without writing.

Usage:
  apply-hunk-directives.py <file> --spec 1=both,2=ours,... [--check]
"""
import argparse
import re
import sys

PAT = re.compile(r"^<<<<<<< [^\n]*\n(.*?)^=======\n(.*?)^>>>>>>> [^\n]*\n", re.S | re.M)
CHOICES = {"ours", "theirs", "both", "botht", "drop"}


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("file")
    ap.add_argument("--spec", required=True)
    ap.add_argument("--check", action="store_true")
    args = ap.parse_args()

    spec = {}
    for part in args.spec.split(","):
        part = part.strip()
        if not part:
            continue
        idx, _, choice = part.partition("=")
        if choice not in CHOICES:
            print(f"bad choice {choice!r} (want one of {sorted(CHOICES)})", file=sys.stderr)
            return 2
        spec[int(idx)] = choice

    text = open(args.file).read()
    hunks = list(PAT.finditer(text))
    if not hunks:
        print("no conflict hunks found", file=sys.stderr)
        return 3

    missing = [i for i in range(1, len(hunks) + 1) if i not in spec]
    if missing:
        print(f"REFUSING: {len(hunks)} hunks, no directive for {missing}", file=sys.stderr)
        print("Every hunk must be decided — a partial spec silently keeps whichever", file=sys.stderr)
        print("side the file happens to start with and loses the other.", file=sys.stderr)
        return 4
    extra = [i for i in spec if i < 1 or i > len(hunks)]
    if extra:
        print(f"REFUSING: directives for non-existent hunks {extra} (file has {len(hunks)})", file=sys.stderr)
        return 5

    out, last = [], 0
    for i, m in enumerate(hunks, 1):
        ours, theirs = m.group(1), m.group(2)
        out.append(text[last:m.start()])
        choice = spec[i]
        if choice == "ours":
            out.append(ours)
        elif choice == "theirs":
            out.append(theirs)
        elif choice == "both":
            out.append(ours if ours.endswith("\n") or not ours else ours + "\n")
            out.append(theirs)
        elif choice == "botht":
            out.append(theirs if theirs.endswith("\n") or not theirs else theirs + "\n")
            out.append(ours)
        last = m.end()
    out.append(text[last:])
    result = "".join(out)

    if args.check:
        from collections import Counter
        print(f"{args.file}: {len(hunks)} hunks -> {dict(Counter(spec.values()))}")
        return 0

    open(args.file, "w").write(result)
    left = len(PAT.findall(result))
    print(f"{args.file}: applied {len(hunks)} directives, {left} conflict(s) left")
    return 0


if __name__ == "__main__":
    sys.exit(main())
