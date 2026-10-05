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

That command uses **user systemd** when your machine actually has a working
`systemctl --user` session (typical on Crostini, a VPS, or modern Linux). If it
does not, the installer falls back to nohup automatically. You do not need a
flag for the common case.

Overrides (optional):

```bash
# force nohup even when systemd --user works
curl -fsSL https://raw.githubusercontent.com/heavygee/hapi/main/scripts/install-hapi-pet.sh | bash -s -- --no-systemd

# force systemd units (fails if systemctl --user cannot run)
curl -fsSL https://raw.githubusercontent.com/heavygee/hapi/main/scripts/install-hapi-pet.sh | bash -s -- --with-systemd
```

Units are embedded in the installer — `curl | bash` does not need a git checkout.
After a systemd install: `systemctl --user status hapi-hub hapi-runner`.

## Restarting (already installed)

If the machine rebooted or the hub/runner just stopped, do **not** invent a new
`hapi runner start --workspace-root …` line unless this install used nohup
(`--no-systemd`, or auto-fallback because `systemctl --user` was not usable).

```bash
# systemd path (default when the installer detected a user session)
systemctl --user start hapi-hub hapi-runner
systemctl --user status hapi-hub hapi-runner

# nohup path only (--no-systemd, or no user session at install time)
hapi hub
hapi runner start --workspace-root "$HOME/.hapi-workspace"
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
