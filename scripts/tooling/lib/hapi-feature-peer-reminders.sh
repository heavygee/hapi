#!/usr/bin/env bash
# Transactional feature-peer checklist — print on CLI success paths.
#
# Agent-agnostic alternative to Cursor alwaysApply mdc: every flavor that runs
# hapi-worktree-create / hapi-peer-stack up sees this in the shell transcript.
#
# Source from scripts that already resolve SCRIPT_DIR to scripts/tooling/.
# Opt out: HAPI_SKIP_FEATURE_PEER_REMINDERS=1

hapi_print_feature_peer_reminders() {
    if [[ "${HAPI_SKIP_FEATURE_PEER_REMINDERS:-}" == "1" ]]; then
        return 0
    fi

    local context="${1:-}"

    echo "" >&2
    echo "── Feature peer checklist (lifecycle §6.4 / Proof tiers) ──" >&2
    if [[ -n "$context" ]]; then
        echo "  Context: $context" >&2
    fi
    cat >&2 <<'EOF'
  • Visible UI change: capture PNG (MP4 if the story is interaction).
  • Inline into this HAPI chat (not Cursor Read paths):
      display_image / display_video
      or: bun scripts/tooling/hapi-display-image.mjs <session-prefix> <abs-path>
  • Paths-only / "screenshot on disk" alone = incomplete handoff.
  Detail: docs/tooling/feature-work-lifecycle.md#proof-tiers-images-and-video
EOF
    echo "" >&2
}
