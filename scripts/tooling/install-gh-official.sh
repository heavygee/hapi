#!/usr/bin/env bash
# install-gh-official — install/upgrade GitHub CLI from cli.github.com apt repo.
#
# Why: Debian bookworm community `gh` is 2.23 and lacks `gh pr checks --json`,
# which silently broke hapi-pr-status (empty checks → fake PASS). Official
# packages are maintained by GitHub CLI and track current releases.
#
# Idempotent. Leaves ~/.local/bin/gh wrapper intact (HAPI_REAL_GH=/usr/bin/gh).
# Does NOT restart hapi-* services (needrestart may suggest runner — ignore).
set -euo pipefail

MIN_VERSION="${HAPI_GH_MIN_VERSION:-2.80.0}"
KEYRING_URL="https://cli.github.com/packages/githubcli-archive-keyring.gpg"
KEYRING_SHA256="6084d5d7bd8e288441e0e94fc6275570895da18e6751f70f057485dc2d1a811b"
KEYRING_PATH="/etc/apt/keyrings/githubcli-archive-keyring.gpg"
LIST_PATH="/etc/apt/sources.list.d/github-cli.list"

err() { echo "install-gh-official: $*" >&2; }
die() { err "$*"; exit 2; }

if [[ "$(id -u)" -eq 0 ]]; then
    SUDO=()
else
    SUDO=(sudo)
    command -v sudo >/dev/null || die "need sudo (or run as root)"
fi

command -v wget >/dev/null || "${SUDO[@]}" apt-get install -y wget
command -v sha256sum >/dev/null || die "sha256sum required"

"${SUDO[@]}" mkdir -p -m 755 /etc/apt/keyrings /etc/apt/sources.list.d

tmp="$(mktemp)"
trap 'rm -f "$tmp"' EXIT
wget -nv -O"$tmp" "$KEYRING_URL"
echo "${KEYRING_SHA256}  ${tmp}" | sha256sum -c - >/dev/null
"${SUDO[@]}" tee "$KEYRING_PATH" <"$tmp" >/dev/null
"${SUDO[@]}" chmod go+r "$KEYRING_PATH"

arch="$(dpkg --print-architecture)"
echo "deb [arch=${arch} signed-by=${KEYRING_PATH}] https://cli.github.com/packages stable main" \
    | "${SUDO[@]}" tee "$LIST_PATH" >/dev/null

"${SUDO[@]}" apt-get update -qq
"${SUDO[@]}" apt-get install -y gh

ver="$(/usr/bin/gh --version | head -1 | grep -oE '[0-9]+\.[0-9]+\.[0-9]+' | head -1)"
[[ -n "$ver" ]] || die "gh installed but version unparseable"
printf '%s\n%s\n' "$MIN_VERSION" "$ver" | sort -V | head -1 | grep -qx "$MIN_VERSION" \
    || die "installed gh $ver still < required $MIN_VERSION"

# Prove the feature that forced the upgrade
if ! /usr/bin/gh pr checks --help 2>&1 | grep -q -- '--json'; then
    die "gh $ver lacks pr checks --json (unexpected)"
fi

echo "install-gh-official: OK — /usr/bin/gh $ver (min $MIN_VERSION)"
echo "  Wrapper (if present): ~/.local/bin/gh → HAPI_REAL_GH=/usr/bin/gh"
echo "  needrestart may suggest hapi-runner — do NOT restart for a gh upgrade."
