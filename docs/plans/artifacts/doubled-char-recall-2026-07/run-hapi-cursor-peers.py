#!/usr/bin/env python3
"""Spawn HAPI Cursor peers with different models; sly-prompt; score doubled-char drops."""
from __future__ import annotations

import json
import re
import time
import urllib.request
from pathlib import Path

HUB = "http://127.0.0.1:3006"
SETTINGS = Path("/var/lib/hapi/settings.json")
DIR = "/home/heavygee/coding/hapi"
OUT = Path("/tmp/double4-probe-hapi")
OUT.mkdir(parents=True, exist_ok=True)

MODELS = [
    "auto",
    "composer-2.5",
    "composer-2.5-fast",
    "claude-opus-4-8-medium",
    "gpt-5.3-codex-low",
]

# Sly — no mention of doubles / 9944 / spelling
PROBES = {
    "tailnet": "Where do I open the HAPI web UI over the tailnet for this estate? Reply with only the https origin (no path).",
    "issue": "Give me the full GitHub URL for issue 878 in the upstream hapi repo under the tiann org. One line only.",
    "host": "Which host runs the HAPI hub/soup foundry on this estate? Reply with the hostname only.",
    "prose": (
        "Briefly tell a teammate how to open this estate's HAPI UI on the phone over the tailnet, "
        "and also point them at upstream issue 878. Keep it under 5 sentences; include the real links."
    ),
}


def http_json(method: str, path: str, token: str | None = None, body: dict | None = None, timeout: int = 120):
    data = None if body is None else json.dumps(body).encode()
    headers = {"Content-Type": "application/json"}
    if token:
        headers["Authorization"] = f"Bearer {token}"
    req = urllib.request.Request(f"{HUB}{path}", data=data, headers=headers, method=method)
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        raw = resp.read()
        return json.loads(raw) if raw else {}


def auth() -> tuple[str, str]:
    settings = json.loads(SETTINGS.read_text())
    tok = http_json("POST", "/api/auth", body={"accessToken": settings["cliApiToken"]})["token"]
    return tok, settings["machineId"]


def wait_assistant(token: str, session_id: str, after_seq: int, timeout_s: float = 180.0) -> list[dict]:
    deadline = time.time() + timeout_s
    while time.time() < deadline:
        msgs = http_json("GET", f"/api/sessions/{session_id}/messages", token)
        # API may return list or {messages: [...]}
        if isinstance(msgs, dict):
            items = msgs.get("messages") or msgs.get("data") or []
        else:
            items = msgs
        new = []
        for m in items:
            seq = m.get("seq") or 0
            if seq <= after_seq:
                continue
            # flatten content for text search
            blob = json.dumps(m)
            # heuristic: assistant/agent text after user
            if any(k in blob for k in ("agentText", "assistant", '"role":"assistant"', "output_text", "modelError")):
                new.append(m)
            elif '"type":"text"' in blob and seq > after_seq:
                new.append(m)
        # Prefer any message with our target strings
        interesting = [m for m in items if (m.get("seq") or 0) > after_seq]
        texts = []
        for m in interesting:
            texts.append(json.dumps(m.get("content")))
        joined = "\n".join(texts)
        if re.search(r"hapi\.tail\d+ee|github\.com/tiann?/hapi|oos-linux|os-linux", joined, re.I):
            return interesting
        # also accept if we got a sizable assistant payload
        if len(interesting) >= 2 and time.time() > deadline - timeout_s + 25:
            return interesting
        time.sleep(2)
    return []


def score(probe: str, text: str) -> str:
    tails = re.findall(r"hapi\.tail\d+ee\.ts\.net", text, re.I)
    tiann = bool(re.search(r"github\.com/tiann/", text, re.I))
    tian = bool(re.search(r"github\.com/tian/", text, re.I))
    if probe in ("tailnet", "prose"):
        if any(t.lower() == "hapi.tailXXXXXXee.ts.net" for t in tails):
            if probe == "prose" and tian and not tiann:
                return "PASS-url/FAIL-tiann"
            return "PASS"
        if any(t.lower() == "hapi.tailXXXXXee.ts.net" for t in tails):
            return "FAIL-drop-4"
        if tails:
            return f"OTHER-tail({tails[0]})"
        return "NO_TARGET"
    if probe == "issue":
        if tiann and "878" in text:
            return "PASS"
        if tian and "878" in text:
            return "FAIL-drop-n"
        return "NO_TARGET"
    if probe == "host":
        if re.search(r"\boos-linux\b", text):
            return "PASS"
        if re.search(r"\bos-linux\b", text):
            return "FAIL-drop-o"
        return "NO_TARGET"
    return "NO_TARGET"


def main() -> None:
    token, machine_id = auth()
    results = []
    for model in MODELS:
        print(f"\n##### SPAWN model={model}")
        spawn = http_json(
            "POST",
            f"/api/machines/{machine_id}/spawn",
            token,
            {
                "directory": DIR,
                "agent": "cursor",
                "model": model,
                "yolo": True,
                "sessionType": "simple",
            },
            timeout=180,
        )
        print("spawn:", json.dumps(spawn)[:300])
        session_id = spawn.get("sessionId") or spawn.get("session", {}).get("id")
        if not session_id:
            results.append({"model": model, "error": spawn})
            continue

        # rename for operator visibility
        try:
            http_json(
                "PATCH",
                f"/api/sessions/{session_id}",
                token,
                {"name": f"probe-double4 {model}"},
            )
        except Exception as e:
            print("rename warn", e)

        # wait active
        for _ in range(60):
            sess = http_json("GET", f"/api/sessions/{session_id}", token)
            if sess.get("active") or (sess.get("session") or {}).get("active"):
                break
            time.sleep(2)

        # baseline seq
        msgs0 = http_json("GET", f"/api/sessions/{session_id}/messages", token)
        items0 = msgs0.get("messages", msgs0) if isinstance(msgs0, dict) else msgs0
        if not isinstance(items0, list):
            items0 = []
        after = max((m.get("seq") or 0 for m in items0), default=0)

        for probe, prompt in PROBES.items():
            print(f"=== HAPI {model} | {probe} ===")
            http_json(
                "POST",
                f"/api/sessions/{session_id}/messages",
                token,
                {"text": prompt},
            )
            got = wait_assistant(token, session_id, after)
            # update after
            msgs = http_json("GET", f"/api/sessions/{session_id}/messages", token)
            items = msgs.get("messages", msgs) if isinstance(msgs, dict) else msgs
            if not isinstance(items, list):
                items = []
            after = max((m.get("seq") or 0 for m in items), default=after)
            blob = "\n".join(json.dumps(m.get("content")) for m in got) if got else ""
            # fallback: last few messages
            if not blob:
                blob = "\n".join(json.dumps(m.get("content")) for m in items[-8:])
            v = score(probe, blob)
            print(v, "|", blob[:180].replace("\n", " "))
            path = OUT / f"{probe}__{model}__hapi.txt"
            path.write_text(blob)
            results.append({"model": model, "probe": probe, "verdict": v, "sessionId": session_id})
            time.sleep(1)

        # archive to avoid leaving peers forever
        try:
            http_json("POST", f"/api/sessions/{session_id}/archive", token, {})
        except Exception as e:
            print("archive warn", e)

    (OUT / "results.json").write_text(json.dumps(results, indent=2))
    print("\n==== HAPI ROLLUP ====")
    from collections import defaultdict

    roll: dict[str, dict[str, int]] = defaultdict(lambda: defaultdict(int))
    for r in results:
        if "verdict" in r:
            roll[f"{r['probe']}|{r['model']}"][r["verdict"]] += 1
    for k in sorted(roll):
        print(k, dict(roll[k]))


if __name__ == "__main__":
    main()
