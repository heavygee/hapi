# "No release notes published for this tip yet" — what to check

Your hub shows an update banner, but where the changelog should be you get
*"No release notes published for this tip yet."*

**That message is usually wrong about its own cause.** It is emitted whenever
the hub's upgrade offer has no `releaseNotes` field, which in practice almost
never means "nothing was published". This page tells you how to tell the cases
apart in about two minutes, and what to do about each.

Tracking issue for the underlying product defect: **heavygee/hapi#335**.

---

## The short version

HAPI currently ties **release-note visibility** to the **upgrade subscription**.
The notes are not carried on the offer that every host receives — they are
added by an overlay that only runs when the hub has a *materialised soup tip*
on local disk. A host that does not subscribe to the upgrade channel therefore
cannot show notes, no matter how correctly they were published.

So the usual cause is not a publishing failure. It is that your hub was never
set up to fetch — or was deliberately configured not to fetch — the thing the
notes travel inside.

---

## Diagnose it (read-only, ~2 minutes)

Run these on the hub host. Nothing here changes state.

```bash
# 1. What does the hub actually offer? Look for releaseNotes and soupTag.
HAPI_HOME="${HAPI_HOME:-$HOME/.hapi}"
HUB="${HAPI_PUBLIC_URL:-http://127.0.0.1:3006}"
curl -sS -H "Authorization: Bearer $(jq -r .cliApiToken "$HAPI_HOME/settings.json")" \
  "$HUB/api/upgrade/offer" | head -c 600; echo

# 2. Is there a materialised tip, and where would the hub look for one?
ROOT="${HAPI_SOUP_ARTIFACTS_ROOT:-/var/lib/hapi/soup-artifacts}"
echo "soup-artifacts root = $ROOT"
ls -la "$ROOT" 2>&1 | head -20

# 3. Is the hub subscribed to the channel at all?
systemctl show -p Environment --value hapi-hub.service 2>/dev/null | tr ' ' '\n' \
  | grep -E 'HAPI_UPSTREAM_SEAL|HAPI_UPGRADE_CHANNEL|HAPI_SOUP_ARTIFACTS|HAPI_HOME'

# 4. Did something already download a manifest and leave it elsewhere?
find / -name manifest.json -path '*hapi*' -not -path '*/node_modules/*' 2>/dev/null | head -5
# then, for each hit:
#   python3 -c "import json,sys;d=json.load(open(sys.argv[1]));print(d.get('tag'), len(d.get('releaseNotes') or ''))" <path>

# 5. What is actually running?
"$(command -v hapi)" --version 2>/dev/null; sha256sum "$(command -v hapi)" 2>/dev/null
```

### Reading the result

| What you see | What it means |
|---|---|
| Offer has **no `soupTag`** and no `releaseNotes` | The hub has no materialised tip. This is the common case — go to **A** or **B** below. Note the banner header also drops to "What's in this version" instead of naming the tag; that missing tag is the fingerprint. |
| Offer **has `soupTag`** but empty `releaseNotes` | Rarer. The tip exists but carries no notes — a genuine publish-side gap. Report it with the tag. |
| Step 4 finds a `manifest.json` whose `releaseNotes` is non-empty | **The notes are already on this machine**, just not where the hub reads them. Go to **A**. |
| `HAPI_UPGRADE_CHANNEL=off` and no `HAPI_UPSTREAM_SEAL_URL` | Deliberate opt-out of hub-driven upgrades. Legitimate — but it currently costs you notes as a side effect. Go to **A**. |

---

## A — You manage versions yourself and do not want hub-driven upgrades

This is normal for anything managed by config management (Ansible, Puppet,
Chef, Nix, a Dockerfile, an internal package) or for any host where an external
system owns which build is installed. Keeping `HAPI_UPGRADE_CHANNEL=off` is the
right call there, and you should not have to give it up to see a changelog.

Your updater almost certainly already downloads the channel manifest in order
to pick which binary to install. That manifest **contains the release notes**.
It just has to be left where the hub reads it:

```
<soup-artifacts-root>/<tag>/manifest.json     # the file your updater already fetched
<soup-artifacts-root>/latest-tag.txt          # containing <tag>
<soup-artifacts-root>/<tag>/NOTES.md          # optional; manifest.releaseNotes is enough
```

- `<soup-artifacts-root>` = `$HAPI_SOUP_ARTIFACTS_ROOT`, else `/var/lib/hapi/soup-artifacts`
- `<tag>` = the manifest's own `tag` field (e.g. `hapi-soup-v2026.11.12-360c9d5`)

**This grants no upgrade capability.** You can leave `HAPI_UPGRADE_CHANNEL=off`
and set no seal URL; the tip directory does not need to contain any binaries.
The hub reads tip identity and notes from it and nothing else. The reader
requires only that `tag` starts with `hapi-soup-v` and that `binaries` is a
non-empty array — both already true of the published manifest you fetched.

Add that as one step in whatever installs HAPI on the host, right after it
downloads the manifest.

## B — You do want the hub to track the fleet channel

Set `HAPI_UPSTREAM_SEAL_URL` on the hub to the channel manifest URL and let it
materialise tips itself. Then choose how much autonomy you want with the
**fleet upgrade policy** (Settings, or per-machine override):

- `silent` — no banner, no auto-apply
- `alert` — banner only; you choose when to upgrade
- `auto` — the hub applies when runners trail it

See the caveat below before relying on `alert`.

---

## What `alert` does and does not get you

`alert` is documented as "hub surfaces the skew banner; operator upgrades
manually" — the right tier for a host you want notified but not touched.

**On a host that has a materialised tip, `alert` works today**: it shows the
notes and does not auto-apply. If you installed with the pet one-liner you are
in this case already, because the seal subscription is on by default. Choosing
`alert` is the correct way to get "tell me, let me decide" and you should not
avoid it.

The gap is narrower than it first appears. Policy governs what the hub *does*
with an offer, not what the offer *contains*, and tag plus notes are added by
an overlay that reads a materialised tip. So on a host with **no tip at all**,
no policy value helps — `alert` yields a bare version number there. That is
**heavygee/hapi#335**: tag and notes should reach the offer irrespective of
channel and policy, with channel and policy gating only the apply.

Until that lands, **A** is how an unsubscribed host gets notes without granting
any upgrade rights.

---

## If none of the above matches

Collect the five command outputs above and open an issue referencing #335.
Include the `tag` from step 1 if there is one. Please do not assume the publish
side is broken without step 1 showing a `soupTag` — in every case seen so far
the channel was correct and the host simply had no tip.
