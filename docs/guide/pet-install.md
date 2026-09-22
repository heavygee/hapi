# Installing HAPI on your own machine

This is for a single personal machine (a Chromebook's Linux container, a VPS, any Linux
box) that you manage yourself — not a shared/managed HAPI instance.

## What you get

One command installs:

- the HAPI hub and runner
- the Claude Code CLI

It does **not** log Claude Code into your Anthropic account — that's a separate step you do by hand, on purpose.

## Install

```bash
curl -fsSL https://raw.githubusercontent.com/heavygee/hapi/main/scripts/install-hapi-pet.sh | bash
```

## Finish setup

Open a **new terminal**, then:

```bash
claude                  # log in — opens a browser
hapi --print "hello"    # confirms everything actually works
```

If `hapi --print "hello"` works, you're done.

## Upgrading later

Run the exact same install command again. Nothing you've done is lost — it swaps the
HAPI binary in place and restarts.

## If something's wrong

- **"Claude Code CLI not found on PATH"** — either you're still in the old terminal (open a new one), or the install didn't finish. Re-run the install command.
- **"Not logged in"** — the install worked, you just haven't run `claude` yet.
- Anything else — ask whoever gave you this guide.
