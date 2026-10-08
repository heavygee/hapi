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

Optional — run hub + runner under your user systemd (survives logout when linger is on):

```bash
curl -fsSL https://raw.githubusercontent.com/heavygee/hapi/main/scripts/install-hapi-pet.sh | bash -s -- --with-systemd
```

`--with-systemd` works via `curl | bash` (units are embedded in the installer — no git
checkout required). After install: `systemctl --user status hapi-hub hapi-runner`.

## Finish setup

Open a **new terminal**, then:

```bash
claude                  # log in — opens a browser
hapi --print "hello"    # confirms everything actually works
```

If `hapi --print "hello"` works, you're done.

## Opening the web UI

Go to `http://localhost:3006` in your **web browser** — Chrome, Firefox, whatever you
normally use. Not your terminal. Typing a URL at the Linux command line just gives you
`bash: http://...: No such file or directory` — that error means you're in the wrong
place, not that anything's broken.

It'll ask for an access token. That token is also sitting in your terminal's output and
in `~/.hapi/settings.json` — **treat it exactly like a password.**

**Do not paste it into an AI chat assistant, a support ticket, a screenshot, or anywhere
else, even to ask for help.** If you ever do paste it somewhere by accident (including
pasting full terminal output that happens to contain it), treat it as compromised and
get a fresh one — remove it with a JSON-safe edit and restart **both** hub and runner
(the runner caches the token at process start, so hub-only restart leaves reconnects
rejected):

```bash
jq 'del(.cliApiToken)' ~/.hapi/settings.json > ~/.hapi/settings.json.tmp \
  && mv ~/.hapi/settings.json.tmp ~/.hapi/settings.json
systemctl --user restart hapi-hub.service hapi-runner.service
```

If you are on the nohup/path without user systemd units, re-run the install command
instead — it regenerates the token and relaunches hub + runner.

## Upgrading later

Run the exact same install command again. Nothing you've done is lost — it swaps the
HAPI binary in place and restarts.

## If something's wrong

- **"Claude Code CLI not found on PATH"** — either you're still in the old terminal (open a new one), or the install didn't finish. Re-run the install command.
- **"Not logged in"** — the install worked, you just haven't run `claude` yet.
- Anything else — ask whoever gave you this guide.
