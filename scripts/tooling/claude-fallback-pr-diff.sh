#!/usr/bin/env bash
# Pinned diff helper for the Claude Codex-fallback reviewer (cold review,
# 2026-11-01, fifth wave). The reviewer's allowedTools previously granted
# `Bash(git -C pr-head*)`, which also matches `git -C pr-head -c
# alias.run='!sh scripts/evil.sh' run` — git treats a `!`-prefixed alias as
# an arbitrary shell command, so a prompt injection in the reviewed PR
# content could reach code execution on the runner, not just inspect the
# checkout. This script takes NO arguments, and the allowedTools entry for
# it has no trailing `*`, so Claude cannot pass any argv into it — there is
# nothing to inject into. BASE_SHA comes from the workflow's own pinned
# `steps.gate.outputs.base_sha`, set via env, not a Claude-supplied argument.
#
# Three-dot range (merge-base diff), not two-dot: if main has advanced since
# the PR branched, a direct `diff BASE HEAD` would include the reversal of
# main-only commits, presenting unrelated upstream changes as PR deletions.
set -euo pipefail
exec git -C pr-head diff "${BASE_SHA}...HEAD"
