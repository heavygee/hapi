# Exit reflection: terminal-ctrl-xs-jed (PR #1460)

## Shipped as

- PR(s): tiann/hapi#1460 (Fixes #1459)
- Absorber (if superseded): n/a
- Session: 10cc269a-3c0a-45a9-b589-a9e37acf13a6

## Non-code residue

- Sticky Ctrl + softkey is the wrong dogfood story for Jed on phone - dedicated C0 buttons win.
- Pad wallpaper ≠ proof: compelling demo needs PTY sniffer (raw termios + IXON off) + tap → `0x18`/`0x13`.
- Peer-stack terminal proof needs: matching CLI token vs settings, CORS including `http://127.0.0.1:<peer-port>`, live keep-cli (`TerminalManager`) because seed disconnects, session `active=1`.
- `pkill -f` matching the keep-cli path kills the agent shell - use pidfile kills only.
- Lane B: Meta ✅ then operator TTY merge; peer does Gate A cleanup without remat/self-archive.

## Promote?

- [x] `none` — no durable follow-up (lessons already fit existing peer-stack / proof-tier docs)
- [ ] `High-signal index` — …
- [ ] `lifecycle / tooling doc` — …
- [ ] `tooling issue` — …

## Open questions / landmines

- Peer-stack CORS defaults omit loopback - silent 403 "Origin not allowed" until env/settings fixed. Known footgun; not filing unless it keeps biting.

## Skip

- n/a (short retro kept)
