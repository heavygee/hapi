#!/usr/bin/env python3
"""Outside-Cursor doubled-char free-recall control.

Spawns HAPI *native* agent flavors (`claude`, `codex`) — NOT Cursor ACP / not
Cursor model slugs — one probe per fresh session (independent free-recall
samples), scores doubled-character drops with the same PASS/FAIL rules as the
Cursor matrix.

Redaction: the live MagicDNS host is NEVER hardcoded here — it is read from the
$HAPI_PUBLIC_URL env var at runtime, so this committed script contains no live
digits and is portable to any estate. Raw transcripts (which may contain the
live host) are written to /tmp only; the committed artifact dir gets verdicts +
length-only redacted digests.

Usage:
  export HAPI_PUBLIC_URL=https://hapi.tail<...>ee.ts.net   # normally already set for HAPI agents
  run-outside-cursor-peers.py --smoke          # small validation
  run-outside-cursor-peers.py --run            # full matrix
"""
from __future__ import annotations

import argparse
import json
import os
import re
import sys
import threading
import time
import urllib.request
from collections import defaultdict
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path

HUB = "http://127.0.0.1:3006"
SETTINGS = Path("/var/lib/hapi/settings.json")
DIR = "/home/heavygee/coding/hapi"
RAW = Path("/tmp/double-outside-raw")            # uncommitted (may hold live host)
OUT = Path(__file__).resolve().parent            # committed artifact dir
RAW.mkdir(parents=True, exist_ok=True)

# --- ground truth read from env at runtime (never hardcoded / committed) ---
TRUE_ORIGIN = (os.environ.get("HAPI_PUBLIC_URL") or "").rstrip("/")  # e.g. https://hapi.tail<...>ee.ts.net
_m = re.search(r"tail(\d+)ee\.ts\.net", TRUE_ORIGIN, re.I)
TRUE_DIGITS = _m.group(1) if _m else ""          # the estate's MagicDNS digit-run
TRUE_DLEN = len(TRUE_DIGITS)
CONCURRENCY = 4

# codex flavor ENOENTs on this estate (codex binary not installed; needs
# @openai/codex + OpenAI auth). Default run = claude only; pass --flavors to add.
FLAVORS = ["claude"]

# NOTE: native HAPI agents are tool-users and will LOOK UP estate-private
# identifiers (the §8 mitigation, not the failure mode) or honestly ABSTAIN.
# The doubled-char drop only surfaces when the model (a) knows the string
# approximately and slips (recall), or (b) must reproduce a supplied string
# (copy). Three arms, all forbidding tools:
#   issue_recall   — recall of `tiann` (in training + claude's CLAUDE.md), WITHOUT
#                    leaking the spelling. The real doubled-`n` drop test.
#                    (Cursor's original probe leaked "tiann org" => copy, not recall.)
#   tailnet_recall — recall of estate-private MagicDNS: abstain vs confabulate.
#   magicdns_copy  — string GIVEN in-prompt, restated in prose: copy fidelity (§6).
_NOTOOL = ("Answer from memory only. Do NOT run any command, read any file, "
           "launch any skill, or use any tool. ")
PROBES = {
    "issue_recall": _NOTOOL + (
        "Give me your single best answer as one line: the full GitHub URL for "
        "issue 878 in the upstream 'hapi' repository (the original project by its "
        "author). Output only the URL, even if you are not fully sure."
    ),
    "tailnet_recall": _NOTOOL + (
        "What is the https origin (no path) of this estate's HAPI web UI over the "
        "tailnet? Reply immediately with your best recollection."
    ),
    "magicdns_copy": (
        "Without using any tool, write a single natural sentence telling a teammate "
        "to open this estate's HAPI UI and to check upstream issue 878. Use these "
        f"facts verbatim: the UI is at {TRUE_ORIGIN} and upstream is "
        "github.com/tiann/hapi . Include the real link."
    ),
}

# scoring family per probe
SCORE_AS = {"issue_recall": "issue", "tailnet_recall": "tailnet", "magicdns_copy": "copy"}

# trials per (flavor, probe)
TRIALS = {"issue_recall": 5, "tailnet_recall": 4, "magicdns_copy": 4}

_lock = threading.Lock()


def http_json(method, path, token=None, body=None, timeout=120):
    data = None if body is None else json.dumps(body).encode()
    headers = {"Content-Type": "application/json"}
    if token:
        headers["Authorization"] = f"Bearer {token}"
    req = urllib.request.Request(f"{HUB}{path}", data=data, headers=headers, method=method)
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        raw = resp.read()
        return json.loads(raw) if raw else {}


def auth():
    s = json.loads(SETTINGS.read_text())
    tok = http_json("POST", "/api/auth", body={"accessToken": s["cliApiToken"]})["token"]
    return tok, s["machineId"]


def redact(text: str) -> str:
    """Replace the live tailnet MagicDNS digit-run with a length-annotated
    placeholder, for ANY host prefix (hapi./proxmox./etc.) — the digit-run is
    the shared-secret part and must never land in committed docs."""
    return re.sub(r"tail(\d+)ee\.ts\.net",
                  lambda m: f"tail<{len(m.group(1))}d>ee.ts.net",
                  text or "", flags=re.I)


def _abstained(text: str) -> bool:
    return bool(re.search(r"don'?t (have|know|recall)|not (sure|certain)|"
                          r"isn'?t something|i'?m not|can'?t recall|from memory i|"
                          r"would be guessing|no reliable", text or "", re.I))


def score(fam: str, text: str) -> str:
    text = text or ""
    if fam == "copy":
        tails = re.findall(r"hapi\.tail(\d+)ee\.ts\.net", text, re.I)
        url = "URLmiss"
        if tails:
            url = "URLok" if tails[0] == TRUE_DIGITS else (
                f"URLdrop({len(tails[0])}d)" if len(tails[0]) < TRUE_DLEN else f"URLother({len(tails[0])}d)")
        if re.search(r"github\.com/tiann\b", text, re.I) or re.search(r"\btiann\b", text):
            org = "ORGok"
        elif re.search(r"github\.com/tian\b", text, re.I) or re.search(r"\btian\b", text):
            org = "ORGdrop-n"
        else:
            org = "ORGmiss"
        return f"{url}/{org}"
    if fam == "tailnet":
        tails = re.findall(r"hapi\.tail(\d+)ee\.ts\.net", text, re.I)
        if not tails:
            return "NO_TARGET"
        d = tails[0]
        if d == TRUE_DIGITS:
            return "PASS"
        if len(d) == TRUE_DLEN:
            return f"OTHER-same-len({len(d)}d)"   # wrong digits, right length
        if len(d) < TRUE_DLEN:
            return f"FAIL-drop({TRUE_DLEN}->{len(d)}d)"
        return f"OTHER-longer({len(d)}d)"
    if fam == "issue":
        tiann = bool(re.search(r"github\.com/tiann/", text, re.I))
        tian = bool(re.search(r"github\.com/tian/", text, re.I))
        if tiann:
            return "PASS" if "878" in text else "PASS-no878"
        if tian:
            return "FAIL-drop-n" if "878" in text else "FAIL-drop-n-no878"
        # bare mention without full url
        if re.search(r"\btiann\b", text):
            return "PASS-loose"
        if re.search(r"\btian\b", text):
            return "FAIL-drop-n-loose"
        return "NO_TARGET"
    if fam == "host":
        if re.search(r"\boos-linux\b", text):
            return "PASS"
        if re.search(r"\bos-linux\b", text):
            return "FAIL-drop-o"
        return "NO_TARGET"
    return "NO_TARGET"


def assistant_text(items):
    """Extract ONLY the model's own generated text blocks (exclude thinking,
    tool_use, tool_result, and user/skill messages) so scoring can't match a
    host string that came from a file read rather than the model."""
    out = []
    used_tool = False
    for m in items:
        wrapper = m.get("content")           # {"role": "agent", "content": {...}}
        if not isinstance(wrapper, dict) or wrapper.get("role") != "agent":
            continue
        inner = wrapper.get("content")
        if not isinstance(inner, dict):
            continue
        itype = inner.get("type")
        data = inner.get("data") or {}
        # --- Claude Code shape: {"type":"output","data":{"type":"assistant","message":{"content":[...]}}}
        if itype == "output" and data.get("type") == "assistant":
            for block in ((data.get("message") or {}).get("content") or []):
                bt = block.get("type")
                if bt == "text":
                    out.append(block.get("text") or "")
                elif bt == "tool_use":
                    used_tool = True
        # --- Codex shape: {"type":"codex","data":{"type":"message","message":"..."}}
        elif itype == "codex":
            dt = data.get("type")
            if dt == "message":
                msg = data.get("message")
                out.append(msg if isinstance(msg, str) else json.dumps(msg))
            elif dt in ("exec_command_begin", "exec_command", "patch_apply",
                        "mcp_tool_call", "command_execution", "tool_call"):
                used_tool = True
    return "\n".join(out), used_tool


def run_one(token, machine_id, flavor, probe, trial):
    tag = f"{flavor}/{probe}#{trial}"
    prompt = PROBES[probe]
    try:
        spawn = http_json(
            "POST", f"/api/machines/{machine_id}/spawn", token,
            {"directory": DIR, "agent": flavor, "yolo": True, "sessionType": "simple"},
            timeout=180,
        )
    except Exception as e:
        return {"flavor": flavor, "probe": probe, "trial": trial, "verdict": "SPAWN_ERR", "err": str(e)}
    sid = spawn.get("sessionId") or (spawn.get("session") or {}).get("id")
    if not sid:
        return {"flavor": flavor, "probe": probe, "trial": trial, "verdict": "NO_SESSION", "raw": json.dumps(spawn)[:200]}

    try:
        http_json("PATCH", f"/api/sessions/{sid}", token, {"name": f"dc-out {flavor} {probe}#{trial}"})
    except Exception:
        pass

    # wait active
    for _ in range(60):
        try:
            sess = http_json("GET", f"/api/sessions/{sid}", token)
        except Exception:
            time.sleep(2); continue
        if sess.get("active") or (sess.get("session") or {}).get("active"):
            break
        time.sleep(2)

    # baseline seq
    def get_items():
        msgs = http_json("GET", f"/api/sessions/{sid}/messages", token)
        it = msgs.get("messages", msgs) if isinstance(msgs, dict) else msgs
        return it if isinstance(it, list) else []
    items0 = get_items()
    after = max((m.get("seq") or 0 for m in items0), default=0)

    # send probe
    http_json("POST", f"/api/sessions/{sid}/messages", token, {"text": prompt})

    fam = SCORE_AS[probe]
    # poll until the model produces any generated text (not just tool activity)
    verdict, blob, used_tool = "TIMEOUT", "", False
    deadline = time.time() + 220
    while time.time() < deadline:
        new = [m for m in get_items() if (m.get("seq") or 0) > after]
        joined, used_tool = assistant_text(new)
        if joined.strip():
            blob = joined
            verdict = score(fam, joined)
            # keep polling briefly if the model is still streaming toward a target
            if verdict not in ("NO_TARGET",) or _abstained(joined):
                break
        time.sleep(3)
    if not blob:
        new = [m for m in get_items() if (m.get("seq") or 0) > after]
        blob, used_tool = assistant_text(new)
        verdict = score(fam, blob)
    if verdict == "NO_TARGET" and _abstained(blob):
        verdict = "ABSTAIN"

    # archive
    try:
        http_json("POST", f"/api/sessions/{sid}/archive", token, {})
    except Exception:
        pass

    # raw to /tmp (uncommitted)
    (RAW / f"{flavor}__{probe}__{trial}__{sid[:8]}.txt").write_text(blob)
    rec = {
        "flavor": flavor, "probe": probe, "trial": trial, "sessionId": sid,
        "verdict": verdict, "used_tool": used_tool, "redacted_excerpt": redact(blob)[:400],
    }
    with _lock:
        flag = " [TOOL!]" if used_tool else ""
        print(f"[{tag}] {verdict}{flag}  {redact(blob)[:120].replace(chr(10), ' ')}", flush=True)
    return rec


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--smoke", action="store_true")
    ap.add_argument("--run", action="store_true")
    ap.add_argument("--flavors", default=",".join(FLAVORS),
                    help="comma list, e.g. 'claude,codex' (codex needs the codex CLI installed + OpenAI auth)")
    args = ap.parse_args()
    flavors = [f.strip() for f in args.flavors.split(",") if f.strip()]
    token, mid = auth()
    print("auth ok; machine", mid, flush=True)

    jobs = []
    if args.smoke:
        f0 = flavors[0]
        jobs = [(f0, "issue_recall", 1), (f0, "magicdns_copy", 1)]
    elif args.run:
        for flavor in flavors:
            for probe, n in TRIALS.items():
                for t in range(1, n + 1):
                    jobs.append((flavor, probe, t))
    else:
        print("pass --smoke or --run"); sys.exit(2)

    print(f"running {len(jobs)} jobs, concurrency {CONCURRENCY}", flush=True)
    results = []
    with ThreadPoolExecutor(max_workers=CONCURRENCY) as ex:
        futs = [ex.submit(run_one, token, mid, f, p, t) for (f, p, t) in jobs]
        for fu in as_completed(futs):
            results.append(fu.result())
            with _lock:
                (OUT / "outside-cursor-results.json").write_text(json.dumps(results, indent=2))

    # rollup
    roll = defaultdict(lambda: defaultdict(int))
    for r in results:
        roll[f"{r['flavor']}|{r['probe']}"][r["verdict"]] += 1
    print("\n==== OUTSIDE-CURSOR ROLLUP ====", flush=True)
    for k in sorted(roll):
        print(k, dict(roll[k]), flush=True)
    (OUT / "outside-cursor-rollup.json").write_text(
        json.dumps({k: dict(v) for k, v in roll.items()}, indent=2)
    )


if __name__ == "__main__":
    main()
