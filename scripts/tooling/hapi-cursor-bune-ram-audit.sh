#!/usr/bin/env bash
# hapi-cursor-bune-ram-audit — dry-run reclaim auditor for Cursor `bun -e` wrappers.
#
# Remit (2026-11-09 Meta): the #1911 argv orphan reap (`orphanReap.ts`) cannot see
# Cursor launches whose identity is `startedBy: 'runner'` inside a `bun -e` script
# body (no `--started-by runner` argv token). This tool inventories that shape,
# classifies against the signed reclaim predicate, and never signals a process.
#
# Default: dry-run only. There is no --kill / --execute path in this script.
#
# Usage:
#   hapi-cursor-bune-ram-audit.sh
#   hapi-cursor-bune-ram-audit.sh --proc-json FILE --sessions-json FILE \
#       [--resume-json FILE] [--store-json FILE] [--config FILE] \
#       [--controls ID,ID,...] [--stale-days N]
#
# Fixture seams (tests / offline):
#   --proc-json      array of {pid, cmdline, environ, rss_kb, etimes, start_marker?}
#   --sessions-json  {sessions:[...]} OR { "<uuid>": {active, thinking, metadata, updatedAt} }
#   --resume-json    resume-processes list (same shape as ~/.hapi/runner.state.json.resume-processes.json)
#   --store-json     { "<cursorSessionId>": {"verdict":"OK"|"MISSING", "cause":"..."} }
#
# Exit: 0 gate ok (controls all NO; Cursor non-shape rule exercised) · 1 gate fail · 2 usage/infra.
set -euo pipefail

err() { echo "hapi-cursor-bune-ram-audit: $*" >&2; }
die() { err "$*"; exit 2; }

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
CONFIG="$ROOT/config/meta-sessions.yaml"
RESUME_JSON="${HAPI_RESUME_PROCESSES:-$HOME/.hapi/runner.state.json.resume-processes.json}"
PROC_JSON=""
SESSIONS_JSON=""
STORE_JSON=""
CONTROLS=""
STALE_DAYS=7
SELF_HUB_ID="${HAPI_SESSION_ID:-}"
HAPI_HOST="${HAPI_HOST:-http://localhost:3006}"
SETTINGS="${HAPI_SETTINGS:-$HOME/.hapi/settings.json}"

while [[ $# -gt 0 ]]; do
    case "$1" in
        --config) CONFIG="$2"; shift 2 ;;
        --resume-json) RESUME_JSON="$2"; shift 2 ;;
        --proc-json) PROC_JSON="$2"; shift 2 ;;
        --sessions-json) SESSIONS_JSON="$2"; shift 2 ;;
        --store-json) STORE_JSON="$2"; shift 2 ;;
        --controls) CONTROLS="$2"; shift 2 ;;
        --stale-days) STALE_DAYS="$2"; shift 2 ;;
        --self) SELF_HUB_ID="$2"; shift 2 ;;
        --help|-h) sed -n '2,28p' "$0"; exit 0 ;;
        *) die "unexpected arg: $1" ;;
    esac
done

command -v python3 >/dev/null || die "python3 not on PATH"
command -v yq >/dev/null || die "yq not on PATH"
command -v jq >/dev/null || die "jq not on PATH"
[[ -f "$CONFIG" ]] || die "config not found: $CONFIG"

export HAPI_CURSOR_BUNE_AUDIT_ROOT="$ROOT"
export HAPI_CURSOR_BUNE_AUDIT_CONFIG="$CONFIG"
export HAPI_CURSOR_BUNE_AUDIT_RESUME="$RESUME_JSON"
export HAPI_CURSOR_BUNE_AUDIT_PROC_JSON="$PROC_JSON"
export HAPI_CURSOR_BUNE_AUDIT_SESSIONS_JSON="$SESSIONS_JSON"
export HAPI_CURSOR_BUNE_AUDIT_STORE_JSON="$STORE_JSON"
export HAPI_CURSOR_BUNE_AUDIT_CONTROLS="$CONTROLS"
export HAPI_CURSOR_BUNE_AUDIT_STALE_DAYS="$STALE_DAYS"
export HAPI_CURSOR_BUNE_AUDIT_SELF="$SELF_HUB_ID"
export HAPI_CURSOR_BUNE_AUDIT_HOST="$HAPI_HOST"
export HAPI_CURSOR_BUNE_AUDIT_SETTINGS="$SETTINGS"

python3 - <<'PY'
from __future__ import annotations

import hashlib
import json
import os
import re
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path
from typing import Any

UUID_RE = re.compile(
    r"[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}",
    re.I,
)
EXISTING_SID_RE = re.compile(
    r"existingSessionId:\s*['\"]([0-9a-f-]{36})['\"]",
    re.I,
)

ROOT = Path(os.environ["HAPI_CURSOR_BUNE_AUDIT_ROOT"])
CONFIG = Path(os.environ["HAPI_CURSOR_BUNE_AUDIT_CONFIG"])
RESUME_PATH = Path(os.environ["HAPI_CURSOR_BUNE_AUDIT_RESUME"])
PROC_JSON = os.environ.get("HAPI_CURSOR_BUNE_AUDIT_PROC_JSON") or ""
SESSIONS_JSON = os.environ.get("HAPI_CURSOR_BUNE_AUDIT_SESSIONS_JSON") or ""
STORE_JSON = os.environ.get("HAPI_CURSOR_BUNE_AUDIT_STORE_JSON") or ""
CONTROLS_RAW = os.environ.get("HAPI_CURSOR_BUNE_AUDIT_CONTROLS") or ""
STALE_DAYS = int(os.environ.get("HAPI_CURSOR_BUNE_AUDIT_STALE_DAYS") or "7")
SELF_ID = (os.environ.get("HAPI_CURSOR_BUNE_AUDIT_SELF") or "").strip()
HOST = os.environ.get("HAPI_CURSOR_BUNE_AUDIT_HOST") or "http://localhost:3006"
SETTINGS = Path(os.environ.get("HAPI_CURSOR_BUNE_AUDIT_SETTINGS") or "")

STALE_MS = STALE_DAYS * 86400 * 1000
NOW_MS = int(time.time() * 1000)

# --- registry protect (live ids + non-404 superseded; 404 checked later) ---


def load_registry(path: Path) -> dict[str, Any]:
    # Prefer yq for yaml (house standard); fall back to trivial parse if needed.
    import subprocess

    raw = subprocess.check_output(
        ["yq", "-o=json", ".", str(path)],
        text=True,
    )
    return json.loads(raw)


REGISTRY = load_registry(CONFIG)
REG_LIVE: set[str] = set()
REG_SUPERSEDED: set[str] = set()
for _key, entry in (REGISTRY.get("sessions") or {}).items():
    if not isinstance(entry, dict):
        continue
    lid = (entry.get("id") or "").strip()
    if lid:
        REG_LIVE.add(lid)
    sid = (entry.get("superseded") or "").strip()
    if sid:
        REG_SUPERSEDED.add(sid)

# --- hub auth / resolve ---

JWT = None
SESSIONS_FIXTURE: dict[str, Any] | None = None
if SESSIONS_JSON:
    blob = json.loads(Path(SESSIONS_JSON).read_text())
    if isinstance(blob, dict) and isinstance(blob.get("sessions"), list):
        SESSIONS_FIXTURE = {s["id"]: s for s in blob["sessions"] if "id" in s}
    elif isinstance(blob, dict):
        SESSIONS_FIXTURE = blob
    else:
        print("hapi-cursor-bune-ram-audit: bad --sessions-json shape", file=sys.stderr)
        sys.exit(2)
else:
    if not SETTINGS.is_file():
        print(f"hapi-cursor-bune-ram-audit: settings not found: {SETTINGS}", file=sys.stderr)
        sys.exit(2)
    settings = json.loads(SETTINGS.read_text())
    token = settings.get("cliApiToken") or ""
    if not token:
        print("hapi-cursor-bune-ram-audit: no cliApiToken in settings", file=sys.stderr)
        sys.exit(2)
    req = urllib.request.Request(
        f"{HOST}/api/auth",
        data=json.dumps({"accessToken": f"{token}:default"}).encode(),
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    try:
        JWT = json.load(urllib.request.urlopen(req, timeout=10))["token"]
    except Exception as e:
        print(f"hapi-cursor-bune-ram-audit: auth failed: {e}", file=sys.stderr)
        sys.exit(2)


def hub_get(session_id: str) -> tuple[str, dict[str, Any] | None]:
    """Return (status, session_or_none). status: ok|absent|error."""
    if SESSIONS_FIXTURE is not None:
        row = SESSIONS_FIXTURE.get(session_id)
        if row is None:
            return "absent", None
        # Normalise fixture to look like API session object.
        if "metadata" in row or "active" in row:
            return "ok", row
        return "ok", {"id": session_id, "metadata": row, "active": row.get("active", False)}
    assert JWT
    req = urllib.request.Request(
        f"{HOST}/api/sessions/{session_id}",
        headers={"Authorization": f"Bearer {JWT}"},
    )
    try:
        with urllib.request.urlopen(req, timeout=10) as resp:
            body = json.load(resp)
            return "ok", body.get("session") or body
    except urllib.error.HTTPError as e:
        if e.code == 404:
            return "absent", None
        return "error", {"error": f"HTTP {e.code}"}
    except Exception as e:
        return "error", {"error": str(e)}


# Resolve which superseded ids are still present (non-404) → protect.
PROTECT: set[str] = set(REG_LIVE)
for sid in sorted(REG_SUPERSEDED):
    st, _ = hub_get(sid)
    if st == "ok":
        PROTECT.add(sid)
    # 404 → not protect (gone); error → fail closed: protect
    elif st == "error":
        PROTECT.add(sid)

# --- resume map ---

RESUME: list[dict[str, Any]] = []
if RESUME_PATH.is_file():
    RESUME = json.loads(RESUME_PATH.read_text())
    if not isinstance(RESUME, list):
        print("hapi-cursor-bune-ram-audit: resume-json must be a list", file=sys.stderr)
        sys.exit(2)

RESUME_BY_PID = {int(e["pid"]): e for e in RESUME if "pid" in e}


def resume_match(pid: int, session_id: str, start_marker: str | None) -> bool:
    e = RESUME_BY_PID.get(pid)
    if not e:
        return False
    sid_ok = session_id in {
        e.get("requestedSessionId"),
        e.get("confirmedSessionId"),
    }
    if not sid_ok:
        return False
    expected = e.get("processStartMarker")
    if expected is None or start_marker is None:
        # Fail closed for reclaim YES: treat as tracked if pid+sid match.
        return True
    return expected == start_marker


# --- store census (minimal) ---

STORE_FIXTURE: dict[str, Any] | None = None
if STORE_JSON:
    STORE_FIXTURE = json.loads(Path(STORE_JSON).read_text())


def store_status(cursor_session_id: str | None, path: str | None, home: str | None) -> dict[str, str]:
    if not cursor_session_id:
        return {"verdict": "UNKNOWN", "cause": "no_cursor_session_id"}
    if STORE_FIXTURE is not None:
        row = STORE_FIXTURE.get(cursor_session_id) or STORE_FIXTURE.get(cursor_session_id.lower())
        if not row:
            return {"verdict": "MISSING", "cause": "fixture_absent"}
        return {
            "verdict": row.get("verdict") or "MISSING",
            "cause": row.get("cause") or "",
        }
    home = home or str(Path.home())
    path = path or ""
    acp = Path(home) / ".cursor" / "acp-sessions" / cursor_session_id / "store.db"
    if acp.is_file():
        # Mid-write heuristic: WAL present AND recently modified while still "busy"
        # is reported as BUSY; a plain WAL alongside a quiescent db is still OK
        # for dry-run (execute path must re-check).
        wal = acp.with_name("store.db-wal")
        if wal.is_file():
            age = time.time() - wal.stat().st_mtime
            if age < 2.0:
                return {"verdict": "BUSY", "cause": "wal_recent"}
        return {"verdict": "OK", "cause": "acp"}
    if path:
        drawer = hashlib.md5(path.encode()).hexdigest()
        legacy = Path(home) / ".cursor" / "chats" / drawer / cursor_session_id / "store.db"
        if legacy.is_file():
            return {"verdict": "OK", "cause": "legacy_hash"}
    thread = Path(home) / ".cursor" / "acp-sessions" / cursor_session_id
    if thread.is_dir():
        return {"verdict": "MISSING", "cause": "never_persisted"}
    return {"verdict": "MISSING", "cause": "removed"}


# --- process inventory ---


def is_bune_wrapper(cmdline: str) -> bool:
    # Cursor bun -e session host: bun … -e … runCursor / existingSessionId
    if "bun" not in cmdline:
        return False
    parts = cmdline.split("\0") if "\0" in cmdline else cmdline.split()
    has_e = "-e" in parts or re.search(r"(?:^|\s)-e(?:\s|$)", cmdline) is not None
    if not has_e:
        # Joined cmdline: first segment often ends with -e before the script body
        first = cmdline.split("\n", 1)[0]
        has_e = first.rstrip().endswith("-e") or " -e " in f" {first} "
    if not has_e:
        return False
    return ("runCursor" in cmdline) or ("existingSessionId" in cmdline)


def extract_sid(environ: dict[str, str], cmdline: str) -> str | None:
    sid = (environ.get("HAPI_SESSION_ID") or "").strip()
    if sid and UUID_RE.fullmatch(sid):
        return sid
    # Identity canon is environ; cmdline existingSessionId is discovery-only
    # annotation when env export has not landed (pre-bootstrap). Not used for YES.
    return None


def extract_sid_from_script(cmdline: str) -> str | None:
    m = EXISTING_SID_RE.search(cmdline)
    return m.group(1) if m else None


def live_proc_scan() -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    for entry in Path("/proc").iterdir():
        if not entry.name.isdigit():
            continue
        pid = int(entry.name)
        try:
            raw_cmd = (entry / "cmdline").read_bytes()
        except (PermissionError, FileNotFoundError, ProcessLookupError):
            continue
        if not raw_cmd:
            continue
        cmdline = raw_cmd.replace(b"\0", b" ").decode(errors="replace").strip()
        if not is_bune_wrapper(cmdline):
            continue
        environ: dict[str, str] = {}
        try:
            for item in (entry / "environ").read_bytes().split(b"\0"):
                if b"=" in item:
                    k, v = item.split(b"=", 1)
                    environ[k.decode(errors="replace")] = v.decode(errors="replace")
        except (PermissionError, FileNotFoundError, ProcessLookupError):
            environ = {}
        try:
            status = (entry / "status").read_text()
            rss_kb = int(status.split("VmRSS:")[1].split()[0])
        except Exception:
            rss_kb = 0
        try:
            # etimes via /proc/stat starttime + btime
            stat = (entry / "stat").read_text()
            # comm can contain spaces/parens — split after last ')'
            after = stat[stat.rfind(")") + 2 :].split()
            startticks = int(after[19])  # field 22
            hz = os.sysconf(os.sysconf_names["SC_CLK_TCK"])
            btime = int(
                next(
                    line.split()[1]
                    for line in Path("/proc/stat").read_text().splitlines()
                    if line.startswith("btime ")
                )
            )
            etimes = int(time.time()) - (btime + startticks // hz)
        except Exception:
            etimes = 0
        start_marker = None
        # Prefer resume map marker when pid matches; else leave None
        if pid in RESUME_BY_PID:
            start_marker = RESUME_BY_PID[pid].get("processStartMarker")
        rows.append(
            {
                "pid": pid,
                "cmdline": cmdline,
                "environ": environ,
                "rss_kb": rss_kb,
                "etimes": etimes,
                "start_marker": start_marker,
            }
        )
    return rows


if PROC_JSON:
    PROCS = json.loads(Path(PROC_JSON).read_text())
    if not isinstance(PROCS, list):
        print("hapi-cursor-bune-ram-audit: --proc-json must be a list", file=sys.stderr)
        sys.exit(2)
else:
    PROCS = live_proc_scan()

# --- classify ---

HUB_CACHE: dict[str, tuple[str, dict[str, Any] | None]] = {}


def get_hub(session_id: str) -> tuple[str, dict[str, Any] | None]:
    if session_id not in HUB_CACHE:
        HUB_CACHE[session_id] = hub_get(session_id)
    return HUB_CACHE[session_id]


def age_days_fixed(updated_at: Any) -> float | None:
    if updated_at is None:
        return None
    try:
        ts = int(updated_at)
    except (TypeError, ValueError):
        return None
    if ts < 10_000_000_000:
        ts *= 1000
    return (NOW_MS - ts) / (86400 * 1000)


def classify(proc: dict[str, Any], *, force_sid: str | None = None) -> dict[str, Any]:
    """Return status yes|no, failed rule ids, evidence. Archive-alive is annotation only."""
    failed: list[str] = []
    notes: list[str] = []
    pid = int(proc["pid"])
    cmdline = proc.get("cmdline") or ""
    environ = proc.get("environ") or {}
    rss_kb = int(proc.get("rss_kb") or 0)
    etimes = int(proc.get("etimes") or 0)
    start_marker = proc.get("start_marker")

    sid = force_sid or extract_sid(environ, cmdline)
    script_sid = extract_sid_from_script(cmdline)
    if not sid:
        failed.append("R1-no-environ-sid")
        if script_sid:
            notes.append(f"script_sid={script_sid[:8]} (not used for YES)")

    shape_ok = is_bune_wrapper(cmdline)
    if not shape_ok:
        failed.append("R2-shape")

    tracked = False
    if sid:
        tracked = resume_match(pid, sid, start_marker)
        # Also treat pid present in resume with matching requested/confirmed id
        if not tracked and pid in RESUME_BY_PID:
            e = RESUME_BY_PID[pid]
            if sid in {e.get("requestedSessionId"), e.get("confirmedSessionId")}:
                tracked = True
    if tracked:
        failed.append("R3-tracked")

    hub_status = "skipped"
    session: dict[str, Any] | None = None
    active = None
    thinking = None
    lifecycle = None
    flavor = None
    name = None
    updated_at = None
    cursor_sid = None
    path = None
    started_by = None
    if sid:
        hub_status, session = get_hub(sid)
        if hub_status == "error":
            failed.append("R4-hub-error")
        elif hub_status == "absent":
            # 404 counts as stale-enough for R5, but still need other YES rules
            notes.append("hub=404")
        else:
            assert session is not None
            meta = session.get("metadata") or {}
            active = session.get("active")
            thinking = session.get("thinking")
            lifecycle = meta.get("lifecycleState")
            flavor = meta.get("flavor") or meta.get("agent")
            name = meta.get("name")
            updated_at = session.get("updatedAt") or meta.get("updatedAt")
            cursor_sid = meta.get("cursorSessionId")
            path = meta.get("path")
            started_by = meta.get("startedBy")
            if active is not False:
                failed.append("R4-active")
            age = age_days_fixed(updated_at)
            stale_ok = hub_status == "absent" or (age is not None and age >= STALE_DAYS)
            if not stale_ok:
                failed.append("R5-fresh")
            if lifecycle == "archived":
                notes.append("archive-alive-annotation-only")
            if sid in PROTECT:
                failed.append("R6-protect")
            if thinking is True:
                # classify-time note; execute fence is R7
                notes.append("thinking=true-at-classify")
                failed.append("R7-thinking-classify")

    store = store_status(cursor_sid, path, environ.get("HOME"))
    if flavor == "cursor" or (shape_ok and "runCursor" in cmdline):
        if store["verdict"] == "BUSY":
            failed.append("R8-store-busy")
        elif store["verdict"] not in {"OK", "MISSING"} or (
            store["verdict"] == "MISSING" and store["cause"] not in {"never_persisted", "fixture_absent", "removed"}
        ):
            # MISSING/never_persisted is allowed; OK allowed; BUSY already handled
            if store["verdict"] == "UNKNOWN":
                failed.append("R8-store-unknown")
        # never_persisted / OK pass R8

    # Launcher hint for Meta's prevention half
    launcher = "unknown"
    if "hapi-safe-revive" in cmdline:
        launcher = "hapi-safe-revive-session"
    elif "hapi-claude-rebind" in cmdline:
        launcher = "hapi-claude-rebind-session"
    elif shape_ok and "runCursor" in cmdline and "startedBy: 'runner'" in cmdline:
        launcher = "bun-e-runCursor-startedBy-runner-in-script"

    status = "yes" if not failed else "no"
    return {
        "status": status,
        "failed": failed,
        "notes": notes,
        "pid": pid,
        "session_id": sid,
        "script_sid": script_sid,
        "rss_kb": rss_kb,
        "rss_mib": round(rss_kb / 1024, 1),
        "etimes": etimes,
        "tracked": tracked,
        "hub_status": hub_status,
        "active": active,
        "thinking": thinking,
        "lifecycle": lifecycle,
        "flavor": flavor,
        "name": name,
        "updated_at": updated_at,
        "age_days": round(age_days_fixed(updated_at), 2) if age_days_fixed(updated_at) is not None else None,
        "cursor_session_id": cursor_sid,
        "started_by": started_by,
        "store": store,
        "launcher": launcher,
        "start_marker": start_marker,
        "shape_bune": shape_ok,
    }


# Classify inventory
results = [classify(p) for p in PROCS]
results.sort(key=lambda r: (-(r["rss_kb"] or 0), r["pid"]))

# Controls
DEFAULT_CONTROLS = []
if SELF_ID:
    DEFAULT_CONTROLS.append(SELF_ID)
DEFAULT_CONTROLS.extend(sorted(REG_LIVE))
# Meta-named extras (Cursor live peers that must stay NO)
for extra in (
    "5d5d200a-a340-4b31-bd26-2c2668e6cf67",
    "ad24ecf0-6367-4eb2-ac0d-10ef870c7414",
    "4230142b-0000-0000-0000-000000000000",  # may 404; still listed if --controls overrides
):
    pass
# Prefer resolving short prefixes from resume map for 5d5d / ad24 / overseer
PREFIX_CONTROLS = ["5d5d200a", "ad24ecf0", "4230142b"]
resolved_extras: list[str] = []
for pref in PREFIX_CONTROLS:
    hit = next(
        (
            e.get("requestedSessionId")
            for e in RESUME
            if str(e.get("requestedSessionId", "")).startswith(pref)
            or str(e.get("confirmedSessionId", "")).startswith(pref)
        ),
        None,
    )
    if hit:
        resolved_extras.append(hit)

if CONTROLS_RAW.strip():
    control_ids = [c.strip() for c in CONTROLS_RAW.split(",") if c.strip()]
else:
    control_ids = []
    seen: set[str] = set()
    for c in DEFAULT_CONTROLS + resolved_extras:
        if c and c not in seen:
            seen.add(c)
            control_ids.append(c)


def procs_for_session(session_id: str) -> list[dict[str, Any]]:
    out = []
    for p in PROCS:
        env = p.get("environ") or {}
        if env.get("HAPI_SESSION_ID") == session_id:
            out.append(p)
            continue
        # argv --hapi-session-id (not bun -e, but control may need it)
        cmd = p.get("cmdline") or ""
        if session_id in cmd:
            out.append(p)
    # Also synthesize from resume map when live inventory is bun-e-only
    for e in RESUME:
        if session_id in {e.get("requestedSessionId"), e.get("confirmedSessionId")}:
            pid = int(e["pid"])
            if any(int(p["pid"]) == pid for p in out):
                continue
            # Build a synthetic proc from /proc if live mode
            if PROC_JSON:
                continue
            try:
                raw = Path(f"/proc/{pid}/cmdline").read_bytes()
                cmdline = raw.replace(b"\0", b" ").decode(errors="replace")
                environ: dict[str, str] = {}
                try:
                    for item in Path(f"/proc/{pid}/environ").read_bytes().split(b"\0"):
                        if b"=" in item:
                            k, v = item.split(b"=", 1)
                            environ[k.decode(errors="replace")] = v.decode(errors="replace")
                except Exception:
                    pass
                try:
                    rss_kb = int(Path(f"/proc/{pid}/status").read_text().split("VmRSS:")[1].split()[0])
                except Exception:
                    rss_kb = 0
                out.append(
                    {
                        "pid": pid,
                        "cmdline": cmdline,
                        "environ": environ,
                        "rss_kb": rss_kb,
                        "etimes": 0,
                        "start_marker": e.get("processStartMarker"),
                    }
                )
            except Exception:
                continue
    return out


control_rows: list[dict[str, Any]] = []
for cid in control_ids:
    matched = procs_for_session(cid)
    if not matched:
        # Hub-only control row (no process) — still must be NO
        st, session = get_hub(cid)
        flavor = None
        active = None
        name = None
        if session:
            meta = session.get("metadata") or {}
            flavor = meta.get("flavor") or meta.get("agent")
            active = session.get("active")
            name = meta.get("name")
        failed = ["R2-no-process"]
        if cid in PROTECT:
            failed.append("R6-protect")
        if active is not False and st == "ok":
            failed.append("R4-active")
        control_rows.append(
            {
                "control_id": cid,
                "status": "no",
                "failed": failed,
                "pid": None,
                "flavor": flavor,
                "active": active,
                "name": name,
                "shape_bune": False,
                "hub_status": st,
            }
        )
        continue
    for p in matched:
        row = classify(p, force_sid=cid if not extract_sid(p.get("environ") or {}, p.get("cmdline") or "") else None)
        # If environ missing sid but we know control id, re-classify with force
        if row["session_id"] is None:
            row = classify({**p, "environ": {**(p.get("environ") or {}), "HAPI_SESSION_ID": cid}})
        row["control_id"] = cid
        control_rows.append(row)


# --- gate ---
gate_fail: list[str] = []

# 1. Every control NO
for row in control_rows:
    if row["status"] == "yes":
        gate_fail.append(
            f"control {row.get('control_id','?')[:8]} pid={row.get('pid')} would YES"
        )

# 2. At least one live Cursor control with a non-R2 failed rule
cursor_controls = [
    r
    for r in control_rows
    if (r.get("flavor") == "cursor")
    or (SELF_ID and r.get("control_id") == SELF_ID)
    or (r.get("shape_bune") and "runCursor" in str(r))
]
# Prefer flavor from hub
non_shape_cursor = False
cursor_seen = False
for r in control_rows:
    cid = r.get("control_id") or ""
    flav = r.get("flavor")
    if flav is None and cid:
        st, session = get_hub(cid)
        if session:
            meta = session.get("metadata") or {}
            flav = meta.get("flavor") or meta.get("agent")
            r["flavor"] = flav
    if flav != "cursor" and not (SELF_ID and cid == SELF_ID):
        continue
    cursor_seen = True
    failed = r.get("failed") or []
    if any(f for f in failed if not f.startswith("R2")):
        non_shape_cursor = True

if not cursor_seen:
    gate_fail.append("no Cursor control subject evaluated")
if not non_shape_cursor:
    gate_fail.append(
        "no Cursor control excluded by liveness/registry/tracking "
        "(only R2-shape would be vacuous)"
    )

# 3. Among bun-e inventory, silent drops forbidden — every row has failed or yes
for r in results:
    if r["status"] == "no" and not r["failed"]:
        gate_fail.append(f"pid {r['pid']} NO without rule id")

# --- output ---
print("=== hapi-cursor-bune-ram-audit (DRY-RUN) ===")
print(f"stale_days={STALE_DAYS}  bun_e_wrappers={len(results)}  controls={len(control_rows)}")
print(f"protect_ids={len(PROTECT)} (registry live + non-404 superseded)")
print()

print("--- CONTROLS (must all be NO; Cursor must show a non-R2 rule) ---")
for r in control_rows:
    cid = (r.get("control_id") or "?")
    rules = ",".join(r.get("failed") or []) or "?"
    print(
        f"CONTROL {cid}  pid={r.get('pid')}  flavor={r.get('flavor')}  "
        f"active={r.get('active')}  bune={r.get('shape_bune')}  "
        f"status={r.get('status')}  rules={rules}  name={(r.get('name') or '')[:50]}"
    )
print()

print("--- EXCLUDED bun -e wrappers (rule ids) ---")
excl = [r for r in results if r["status"] == "no"]
for r in excl:
    rules = ",".join(r["failed"])
    print(
        f"EXCLUDE pid={r['pid']}  sid={(r.get('session_id') or '?')[:8]}  "
        f"rss_MiB={r['rss_mib']}  active={r.get('active')}  life={r.get('lifecycle')}  "
        f"age_d={r.get('age_days')}  store={r['store'].get('verdict')}/{r['store'].get('cause')}  "
        f"rules={rules}  launcher={r.get('launcher')}  name={(r.get('name') or '')[:40]}"
    )
if not excl and results:
    print("(none)")
if not results:
    print("(no bun -e wrappers found)")
print()

print("--- CANDIDATES (would reclaim; empty unless ownership gap + active=false + stale) ---")
cands = [r for r in results if r["status"] == "yes"]
for r in cands:
    print(
        f"CANDIDATE pid={r['pid']}  sid={r.get('session_id')}  flavor={r.get('flavor')}  "
        f"active={r.get('active')}  life={r.get('lifecycle')}  age_d={r.get('age_days')}  "
        f"rss_MiB={r['rss_mib']}  etimes={r.get('etimes')}  "
        f"store={r['store'].get('verdict')}/{r['store'].get('cause')}  "
        f"launcher={r.get('launcher')}  name={(r.get('name') or '')[:50]}"
    )
if not cands:
    print("(none)")
print()

# Load-bearing excludes: exactly one failed rule — a day's drift away from candidacy.
print("--- SINGLE-RULE-EXCLUDE (load-bearing; drift watch) ---")
single = [r for r in excl if len(r.get("failed") or []) == 1]
for r in single:
    print(
        f"SINGLE pid={r['pid']}  sid={(r.get('session_id') or '?')[:8]}  "
        f"rule={r['failed'][0]}  active={r.get('active')}  age_d={r.get('age_days')}  "
        f"name={(r.get('name') or '')[:40]}"
    )
if not single:
    print("(none — every exclude has ≥2 rules)")
print()

# Launcher rollup for Meta prevention half
launchers: dict[str, int] = {}
for r in results:
    launchers[r.get("launcher") or "unknown"] = launchers.get(r.get("launcher") or "unknown", 0) + 1
print("--- launcher shapes (prevention is Meta's; audit only) ---")
for k, v in sorted(launchers.items(), key=lambda kv: -kv[1]):
    print(f"  {k}: {v}")
print()

if gate_fail:
    print("--- GATE FAIL ---")
    for g in gate_fail:
        print(f"GATE: {g}")
    sys.exit(1)

print("--- GATE OK ---")
print("All controls NO; at least one Cursor control excluded by a non-R2 rule.")
print("Dry-run only — no signals sent. #1911 argv reap / orphanReap.ts unchanged.")
sys.exit(0)
PY
