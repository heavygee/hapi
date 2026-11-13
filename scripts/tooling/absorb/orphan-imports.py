#!/usr/bin/env python3
"""Find imports a merge kept after discarding the code that used them.

The absorb failure this catches: git's 3-way merge takes an upstream `import`
line (no conflict there) while a resolution elsewhere in the file drops the call
site. The symbol is still *present* in the tree, so `hapi-sentinel-check --auto`
sees nothing missing, and an unused import is legal TypeScript, so typecheck is
silent too. The feature is simply never invoked.

This is how upstream 0.35.0's model-catalog args stopped reaching the Codex
app-server: `launch.ts` kept `import { resolveModelCatalogArgs }` and lost its
one call, `serverArgs.push(...resolveModelCatalogArgs(serverArgs))`.

An import is reported only when BOTH hold:
  - in the composed tree the name appears exactly once (the import itself), and
  - upstream calls it (appears more than once in upstream's copy of that file).

The second condition is what keeps the signal usable: a fork may legitimately
carry a dead import it never wired up, and that is not this bug. Requiring
upstream to use it means the tree lost something it was meant to have.

Report-only. A rename reads identically to a deletion, so this names suspects,
not verdicts -- confirm each against the upstream file before changing anything.

Usage:
    orphan-imports.py [--base <rev>] [--tip <rev>] [--upstream <rev>]

Defaults compare the live soup tip against the WIP, judged against origin/main.
"""
import argparse
import re
import subprocess
import sys

IMPORT_BLOCK = re.compile(r'import\s*(?:type\s*)?\{([^}]*)\}\s*from')
IDENT = re.compile(r'^[A-Za-z_$][\w$]*$')
CODE_SUFFIXES = ('.ts', '.tsx')


def git(*args: str) -> str:
    return subprocess.run(['git', *args], capture_output=True, text=True).stdout


def show(rev: str, path: str) -> str:
    return git('show', f'{rev}:{path}')


def imported_names(text: str):
    """Names bound by `import { ... }`, with `x as y` resolved to the local y."""
    for block in IMPORT_BLOCK.finditer(text):
        for raw in block.group(1).split(','):
            name = raw.strip().split(' as ')[-1].strip()
            if name and IDENT.match(name):
                yield name


def occurrences(text: str, name: str) -> int:
    return len(re.findall(r'\b' + re.escape(name) + r'\b', text))


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument('--base', default='driver/integration')
    ap.add_argument('--tip', default='driver/integration-wip')
    ap.add_argument('--upstream', default='origin/main')
    args = ap.parse_args()

    changed = [f for f in git('diff', '--name-only', args.base, args.tip).split()
               if f.endswith(CODE_SUFFIXES) and '.test.' not in f]

    findings = []
    for path in changed:
        composed = show(args.tip, path)
        if not composed:
            continue
        orphans = {n for n in imported_names(composed) if occurrences(composed, n) <= 1}
        if not orphans:
            continue
        upstream = show(args.upstream, path)
        if not upstream:
            continue
        for name in sorted(orphans):
            if occurrences(upstream, name) > 1:
                findings.append((path, name))

    print(f'orphan-imports: {len(changed)} changed non-test file(s) scanned '
          f'({args.base}..{args.tip}, judged against {args.upstream})')
    if not findings:
        print('orphan-imports: no imports lost their call site')
        return 0

    print(f'orphan-imports: {len(findings)} import(s) with no call site here that '
          f'{args.upstream} does call')
    for path, name in findings:
        print(f'  {path}')
        print(f'      {name}')
    print('\nReport-only: confirm each against the upstream file. An import that the '
          'fork never wired up is not this bug.')
    return 0


if __name__ == '__main__':
    sys.exit(main())
