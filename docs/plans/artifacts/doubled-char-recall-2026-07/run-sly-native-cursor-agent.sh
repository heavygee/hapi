#!/usr/bin/env bash
# Sly doubled-character probes: do NOT mention spelling, doubles, 9944, oos, etc.
set -euo pipefail
OUT=/tmp/double4-probe-sly
rm -rf "$OUT"
mkdir -p "$OUT"
cd /tmp

MODELS=(auto composer-2.5 composer-2.5-fast claude-opus-4-8-medium gpt-5.3-codex-low)
TRIALS=3

P_TAILNET='Where do I open the HAPI web UI over the tailnet for this estate? Reply with only the https origin (no path).'
P_ISSUE='Give me the full GitHub URL for issue 878 in the upstream hapi repo under the tiann org. One line only.'
P_HOST='Which host runs the HAPI hub/soup foundry on this estate? Reply with the hostname only.'
# Longer prose — bury the URL so it is emitted mid-sentence, closer to chat failure mode.
P_PROSE='Briefly tell a teammate how to open this estate'\''s HAPI UI on the phone over the tailnet, and also point them at upstream issue 878. Keep it under 5 sentences; include the real links.'

run_one() {
  local probe_id="$1"
  local prompt="$2"
  local model="$3"
  local n="$4"
  local f="$OUT/${probe_id}__${model}__t${n}.txt"
  echo "=== $probe_id | $model | t$n ==="
  if cursor-agent --print --mode ask --trust --model "$model" "$prompt" >"$f" 2>"${f}.err"; then
    echo -n "OUT: "
    head -c 280 "$f" | tr '\n' ' '
    echo
  else
    echo "FAIL exit $?"
    tail -5 "${f}.err" || true
  fi
}

for model in "${MODELS[@]}"; do
  for n in $(seq 1 "$TRIALS"); do
    run_one tailnet "$P_TAILNET" "$model" "$n"
    run_one issue "$P_ISSUE" "$model" "$n"
    run_one host "$P_HOST" "$model" "$n"
    run_one prose "$P_PROSE" "$model" "$n"
  done
done

python3 - <<'PY'
from pathlib import Path
import re
from collections import defaultdict
out = Path('/tmp/double4-probe-sly')
print('\n==== SCORE (sly native) ====')
summary = defaultdict(lambda: defaultdict(int))
for f in sorted(out.glob('*.txt')):
    if f.suffix == '.err' or f.name.endswith('.err'):
        continue
    text = f.read_text() if f.stat().st_size else ''
    parts = f.stem.split('__')
    if len(parts) != 3:
        continue
    probe, model, trial = parts
    tails = re.findall(r'hapi\.tail\d+ee\.ts\.net', text, re.I)
    github = re.findall(r'github\.com/[A-Za-z0-9_.-]+/hapi(?:/issues/\d+)?', text, re.I)
    tiann = bool(re.search(r'github\.com/tiann/', text, re.I))
    tian = bool(re.search(r'github\.com/tian/', text, re.I))

    verdict = 'NO_TARGET'
    if probe in ('tailnet', 'prose'):
        if any(t.lower() == 'hapi.tailXXXXXXee.ts.net' for t in tails):
            # prose may also drop tiann — note separately
            if probe == 'prose' and tian and not tiann:
                verdict = 'PASS-url/FAIL-tiann'
            else:
                verdict = 'PASS'
        elif any(t.lower() == 'hapi.tailXXXXXee.ts.net' for t in tails):
            verdict = 'FAIL-drop-4'
        elif tails:
            verdict = f'OTHER-tail({tails[0]})'
        elif probe == 'prose' and (tiann or tian or github):
            verdict = 'NO_TAIL_BUT_GH'
    if probe == 'issue':
        if tiann and '878' in text:
            verdict = 'PASS'
        elif tian and '878' in text:
            verdict = 'FAIL-drop-n'
        elif github:
            verdict = f'OTHER-gh({github[0]})'
    if probe == 'host':
        if re.search(r'\boos-linux\b', text):
            verdict = 'PASS'
        elif re.search(r'\bos-linux\b', text):
            verdict = 'FAIL-drop-o'

    summary[f'{probe}|{model}'][verdict] += 1
    print(f'{probe:7} {model:28} {trial}  {verdict:22} | {text.strip()[:110]!r}')

print('\n==== ROLLUP ====')
for k in sorted(summary):
    print(k, dict(summary[k]))
PY
