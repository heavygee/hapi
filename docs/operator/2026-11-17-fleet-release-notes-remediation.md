# Release notes empty on instrument hubs — confirmed cause + remediation

**Date:** 2026-11-17
**Symptom:** the update banner shows *"No release notes published for this tip yet."*
**Reported on:** an externally-managed instrument hub (versions owned by a
config-management layer, hub-driven upgrades deliberately disabled)
**Status of the cause:** **confirmed by reading both sides**, not inferred.

> **Shareable version:** [`docs/tooling/fleet-release-notes-missing.md`](../tooling/fleet-release-notes-missing.md)
> is the generic, site-neutral troubleshooting page. Send people that.
> This page is the fork-private analysis of how we got here. Site-specific
> evidence (hostnames, operator names, another party's internal config paths)
> belongs in private channels, **not in this repo — it is public.**

---

## Short answer

Nobody misconfigured anything. The reporting operator did nothing wrong, and
the site's config-management role is doing exactly what it says it does.

**The notes are already on the affected disk.** That role downloads the same
`hapi-fleet` manifest that carries them. It reads one field out of it to pick a
binary, then leaves the file in a staging directory. HAPI only ever reads
release notes from a *materialised soup tip*, which that host deliberately does
not have — so the hub has notes sitting feet away and no way to see them.

The blame, such as it is, sits with HAPI: we tie **release-note visibility** to
the **upgrade-subscription mechanism**. A host that deliberately opts out of
hub-driven upgrades — a configuration we support, and that any
config-managed estate will reasonably require — loses notes as a side effect,
and is then shown a message that blames publishing.

Worth stating up front, because it is the real design error: we ship a
three-pole policy (`silent` / `alert` / `auto`) whose middle setting is
*documented* as "surface the banner, operator upgrades manually" — and
selecting it would **not** have fixed this either, because the notes do not
travel with the offer. See Option B. Knowing what is available and being able
to take it are two different permissions, and we have fused them.

---

## What is confirmed, and how

### HAPI side (this repo — read directly)

- `offer.releaseNotes` is set in exactly one place: `soupTipToUpgradeOffer()`
  in `hub/src/upgrade/soupArtifact.ts`. Grepped the whole hub: no other offer
  path sets it — not npm, not a bare `hub-artifact` offer.
- That function is only reached when `readPublishedSoupTip()` finds a
  materialised tip under the soup-artifacts root
  (`HAPI_SOUP_ARTIFACTS_ROOT`, else `/var/lib/hapi/soup-artifacts`), resolved
  via `latest-tag.txt` / `fleet-latest-tag.txt`.
- With no such tree, the offer carries no `releaseNotes` **and no `soupTag`**,
  and the banner falls back to `runner.skew.banner.whatsNewEmpty`.
- The published channel is correct and has been throughout: tip
  `hapi-soup-v2026.11.12-360c9d5`, `releaseNotes` **644 chars**, fetched from
  the public URL, not from the foundry's local disk.

**Corroborating detail:** the reported banner header reads *"What's in this
version"* with no tag, where a subscribed host reads *"What's in hapi-soup-v…"*.
Absent `soupTag` is the visible fingerprint of "no materialised tip".

### Deploying side (the site's config-management role — read directly)

Verified by reading the role itself, not inferred. Summarised here without
quoting another party's internal file paths, since this repo is public:

- It points at **the same** `hapi-fleet` channel base URL that the notes ship in.
- It **downloads `manifest.json`** from that channel during install.
- It uses that manifest **only** to select a binary for the host's arch, then
  retains it in a staging directory — nowhere the hub reads.
- It **asserts** that neither the hub nor the runner unit may carry
  `HAPI_UPSTREAM_SEAL_URL` or `HAPI_UPSTREAM_SEAL_TAG`.
- Its hub unit template sets `HAPI_UPGRADE_CHANNEL=off`.

That opt-out is deliberate and, in my view, correct: it stops another party's
hub initiating upgrades on an instrument. The gap is that HAPI makes notes a
by-product of the thing they switched off.

(Exact file:line citations were shared with the operator directly. They are
not reproduced here.)

### What is NOT confirmed

Anything about the live state of the affected host. There is no route to it
from this side and none was attempted. Specifically unverified: which tag the
running binary is, whether any soup-artifacts tree exists, and what the hub's
actual environment contains. **That is what the prompt below is for.**

---

## Prompt for the affected site's agent

Copy everything between the lines.

---
Please run these read-only checks on this host and report the raw output. No
changes. Context: our HAPI hub shows "No release notes published for this tip
yet" and we are confirming why.

```bash
# 1. What the hub serves for its own upgrade offer (expect releaseNotes/soupTag)
HUB="${HAPI_PUBLIC_URL:-http://127.0.0.1:3006}"
curl -sS -H "Authorization: Bearer $(jq -r .cliApiToken "${HAPI_HOME:-$HOME/.hapi}/settings.json")" \
  "$HUB/api/upgrade/offer" | head -c 600; echo

# 2. Does a materialised soup tip exist, and where would the hub look?
echo "root=${HAPI_SOUP_ARTIFACTS_ROOT:-/var/lib/hapi/soup-artifacts}"
ls -la "${HAPI_SOUP_ARTIFACTS_ROOT:-/var/lib/hapi/soup-artifacts}" 2>&1 | head -20

# 3. Is the hub subscribed to the moving channel? (expect EMPTY on an instrument)
systemctl show -p Environment --value hapi-hub.service 2>/dev/null | tr ' ' '\n' \
  | grep -E 'HAPI_UPSTREAM_SEAL|HAPI_UPGRADE_CHANNEL|HAPI_SOUP_ARTIFACTS|HAPI_HOME' 

# 4. Did the installer leave a downloaded manifest somewhere, and does it carry notes?
find / -name manifest.json -path '*hapi*' -not -path '*/node_modules/*' 2>/dev/null | head -5
# for each hit:  python3 -c "import json,sys;d=json.load(open(sys.argv[1]));print(d.get('tag'), len(d.get('releaseNotes') or ''))" <path>

# 5. Which build is actually running
"$(command -v hapi)" --version 2>/dev/null; sha256sum "$(command -v hapi)" 2>/dev/null
```

Report all five outputs verbatim. The key questions they answer: does the hub's
offer contain `releaseNotes`; does a soup-artifacts tip directory exist; is
`HAPI_UPSTREAM_SEAL_URL` set (we expect **not**, by contract); and does the
staged `manifest.json` already contain a non-empty `releaseNotes` field.
---

**Expected result if the diagnosis is right:** (1) offer with no `releaseNotes`
and no `soupTag`; (2) no soup-artifacts tip directory; (3) no seal URL,
`HAPI_UPGRADE_CHANNEL=off`; (4) a staged `manifest.json` whose `releaseNotes`
is several hundred characters; (5) a sealed `hapi-soup-v*` binary.

If (4) shows notes present on disk while (1) shows them absent from the offer,
the diagnosis is proven on that host and the fix below is sufficient.

---

## What has to change

### Option A — deploying role, small and keeps the opt-out (recommended interim)

The role already has the manifest. Also write it where the hub looks, and no
further HAPI behaviour is needed:

```
<soup-artifacts-root>/<tag>/manifest.json     # the file already fetched
<soup-artifacts-root>/<tag>/NOTES.md          # optional; manifest.releaseNotes suffices
<soup-artifacts-root>/latest-tag.txt          # contains <tag>
```

`<soup-artifacts-root>` is `HAPI_SOUP_ARTIFACTS_ROOT` if set, else
`/var/lib/hapi/soup-artifacts`; `<tag>` is `manifest.tag`.

This grants **no upgrade capability**: `HAPI_UPGRADE_CHANNEL=off` and the
absent seal URL are untouched, and the tip directory need not contain binaries.
The hub reads tip identity plus notes and nothing else. `readPublishedSoupTip()`
requires `tag` to start with `hapi-soup-v` and `binaries` to be a non-empty
array — both already true of the published manifest.

### Option B — HAPI, the actual fix (ours): knowledge is not capability

We already have the right switch and do not honour it. `FleetUpgradePolicy`
(`shared/src/upgradeChannel.ts:227`) is a three-pole operator control —
`silent` / `alert` / `auto` — and its own docstring defines `alert` as "hub
surfaces the skew banner; operator upgrades manually". That is exactly the
notify-only tier an instrument wants: *tell me what's available, show me what
changed, let me choose*.

Choosing it does not currently deliver that. The policy governs what the hub
**does** with an offer; it has no bearing on what the offer **contains**.
`resolveUpgradeOffer()` — the path every host takes — returns only `channel`,
`targetVersion` and `targetCapabilities`. It never sets `releaseNotes` and
never sets `soupTag`. Those are added afterwards by the soup-tip overlay, which
only runs for a subscribed host. So `alert` yields a bare version number, and
the thing that would make the alert *useful* is gated behind the same
subscription that grants the ability to apply.

That is the conflation to remove. **Fetching a manifest is a read-only act and
should not be coupled to apply capability.** Tag and notes should reach the
offer irrespective of `HAPI_UPGRADE_CHANNEL` and irrespective of policy;
channel and policy should gate the apply and nothing else. Then `alert` means
what it already claims to mean, and a config-managed site can take
notify-only instead of being pushed to `off`.

Two supporting changes, in rough priority:

1. Let the hub read tip identity + notes from a manifest without a
   subscription — the Option A directory shape is one way; a read-only
   manifest fetch under `alert` is another.
2. Carry tag and notes **inside the binary** at build time, as
   `hub/src/web/embeddedAssets.generated.ts` already does for web assets, so
   any install shape can self-report what it is running with no filesystem or
   network dependency at all.

**Note the current failure mode is worse than "no notes".** The skew banner
renders, so the operator is told a newer version exists; `soupTag` is absent so it cannot
name it; `releaseNotes` is absent so it cannot describe it; and
`HAPI_UPGRADE_CHANNEL=off` means it cannot be acted on from the UI. Told there is
news, not told what, unable to do anything — the worst of the three corners
rather than the reasonable middle one the site should have been in.

### Option C — regardless of A or B: stop the banner lying

`"No release notes published for this tip yet"` is false in every case above and
sent three rounds of investigation to the publishing side while the published
notes were correct the whole time. When there is no `soupTag`, the hub knows it
has no tip — say that, or render nothing.

---

## Why the site does not already have this

Because `HAPI_UPGRADE_CHANNEL=off` with no `HAPI_UPSTREAM_SEAL_URL` — required
by the instrument contract and asserted in that role — means no tip is
ever materialised, and a materialised tip is currently the only source of
`offer.releaseNotes`. The notes were published, mirrored, and downloaded to the
machine. Nothing read them.
