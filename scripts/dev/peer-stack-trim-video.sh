#!/usr/bin/env bash
# Trim a Playwright webm to mp4 for handoff (requires ffmpeg).
set -euo pipefail

in="${1:?usage: peer-stack-trim-video.sh INPUT.webm [OUTPUT.mp4]}"
out="${2:-${in%.webm}.mp4}"

if ! command -v ffmpeg >/dev/null 2>&1; then
    echo "ERROR: ffmpeg not found" >&2
    exit 1
fi

mkdir -p "$(dirname "$out")"
ffmpeg -y -i "$in" -vf "scale=1440:900" -c:v libx264 -preset fast -crf 23 -an "$out"
echo "$out"
