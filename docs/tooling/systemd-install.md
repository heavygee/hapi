# HAPI systemd install (canonical units)

**Audience:** Operators bringing up oos-linux, fleet VMs (Antevorta, Janus shards), and pet installs we ship to external users.

**Problem this solves:** Live `/etc/systemd/system/hapi-*` files were hand-edited drift. Cattle rebuilds (`lockhouse` bootstrap) and agent patches did not share one source of truth. Wrong `KillMode` or missing `PATH=` caused fleet archives or "no agents installed."

**Canonical source:** `scripts/tooling/systemd/units/` templates + `install-hapi-systemd-units.sh`.

---

## Profiles

| Profile | Units | Host type |
|---------|-------|-----------|
| `primary-soup` | `hapi-hub-oos.service`, `hapi-runner-oos.service` | oos-linux soup kitchen (bun driver under `~/coding/hapi/active`) |
| `fleet-binary` | `hapi-hub.service`, `hapi-runner.service` | Fleet VM shards (single-exe `/opt/hapi/hapi`, dedicated `hapi` user) |
| `user-pet` | user `hapi-hub.service`, `hapi-runner.service` | Standalone pet installs (`install-hapi-pet.sh --with-systemd`) |

All runner base units set **`KillMode=process`** ([upstream #915](https://github.com/tiann/hapi/issues/915)). System profiles also install **Tier-1 drop-ins** (`install-hapi-primary-hub-tier1.sh`): `Restart=always`, hub `OOMScoreAdjust=-1000`, runner explicit `0`, watchdog timer.

### `Restart=always` requires a working runner stop

`Restart=always` is only safe alongside an `ExecStartPre` that genuinely stops the running runner. Without one, a restart hits the runner's own dedup path — with `HAPI_DISABLE_VERSION_HANDOFF=1` set, `isRunnerRunningCurrentlyInstalledHappyVersion()` skips the mtime check, so a matching identity makes the new process log `keeping existing runner` and `exit(0)`. systemd then retries, burns `StartLimitBurst`, and parks the unit in **`failed`** with an unsupervised runner still alive.

`10-resilience.conf` used to hardcode the soup kitchen's `bun` invocation and was installed verbatim on every profile, so on `fleet-binary` and pet hosts the stop silently never ran (`|| true` hid it) while the drop-in looked correct. It is now `10-resilience.conf.in`, rendered per host. Resolution order:

1. `--runner-stop-cmd '<command>'`
2. `--runner-bin /path/to/hapi` → `-/path/to/hapi runner stop`
3. auto-detect from the runner unit's own `ExecStart`, then `/opt/hapi/hapi`, then the soup `bun` entrypoint

If none resolve it **fails closed** rather than installing a stop that cannot run. `install-hapi-systemd-units.sh --profile fleet-binary` passes `--runner-bin` automatically.

`user-pet` gets no Tier-1, but its base unit does set `HAPI_DISABLE_VERSION_HANDOFF=1` and `Restart=always` — so the equivalent `ExecStartPre=-<bin> runner stop` lives directly in that template.

---

## Install

### oos-linux (primary soup host)

```bash
cd ~/coding/hapi
sudo bash scripts/tooling/install-hapi-systemd-units.sh --profile primary-soup
bash scripts/tooling/verify-hapi-systemd-units.sh
# Apply live (patient drain):
hapi-restart-hub
```

Re-run after cattle rebuild or when base units drift. **Estate-local drop-ins** (`zz-work-cache`, cursor/claude env files, upload-heal) live only under `/etc/systemd/system/*.service.d/` — this installer does not touch them.

### Fleet VM (Antevorta, Janus `in-svc-*`, …)

After `/opt/hapi/hapi` is in place and `/var/lib/hapi` + `/work` are mounted:

```bash
sudo bash scripts/tooling/install-hapi-systemd-units.sh --profile fleet-binary \
    --enable
bash scripts/tooling/verify-hapi-systemd-units.sh
```

Override defaults when needed:

```bash
sudo bash scripts/tooling/install-hapi-systemd-units.sh --profile fleet-binary \
    --hapi-user hapi --hapi-home /var/lib/hapi --workspace-root /work
```

### Pet / external user (no sudo)

```bash
bash scripts/install-hapi-pet.sh --with-systemd
# or, after binary install:
bash scripts/tooling/install-hapi-systemd-units.sh --profile user-pet --enable
```

---

## Verify (kill criteria)

```bash
bash scripts/tooling/verify-hapi-systemd-units.sh
```

Expect:

- Runner **`KillMode=process`** (effective, not just base file)
- Hub **`OOMScoreAdjust=-1000`** (system profiles with Tier-1)
- Runner **`OOMScoreAdjust=0`** (never -1000 — agents inherit parent score)
- Runner **`Restart=always`** or `on-failure` per profile
- Runner **`ExecStartPre` runner-stop binary exists** — asserted, not just present; a stop pointing at a missing binary is worse than none (see above)
- Watchdog timer enabled on primary/fleet system installs

After `hapi-restart-hub`, archived session count should not spike from cgroup SIGTERM (see [`driver-soup.md`](./driver-soup.md) § KillMode).

---

## Lockhouse / bootstrap integration

`lockhouse-janus/scripts/bootstrap-oos-linux-hapi-hub.sh` should call this installer instead of inline heredocs. Fleet runbook `lockhouse-janus/docs/hapi-vm-bringup.md` must **not** recommend `KillMode=control-group` on the runner — that contradicts #915 and cascade-archives agents on restart.

Handoff tracked on fork issue (see operator AGENTS high-signal index).

---

## Related

- Tier-1 drop-ins only: `install-hapi-primary-hub-tier1.sh` (called automatically by system profiles)
- Estate migration: [`coding-estate-migration.md`](./coding-estate-migration.md)
- User-facing pet guide: [`docs/guide/pet-install.md`](../guide/pet-install.md)
- Upstream deployment snippets: [`docs/guide/deployment.md`](../guide/deployment.md) (user systemd — aligned with `user-pet` profile)
