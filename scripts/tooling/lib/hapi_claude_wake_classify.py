#!/usr/bin/env python3
"""Classify Claude sessions for post-auth-cutover continue wakes.

Blindly continue-pinging every active Claude after reopen floods the operator
with "I didn't need that" replies from sessions that had already finished.

Wake only when pre-cutover state says the agent was interrupted mid-flight or
still needs attention. Snapshot BEFORE kill/archive — after reopen, thinking
and lastNotify are contaminated by the wake itself.

Signals (hub API):
  - session.thinking
  - session.lastNotify.status  (persisted AGENT_NOTIFY_SUMMARY)
  - metadata.lifecycleState
  - recent messages: usage/session limit text; trailing user message

Exit 0 always when classification succeeds. Prints JSON to stdout:
  {"wake":[{"id","reason","name"}], "skip":[...], "counts":{...}}
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


def classify_session(host: str, jwt: str, sid: str, detail: dict) -> tuple[str, str]:
    """Return (action, reason) where action is wake|skip."""
    md = detail.get("metadata") or {}
    thinking = bool(detail.get("thinking"))
    lifecycle = md.get("lifecycleState") or detail.get("lifecycleState")
    last_notify = detail.get("lastNotify") or {}
    notify_status = last_notify.get("status") if isinstance(last_notify, dict) else None
    name = (md.get("name") or "?")[:60]

    if thinking:
        return "wake", "thinking"

    if notify_status in ATTENTION:
        return "wake", f"lastNotify={notify_status}"

    # Message scrape for usage-limit wedge + trailing user turn.
    try:
        msgs = get(host, jwt, f"/api/sessions/{sid}/messages?limit=12").get("messages") or []
    except Exception:
        msgs = []

    saw_limit = False
    last_userish = False
    for m in msgs:
        body = "\n".join(walk_text(m))
        if LIMIT_RE.search(body):
            saw_limit = True
        role = message_role(m)
        if role == "user" and body.strip() and "Auth was rotated" not in body:
            last_userish = True
        elif role == "agent" and body.strip():
            last_userish = False

    if saw_limit:
        return "wake", "usage-limit-text"

    if last_userish:
        return "wake", "awaiting-agent-after-user"

    if notify_status in DONEISH:
        return "skip", f"lastNotify={notify_status}"

    if lifecycle == "idle":
        return "skip", "lifecycle-idle"

    # Quiet running session with no attention notify — do not spam.
    return "skip", f"quiet notify={notify_status or 'none'} lifecycle={lifecycle or '?'}"


def classify_active_claude(host: str, self_id: str = "", only_ids: set[str] | None = None):
    jwt = hub_jwt(host)
    wake, skip = [], []
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
        detail = get(host, jwt, f"/api/sessions/{s['id']}").get("session", s)
        action, reason = classify_session(host, jwt, s["id"], detail)
        name = ((detail.get("metadata") or {}).get("name") or "?")[:50]
        row = {"id": s["id"], "reason": reason, "name": name}
        (wake if action == "wake" else skip).append(row)
    counts = {"wake": len(wake), "skip": len(skip)}
    return {"wake": wake, "skip": skip, "counts": counts}


def main(argv: list[str]) -> int:
    host = os.environ.get("HAPI_HOST", "http://127.0.0.1:3006")
    self_id = os.environ.get("HAPI_SESSION_ID", "")
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
        else:
            print(f"unknown arg: {argv[i]}", file=sys.stderr)
            return 2
    if ids_file:
        only_ids = {
            line.strip()
            for line in open(ids_file)
            if line.strip() and not line.startswith("#")
        }
    result = classify_active_claude(host, self_id=self_id, only_ids=only_ids)
    json.dump(result, sys.stdout, indent=2)
    sys.stdout.write("\n")
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv))
