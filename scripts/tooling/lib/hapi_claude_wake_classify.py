#!/usr/bin/env python3
"""Classify Claude sessions for post-auth-cutover continue wakes.

History: broader heuristics (lastNotify attention, usage-limit transcript
text, trailing user turns) produced dozens of "nothing to resume" replies
every cutover. Operator feedback 2026-11-10: those determinations suck.

Default mode **thinking**: wake ONLY if session.thinking was true at
pre-kill snapshot — the one signal that means a turn was actually in flight
when we killed the process.

Modes:
  thinking   (default) — thinking=true only
  attention  — also lastNotify in blocked/needs_*/failed/stalled
  aggressive — attention + usage-limit-latest + pending user (legacy; avoid)

Snapshot BEFORE kill/archive. Exit 0. Prints JSON:
  {"wake":[{"id","reason","name"}], "skip":[...], "counts":{...}, "mode": "..."}
"""
from __future__ import annotations

import json
import os
import re
import sys
import urllib.request

LIMIT_RE = re.compile(
    r"session limit|usage limit|rate limit|you've hit your|resets \d",
    re.I,
)
ATTENTION = frozenset(
    {"blocked", "needs_decision", "needs_review", "failed", "stalled"}
)
DONEISH = frozenset({"done", "idle"})
WAKE_SKIP_FILE = os.path.expanduser("~/.hapi/claude-auth/wake-skip")
VALID_MODES = frozenset({"thinking", "attention", "aggressive"})


def load_wake_skip_ids() -> set[str]:
    try:
        lines = open(WAKE_SKIP_FILE).read().splitlines()
    except OSError:
        return set()
    out = set()
    for line in lines:
        line = line.split("#", 1)[0].strip()
        if line:
            out.add(line)
    return out


def is_wake_skipped(sid: str, skip: set[str]) -> bool:
    if sid in skip:
        return True
    return any(sid.startswith(p) for p in skip if len(p) >= 8)


def hub_jwt(host: str) -> str:
    settings = json.load(open(os.path.expanduser("~/.hapi/settings.json")))
    req = urllib.request.Request(
        host + "/api/auth",
        data=json.dumps({"accessToken": settings["cliApiToken"] + ":default"}).encode(),
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    return json.loads(urllib.request.urlopen(req, timeout=15).read())["token"]


def get(host: str, jwt: str, path: str):
    r = urllib.request.Request(
        host + path, headers={"Authorization": f"Bearer {jwt}"}
    )
    return json.loads(urllib.request.urlopen(r, timeout=30).read())


def walk_text(obj, depth=0, out=None):
    if out is None:
        out = []
    if depth > 8:
        return out
    if isinstance(obj, str):
        if len(obj) > 8:
            out.append(obj)
        return out
    if isinstance(obj, dict):
        for v in obj.values():
            walk_text(v, depth + 1, out)
    elif isinstance(obj, list):
        for v in obj[:30]:
            walk_text(v, depth + 1, out)
    return out


def message_role(m) -> str | None:
    if m.get("role"):
        return m["role"]
    c = m.get("content")
    if isinstance(c, dict) and c.get("role"):
        return c["role"]
    return m.get("type")


def _is_cutover_continue(body: str) -> bool:
    b = body.lower()
    return (
        "auth was rotated" in b
        or "interrupted mid-flight" in b
        or "ack — stopping" in b
        or (b.lstrip().startswith("continue.") and "claude slot" in b)
    )


def _is_meaningful_agent_body(body: str) -> bool:
    if LIMIT_RE.search(body):
        return True
    letters = sum(c.isalpha() for c in body)
    spaces = body.count(" ")
    return letters >= 40 and spaces >= 5


def classify_session(
    host: str, jwt: str, sid: str, detail: dict, mode: str
) -> tuple[str, str]:
    md = detail.get("metadata") or {}
    thinking = bool(detail.get("thinking"))
    lifecycle = md.get("lifecycleState") or detail.get("lifecycleState")
    last_notify = detail.get("lastNotify") or {}
    notify_status = last_notify.get("status") if isinstance(last_notify, dict) else None

    if thinking:
        return "wake", "thinking"

    if mode == "thinking":
        return "skip", f"not-thinking notify={notify_status or 'none'}"

    # attention / aggressive
    if notify_status in ATTENTION:
        return "wake", f"lastNotify={notify_status}"

    if notify_status in DONEISH:
        return "skip", f"lastNotify={notify_status}"

    if lifecycle == "idle":
        return "skip", "lifecycle-idle"

    if mode == "attention":
        return "skip", f"quiet notify={notify_status or 'none'}"

    # aggressive (legacy) — keep available but do not default
    try:
        msgs = get(host, jwt, f"/api/sessions/{sid}/messages?limit=20").get("messages") or []
    except Exception:
        msgs = []

    last_userish = False
    saw_our_continue = False
    agent_after_our_continue = False
    last_agent_meaningful = None
    for m in msgs:
        body = "\n".join(walk_text(m))
        role = message_role(m)
        if role == "user" and body.strip():
            if _is_cutover_continue(body):
                saw_our_continue = True
                last_userish = False
            else:
                last_userish = True
        elif role == "agent" and body.strip():
            if _is_meaningful_agent_body(body):
                last_agent_meaningful = body
                if saw_our_continue:
                    agent_after_our_continue = True
            last_userish = False

    if agent_after_our_continue:
        return "skip", "already-replied-to-continue"
    if last_agent_meaningful and LIMIT_RE.search(last_agent_meaningful):
        return "wake", "usage-limit-text"
    if last_userish:
        return "wake", "awaiting-agent-after-user"
    return "skip", f"quiet notify={notify_status or 'none'}"


def classify_active_claude(
    host: str,
    self_id: str = "",
    only_ids: set[str] | None = None,
    mode: str = "thinking",
):
    if mode not in VALID_MODES:
        raise ValueError(f"mode must be one of {sorted(VALID_MODES)}")
    jwt = hub_jwt(host)
    wake, skip = [], []
    wake_skip = load_wake_skip_ids()
    for s in get(host, jwt, "/api/sessions?limit=500")["sessions"]:
        if not s.get("active"):
            continue
        md = s.get("metadata") or {}
        if md.get("flavor") != "claude":
            continue
        if self_id and s["id"] == self_id:
            continue
        if only_ids is not None and s["id"] not in only_ids:
            continue
        if is_wake_skipped(s["id"], wake_skip):
            skip.append(
                {
                    "id": s["id"],
                    "reason": "wake-skip-file",
                    "name": (md.get("name") or "?")[:50],
                }
            )
            continue
        detail = get(host, jwt, f"/api/sessions/{s['id']}").get("session", s)
        action, reason = classify_session(host, jwt, s["id"], detail, mode)
        row = {
            "id": s["id"],
            "reason": reason,
            "name": ((detail.get("metadata") or {}).get("name") or "?")[:50],
        }
        (wake if action == "wake" else skip).append(row)
    return {
        "mode": mode,
        "wake": wake,
        "skip": skip,
        "counts": {"wake": len(wake), "skip": len(skip)},
    }


def main(argv: list[str]) -> int:
    host = os.environ.get("HAPI_HOST", "http://127.0.0.1:3006")
    self_id = os.environ.get("HAPI_SESSION_ID", "")
    mode = os.environ.get("HAPI_CLAUDE_WAKE_MODE", "thinking")
    only_ids = None
    ids_file = None
    i = 1
    while i < len(argv):
        if argv[i] == "--ids-file":
            ids_file = argv[i + 1]
            i += 2
        elif argv[i] == "--host":
            host = argv[i + 1]
            i += 2
        elif argv[i] == "--mode":
            mode = argv[i + 1]
            i += 2
        else:
            print(f"unknown arg: {argv[i]}", file=sys.stderr)
            return 2
    if mode not in VALID_MODES:
        print(f"bad --mode {mode}; want {sorted(VALID_MODES)}", file=sys.stderr)
        return 2
    if ids_file:
        only_ids = {
            line.strip()
            for line in open(ids_file)
            if line.strip() and not line.startswith("#")
        }
    result = classify_active_claude(
        host, self_id=self_id, only_ids=only_ids, mode=mode
    )
    json.dump(result, sys.stdout, indent=2)
    sys.stdout.write("\n")
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv))
