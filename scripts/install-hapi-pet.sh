#!/usr/bin/env bash
# hapi-pet-install: one-shot install/upgrade for a standalone ("pet") HAPI instance —
# a single machine with no orchestrator, no persistent-volume swap, no fleet management
# (a Chromebook's Linux/Crostini container, a fresh VPS, any hand-set-up Linux box).
#
# Safe to re-run: running this again on an already-installed box performs an in-place
# upgrade (validate new binary -> stop old -> swap -> relaunch), same mechanism proven
# by hand on antevorta/janus/pet-chromebook-sim, 2026-09-11 through 2026-09-13. The new
# binary is fetched and sanity-checked BEFORE anything running is touched, specifically
# so a bad HAPI_ARTIFACT_URL can never leave the box with nothing running.
#
# Does everything EXCEPT authenticate Claude Code — that step requires a real
# interactive login or Anthropic account token and is deliberately left to the user.
#
# Usage:
#   HAPI_ARTIFACT_URL=<url-or-path-to-hapi-binary> bash install-hapi-pet.sh
#   curl -fsSL …/install-hapi-pet.sh | bash -s -- --with-systemd
#
# See docs/plans/2026-09-04-fleet-vm-swap-strategy.md §6 for the full history of what
# this script encodes and why each step exists — every step here was a real bug found
# by literally following a hand-written cheat sheet on a fresh box, then by literally
# running this script itself on a fresh box.

set -euo pipefail

HAPI_HOME="${HAPI_HOME:-$HOME/.hapi}"
HAPI_WORKSPACE="${HAPI_WORKSPACE:-$HOME/.hapi-workspace}"
HAPI_ARTIFACT_URL="${HAPI_ARTIFACT_URL:-}"
INSTALL_DIR="${INSTALL_DIR:-$HOME/.local/bin}"
NVM_VERSION="v0.39.7"
NODE_MIN_MAJOR=22
STOP_TIMEOUT_SECS=15
WITH_SYSTEMD=0

# curl|bash leaves BASH_SOURCE[0] empty under `set -u`. Never rely on a repo-relative
# path for --with-systemd — that only works from a real git checkout.
_script_src="${BASH_SOURCE[0]:-}"
if [[ -n "$_script_src" && -f "$_script_src" ]]; then
    SCRIPT_DIR="$(cd "$(dirname "$_script_src")" && pwd)"
else
    SCRIPT_DIR=""
fi
unset _script_src

for arg in "$@"; do
    case "$arg" in
        --with-systemd) WITH_SYSTEMD=1 ;;
        -h|--help)
            cat <<'HELP'
hapi-pet-install: one-shot install/upgrade for a standalone ("pet") HAPI instance.

Usage:
  HAPI_ARTIFACT_URL=<url-or-path> bash install-hapi-pet.sh
  curl -fsSL …/install-hapi-pet.sh | bash
  curl -fsSL …/install-hapi-pet.sh | bash -s -- --with-systemd

--with-systemd  Install user-level systemd units (works via curl|bash; units are
                embedded — no git checkout required).
HELP
            exit 0
            ;;
    esac
done

log()  { printf '==> %s\n' "$1"; }
fail() { printf 'ERROR: %s\n' "$1" >&2; exit 1; }

# User-level systemd units for pet installs. Embedded so curl|bash works without a
# repo checkout. Keep in sync with scripts/tooling/systemd/units/user-pet/*.in —
# the checkout path below prefers the companion installer when present.
install_user_pet_systemd() {
    local companion=""
    if [[ -n "${SCRIPT_DIR}" && -x "${SCRIPT_DIR}/tooling/install-hapi-systemd-units.sh" ]]; then
        companion="${SCRIPT_DIR}/tooling/install-hapi-systemd-units.sh"
    fi
    if [[ -n "$companion" ]]; then
        log "Using companion systemd installer from checkout: $companion"
        HAPI_WORKSPACE="$HAPI_WORKSPACE" HAPI_HOME="$HAPI_HOME" INSTALL_DIR="$INSTALL_DIR" \
            bash "$companion" --profile user-pet --enable
        return 0
    fi

    log "No git checkout — writing embedded user systemd units"
    command -v systemctl >/dev/null 2>&1 || fail "systemctl not found — cannot install --with-systemd on this host"
    local hapi_bin="$INSTALL_DIR/hapi"
    local hapi_path="$INSTALL_DIR:$HOME/.bun/bin:$HOME/.npm-global/bin:/usr/local/bin:/usr/bin:/bin"
    local host_label
    host_label="$(hostname -s 2>/dev/null || hostname || echo pet)"
    local unit_dir="$HOME/.config/systemd/user"
    mkdir -p "$unit_dir"

    cat >"$unit_dir/hapi-hub.service" <<EOF
[Unit]
Description=HAPI Hub (${host_label})
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
Environment=HAPI_HOME=${HAPI_HOME}
Environment=PATH=${hapi_path}
ExecStart=${hapi_bin} hub
Restart=always
RestartSec=5

[Install]
WantedBy=default.target
EOF

    cat >"$unit_dir/hapi-runner.service" <<EOF
[Unit]
Description=HAPI Runner (${host_label})
After=network-online.target hapi-hub.service
Wants=network-online.target

[Service]
Type=simple
KillMode=process
Environment=HAPI_HOME=${HAPI_HOME}
Environment=PATH=${hapi_path}
Environment=HAPI_RUNNER_SUPERVISED=1
Environment=HAPI_DISABLE_VERSION_HANDOFF=1
ExecStart=${hapi_bin} runner start-sync --workspace-root ${HAPI_WORKSPACE}
Restart=always
RestartSec=5

[Install]
WantedBy=default.target
EOF

    systemctl --user daemon-reload
    loginctl enable-linger "$(id -un)" 2>/dev/null || true
    systemctl --user enable hapi-hub.service hapi-runner.service
    systemctl --user start hapi-hub.service hapi-runner.service
    log "Installed: $unit_dir/hapi-hub.service"
    log "Installed: $unit_dir/hapi-runner.service"
}

# --- 1. Architecture detection ---
ARCH="$(uname -m)"
case "$ARCH" in
    x86_64)  HAPI_PLATFORM="linux-x64-baseline" ;;
    aarch64) HAPI_PLATFORM="linux-arm64" ;;
    *) fail "Unsupported architecture: $ARCH (only linux-x64 / linux-arm64 pet installs are covered so far)" ;;
esac
log "Architecture: $ARCH -> $HAPI_PLATFORM"

# --- 2. Resolve artifact source ---
# Default: GitHub Releases mirror on heavygee/hapi (soup single-exe publish).
# Override with HAPI_ARTIFACT_URL for a local path or a different mirror.
HAPI_RELEASES_REPO="${HAPI_RELEASES_REPO:-heavygee/hapi}"
if [[ -z "$HAPI_ARTIFACT_URL" ]]; then
    HAPI_ARTIFACT_URL="https://github.com/${HAPI_RELEASES_REPO}/releases/latest/download/hapi-${HAPI_PLATFORM}"
fi
log "Artifact source: $HAPI_ARTIFACT_URL"

# --- 3. Fetch + sanity-check the new binary BEFORE touching anything running.
#     Ordering is deliberate: a bad URL/path or a corrupt download must fail here,
#     with the previous install (if any) still fully untouched and running. ---
mkdir -p "$HOME/.cache"
TMP_BIN="$(mktemp "$HOME/.cache/hapi-pet-install.XXXXXX")"
trap 'rm -f "$TMP_BIN"' EXIT
if [[ "$HAPI_ARTIFACT_URL" =~ ^https?:// ]]; then
    curl -fsSL "$HAPI_ARTIFACT_URL" -o "$TMP_BIN" || fail "download from $HAPI_ARTIFACT_URL failed"
else
    [[ -f "$HAPI_ARTIFACT_URL" ]] || fail "no file at $HAPI_ARTIFACT_URL"
    cp "$HAPI_ARTIFACT_URL" "$TMP_BIN"
fi
chmod +x "$TMP_BIN"
"$TMP_BIN" --version >/dev/null 2>&1 || fail "fetched file at $TMP_BIN does not run (--version failed) — corrupt download or wrong architecture, nothing has been touched"
log "New binary fetched and verified runnable."

# --- 4. Stop an already-running hub/runner, if any (upgrade path; no-op on fresh
#     install). Only reached after step 3's new binary is confirmed good. Waits for
#     the old process(es) to actually exit (not a blind sleep) before proceeding, so
#     the new hub never races the old one for :3006. ---
mapfile -t OLD_PIDS < <(pgrep -u "$(id -un)" -f 'hapi (hub|runner)' 2>/dev/null || true)
if [[ ${#OLD_PIDS[@]} -gt 0 ]]; then
    log "Found running hapi process(es), stopping for upgrade:"
    for pid in "${OLD_PIDS[@]}"; do
        ps -o pid=,cmd= -p "$pid" 2>/dev/null | sed 's/^/    /' || true
    done
    kill "${OLD_PIDS[@]}" 2>/dev/null || true
    waited=0
    while (( waited < STOP_TIMEOUT_SECS )); do
        still_alive=0
        for pid in "${OLD_PIDS[@]}"; do
            kill -0 "$pid" 2>/dev/null && still_alive=1
        done
        [[ "$still_alive" -eq 0 ]] && break
        sleep 1
        waited=$((waited + 1))
    done
    if (( waited >= STOP_TIMEOUT_SECS )); then
        log "Process(es) did not exit after ${STOP_TIMEOUT_SECS}s — sending SIGKILL"
        kill -9 "${OLD_PIDS[@]}" 2>/dev/null || true
        sleep 1
    fi
fi

# --- 5. Install to a user-writable location (never assumes sudo is present) ---
mkdir -p "$INSTALL_DIR"
mv "$TMP_BIN" "$INSTALL_DIR/hapi"
trap - EXIT
if ! grep -qF "export PATH=\"$INSTALL_DIR:" ~/.bashrc 2>/dev/null; then
    log "Adding $INSTALL_DIR to PATH via ~/.bashrc"
    echo "export PATH=\"$INSTALL_DIR:\$PATH\"" >> ~/.bashrc
fi
case ":${PATH}:" in
    *":${INSTALL_DIR}:"*) ;;
    *) export PATH="$INSTALL_DIR:$PATH" ;;
esac
log "hapi binary installed at $INSTALL_DIR/hapi ($(sha256sum "$INSTALL_DIR/hapi" | cut -d' ' -f1))"

# --- 6. Directories + persistent env (the hub does not create these itself) ---
mkdir -p "$HAPI_HOME/logs" "$HAPI_WORKSPACE"
if ! grep -q '^export HAPI_HOME=' ~/.bashrc 2>/dev/null; then
    echo "export HAPI_HOME=\"$HAPI_HOME\"" >> ~/.bashrc
fi
export HAPI_HOME

# --- 7. Launch ---
# With --with-systemd: systemd owns hub+runner (skip nohup so we do not race :3006).
# Without: nohup background processes (local-only; --relay still broken as of 2026-09-13).
if [[ "$WITH_SYSTEMD" -eq 1 ]]; then
    install_user_pet_systemd
    sleep 2
    if ! curl -fsS localhost:3006/health >/dev/null; then
        fail "hub did not come up under systemd — check: systemctl --user status hapi-hub; journalctl --user -u hapi-hub -n 50"
    fi
    log "Hub is up under systemd (localhost:3006)."
    if ! systemctl --user is-active --quiet hapi-runner.service; then
        fail "runner did not stay up under systemd — check: systemctl --user status hapi-runner; journalctl --user -u hapi-runner -n 50"
    fi
    log "Runner is up under systemd, restricted to $HAPI_WORKSPACE."
else
    # Deliberately WITHOUT --relay: as of 2026-09-13 it fails silently (tunwg flag mismatch)
    # and falls back to a local-only hub with no visible error. Local-only is correct and
    # safe for same-machine use; flag this back to the meta-bot if you need remote reach
    # before that bug is fixed.
    nohup "$INSTALL_DIR/hapi" hub > "$HAPI_HOME/logs/hub.log" 2>&1 &
    sleep 2
    if ! curl -fsS localhost:3006/health >/dev/null; then
        fail "hub did not come up — check $HAPI_HOME/logs/hub.log"
    fi
    log "Hub is up (localhost:3006, local-only for now)."

    # Runner, restricted to the workspace dir created above — without --workspace-root the
    # runner starts in "legacy mode" with no directory restriction, which defeats the point
    # of having a dedicated workspace dir at all.
    nohup "$INSTALL_DIR/hapi" runner start-sync --workspace-root "$HAPI_WORKSPACE" \
        > "$HAPI_HOME/logs/runner.log" 2>&1 &
    RUNNER_PID=$!
    sleep 2
    if ! kill -0 "$RUNNER_PID" 2>/dev/null; then
        fail "runner exited immediately — check $HAPI_HOME/logs/runner.log"
    fi
    log "Runner started, restricted to $HAPI_WORKSPACE."
fi

# --- 8. Node.js (via nvm, no sudo needed) + Claude Code CLI ---
# Deliberately does NOT pre-check the existing Node version and skip nvm on "looks new
# enough" — a box can have a root-owned Node >=22 (e.g. from another admin's earlier
# system-wide install) where `npm install -g` would still hit the same no-write-access
# EACCES this whole nvm path exists to avoid. Try the plain install first; ANY failure
# (too old, no write access, no npm at all) falls through to nvm, which is always safe
# to run again if already installed (idempotent, confirmed 2026-09-13).
if ! command -v claude >/dev/null 2>&1; then
    log "Installing Claude Code CLI"
    if ! npm install -g @anthropic-ai/claude-code 2>/tmp/hapi-pet-npm-err.log; then
        log "System npm install failed (no npm, Node too old, or no write access) — installing Node ${NODE_MIN_MAJOR}+ via nvm instead"
        NVM_INSTALLER="$(mktemp "$HOME/.cache/nvm-install.XXXXXX")"
        curl -fsSL "https://raw.githubusercontent.com/nvm-sh/nvm/${NVM_VERSION}/install.sh" -o "$NVM_INSTALLER" \
            || fail "nvm installer download failed — check network/GitHub reachability"
        bash "$NVM_INSTALLER"
        rm -f "$NVM_INSTALLER"
        export NVM_DIR="$HOME/.nvm"
        # shellcheck source=/dev/null
        source "$NVM_DIR/nvm.sh"
        nvm install "$NODE_MIN_MAJOR"
        npm install -g @anthropic-ai/claude-code || fail "Claude Code CLI install failed even under nvm Node ${NODE_MIN_MAJOR} — see above"
    fi
    rm -f /tmp/hapi-pet-npm-err.log
fi

cat <<EOF

==> Install complete. Everything is set up EXCEPT Claude Code authentication —
    that needs a real interactive login or account token, done deliberately by hand.

    IMPORTANT — open a NEW terminal (or run 'source ~/.bashrc') before the commands
    below. This script ran in its own subprocess; the PATH/nvm changes it made
    cannot reach back into the shell you launched it from. If you skip this and run
    the commands in the SAME terminal you just used, you will see the false error
    "Claude Code CLI not found on PATH" even though the install above succeeded —
    that failure mode means "wrong shell," not "broken install."

      claude                # interactive OAuth login (needs a browser/display)
      claude setup-token    # headless: prints a URL, waits for a code

    After that, confirm the whole thing actually works end-to-end:

      hapi --print "hello"

    "Claude Code CLI not found on PATH"  -> either you're still in the old shell
                                            (see above), or install genuinely didn't
                                            complete — re-check the log above
    "Not logged in - Please run /login"  -> installed fine, just do the auth step
EOF
