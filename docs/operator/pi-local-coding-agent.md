# Pi coding agent (local LLM on oos-linux)

**Status (2026-07-23):** Pi is installed on **oos-linux** (HAPI runner) and **proxmox**. New Session already lists **Pi** (upstream `AGENT_FLAVORS` / soup driver). Backend is **Qwen3-Coder-30B-A3B Q4_K_M** on Janus VM **2002 `oos-linux`** via **`https://oos-llm.tail9944ee.ts.net`** (`svc:oos-llm`, unit `oos-llama.service`). Do **not** use `svc:local-llm` or jessica-named units for this path - see `janus-oos/docs/oos-linux-dual-gpu.md`.

## What you get

| Piece | Where | Notes |
|-------|-------|-------|
| HAPI flavor `pi` | Soup driver / `CREATABLE_AGENT_FLAVORS` | Upstream #862; runner spawns `hapi pi` from driver source |
| `pi` CLI `0.81.1` | `~/.npm-global/bin/pi` | Package `@earendil-works/pi-coding-agent` (needs **Node ≥ 22.19**) |
| Node 22.23.1 | `~/.local/node` → `~/.local/bin/node` | System Node on oos-linux was 20.x (too old) |
| Extension | `pi install npm:pi-llama-cpp` | Discovers llama.cpp models |
| Config | `~/.pi/agent/settings.json` + `models.json` | `llamaServerUrl` / provider `baseUrl` → **oos-llm** VIP (provider id may still be named `local-llm`) |
| Inference | oos-linux `:8080` / `svc:oos-llm` | `oos-llama.service`, **GPU 0 = RTX 5090**, ctx **32768**; 5070 Ti attached for dual-GPU tests |

## Use it

1. Open HAPI → **New Session** → agent **Pi** → pick oos-linux machine → start.
2. Or CLI on oos-linux: `export PATH="$HOME/.local/bin:$HOME/.npm-global/bin:$PATH"` then `hapi pi` (soup) / `pi` interactive.
3. Smoke VIP: `curl -sk https://oos-llm.tail9944ee.ts.net/props`
4. Smoke Pi: `pi -p --provider local-llm --model main --no-session "Reply with exactly: pi-ok"` (provider id is still `local-llm` in models.json; URL is oos-llm)

Pi RPC auto-approves tools (no permission modes in HAPI). Prefer a throwaway worktree for first dogfood.

## Model / GPU notes

- **Loaded:** `/models/llm/Qwen3-Coder-30B-A3B-Instruct-Q4_K_M.gguf` (~18GB) on oos-linux `/models`.
- **Was (studio era):** chatty `Qwen3-32B-abliterated` on **5070 Ti**; later coder on studio 5090 via `svc:local-llm`.
- **Now:** coder on **oos-linux 5090**; both GPUs passed through (5070 Ti idle until dual-GPU bake-off). Hub + inference share VM 2002 - expect hub blip if llama/GPU stack needs reboot.
- Passthrough knobs for 2002: `rombar=0`, no `x-vga` - do not re-apply studio recipes (`janus-oos/docs/oos-linux-dual-gpu.md`).
- Download GGUFs on oos-linux/proxmox into `/models/llm/` (models disk already mounted there).

## Reinstall sketch

```bash
# Node 22+
NODE_VER=v22.23.1
# ... extract to ~/.local/node-$NODE_VER, link ~/.local/bin/{node,npm,npx}

npm config set prefix ~/.npm-global
npm install -g @earendil-works/pi-coding-agent@0.81.1
pi install npm:pi-llama-cpp

# ~/.pi/agent/settings.json — llamaServerUrl + packages
# ~/.pi/agent/models.json — provider local-llm -> https://local-llm.tail9944ee.ts.net/v1

# Runner systemd PATH must include ~/.local/bin and ~/.npm-global/bin
```

Bootstrap hook: extend `janus-oos/scripts/bootstrap-oos-linux-agents.sh` with `--with-pi` when touching that script next.

## Friction

- Local coder will lose to Claude/Cursor on hard multi-file work. Use for privacy, cost, offline, and harness experiments.
- Published npm `@twsxtd/hapi` help may omit `pi`; **soup runner** still spawns Pi via driver `cli/src/commands/pi.ts`.
- If New Session → Pi fails with `pi: not found`, check runner unit `Environment=PATH=` and `systemctl --user daemon-reload` (restart runner only when idle).
