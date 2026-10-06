#!/usr/bin/env python3
"""Distance-recall arm: does a native (non-Cursor) agent DROP a doubled character
when *regenerating* an identifier it was given earlier in the session, under prose
load and distance — the regime that actually matches how Cursor's agent held the
MagicDNS (in rules / chat history)?

Fully FABRICATED identifiers so transcripts are directly shareable (no redaction):
  * host: https://hapi.tail7733ee.ts.net   (doubled 7, doubled 3, doubled e —
    same doubled-char hazard shape as a real MagicDNS; NOT a real host)
  * org : github.com/tiann/hapi            (public; doubled n)
  * hub : oos-linux                        (public; doubled o)

Per session (fresh, no Cursor): 4 turns —
  1. seed      : give the three facts, ask for "ack" (string now in context history)
  2. distractor: an unrelated arithmetic turn (adds distance + working-memory load)
  3. prose     : "from memory, don't re-read above" — write an onboarding note that
                 re-emits all three identifiers in prose
  4. code      : re-emit them again inside a bash snippet (different generative mode)

Turns 3 & 4 are scored; every re-emission is counted faithful vs mangled. Session
is DELETED afterward (not just archived).

Usage: run-recall-distance.py --run --flavors claude,codex [--n 8]
"""
from __future__ import annotations
import argparse, json, re, threading, time, urllib.request
from collections import defaultdict
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path

HUB = "http://127.0.0.1:3006"
SETTINGS = Path("/var/lib/hapi/settings.json")
DIR = "/home/heavygee/coding/hapi"
OUT = Path(__file__).resolve().parent
CONCURRENCY = 4

# --- fabricated, shareable ---
FAB_HOST = "hapi.tail7733ee.ts.net"
FAB_URL = f"https://{FAB_HOST}"
FAB_DIGITS = "7733"
ORG = "tiann"
HUB_HOST = "oos-linux"

SEED = (f"Context for today's task — note these three facts exactly, I'll ask about them later:\n"
        f"1. HAPI web UI (tailnet): {FAB_URL}\n"
        f"2. upstream repo/org: github.com/{ORG}/hapi\n"
        f"3. hub host: {HUB_HOST}\n"
        f"Reply with just: ack")
DISTRACTOR = "Unrelated quick sanity check: reply with only the numeric result of 47 * 53."
PROSE = ("From memory only — do NOT scroll back up or re-read the earlier messages, and do NOT "
         "run any command / read any file / use any tool. Write a short onboarding note (4-6 lines) "
         "for a new teammate that covers: how to open the HAPI UI over the tailnet (give the full "
         "https URL), which host runs the hub, and where the upstream project lives (repo URL). "
         "Use the exact values I gave you earlier.")
CODE = ("Still from memory, no tools: write a 3-line bash snippet — one line that curls the HAPI UI "
        "over the tailnet, one that echoes the hub host, one that echoes the upstream repo URL. "
        "Use the exact values from earlier.")

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


def assistant_text(items):
    """Model-generated text only (Claude assistant blocks + Codex message events)."""
    out, used_tool = [], False
    for m in items:
        w = m.get("content")
        if not isinstance(w, dict) or w.get("role") != "agent":
            continue
        inner = w.get("content")
        if not isinstance(inner, dict):
            continue
        it, data = inner.get("type"), inner.get("data") or {}
        if it == "output" and data.get("type") == "assistant":
            for b in ((data.get("message") or {}).get("content") or []):
                if b.get("type") == "text":
                    out.append(b.get("text") or "")
                elif b.get("type") == "tool_use":
                    used_tool = True
        elif it == "codex":
            dt = data.get("type")
            if dt == "message":
                msg = data.get("message")
                out.append(msg if isinstance(msg, str) else json.dumps(msg))
            elif dt in ("exec_command_begin", "exec_command", "patch_apply",
                        "mcp_tool_call", "command_execution", "tool_call"):
                used_tool = True
    return "\n".join(out), used_tool


def count_emissions(text):
    """Return per-identifier (faithful, mangled, other) emission counts."""
    text = text or ""
    # host
    host_runs = re.findall(r"hapi\.tail(\d+)ee\.ts\.net", text, re.I)
    h_ok = sum(1 for d in host_runs if d == FAB_DIGITS)
    h_drop = sum(1 for d in host_runs if len(d) < len(FAB_DIGITS))
    h_other = len(host_runs) - h_ok - h_drop
    # org (tiann vs tian)
    o_ok = len(re.findall(r"tiann", text))
    o_drop = len(re.findall(r"tian(?!n)", text))          # tian not followed by n
    # hub (oos-linux vs os-linux)
    hub_ok = len(re.findall(r"oos-linux", text))
    hub_drop = len(re.findall(r"(?<!o)os-linux", text))   # os-linux not preceded by o
    return {
        "host": {"ok": h_ok, "drop": h_drop, "other": h_other},
        "org": {"ok": o_ok, "drop": o_drop},
        "hub": {"ok": hub_ok, "drop": hub_drop},
    }


def wait_reply(token, sid, after_seq, timeout_s=200):
    deadline = time.time() + timeout_s
    last = ""
    while time.time() < deadline:
        msgs = http_json("GET", f"/api/sessions/{sid}/messages", token)
        items = msgs.get("messages", msgs) if isinstance(msgs, dict) else msgs
        if not isinstance(items, list):
            items = []
        new = [m for m in items if (m.get("seq") or 0) > after_seq]
        txt, _ = assistant_text(new)
        if txt.strip():
            last = txt
            # give a beat for streaming to finish, then return
            time.sleep(2)
            msgs2 = http_json("GET", f"/api/sessions/{sid}/messages", token)
            items2 = msgs2.get("messages", msgs2) if isinstance(msgs2, dict) else msgs2
            new2 = [m for m in items2 if (m.get("seq") or 0) > after_seq]
            txt2, _ = assistant_text(new2)
            maxseq = max((m.get("seq") or 0 for m in items2), default=after_seq)
            return (txt2 or last), maxseq
        time.sleep(3)
    return last, after_seq


def max_seq(token, sid):
    msgs = http_json("GET", f"/api/sessions/{sid}/messages", token)
    items = msgs.get("messages", msgs) if isinstance(msgs, dict) else msgs
    if not isinstance(items, list):
        items = []
    return max((m.get("seq") or 0 for m in items), default=0)


def send(token, sid, text):
    http_json("POST", f"/api/sessions/{sid}/messages", token, {"text": text})


def delete_session(token, sid):
    """Active sessions can't be deleted (409) — archive first, then delete."""
    def _del():
        req = urllib.request.Request(f"{HUB}/api/sessions/{sid}",
                                     headers={"Authorization": f"Bearer {token}"}, method="DELETE")
        with urllib.request.urlopen(req, timeout=30):
            return True
    try:
        return _del()
    except Exception:
        pass
    try:
        http_json("POST", f"/api/sessions/{sid}/archive", token, {})
    except Exception:
        pass
    for _ in range(3):
        try:
            return _del()
        except Exception:
            time.sleep(1)
    return False


def run_one(token, machine_id, flavor, i):
    tag = f"{flavor}#{i}"
    try:
        spawn = http_json("POST", f"/api/machines/{machine_id}/spawn", token,
                          {"directory": DIR, "agent": flavor, "yolo": True, "sessionType": "simple"}, timeout=180)
    except Exception as e:
        return {"flavor": flavor, "i": i, "error": f"spawn:{e}"}
    sid = spawn.get("sessionId") or (spawn.get("session") or {}).get("id")
    if not sid:
        return {"flavor": flavor, "i": i, "error": "no session"}
    try:
        http_json("PATCH", f"/api/sessions/{sid}", token, {"name": f"DCTEST-recall {flavor} #{i}"})
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

    result = {"flavor": flavor, "i": i, "sessionId": sid, "turns": {}}
    try:
        after = max_seq(token, sid)
        send(token, sid, SEED); _, after = wait_reply(token, sid, after)        # ack
        send(token, sid, DISTRACTOR); _, after = wait_reply(token, sid, after)  # distance
        send(token, sid, PROSE); prose_txt, after = wait_reply(token, sid, after)
        send(token, sid, CODE); code_txt, after = wait_reply(token, sid, after)
        result["turns"]["prose"] = {"text": prose_txt, "counts": count_emissions(prose_txt)}
        result["turns"]["code"] = {"text": code_txt, "counts": count_emissions(code_txt)}
    finally:
        delete_session(token, sid)

    # session-level tally
    tot = defaultdict(lambda: defaultdict(int))
    for turn in result["turns"].values():
        for ident, c in turn["counts"].items():
            for k, v in c.items():
                tot[ident][k] += v
    result["totals"] = {k: dict(v) for k, v in tot.items()}
    drops = sum(tot[i].get("drop", 0) for i in ("host", "org", "hub"))
    result["drops"] = drops
    with _lock:
        summ = " ".join(f"{i}:{dict(tot[i])}" for i in ("host", "org", "hub"))
        print(f"[{tag}] drops={drops} | {summ}", flush=True)
    return result


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--run", action="store_true")
    ap.add_argument("--flavors", default="claude,codex")
    ap.add_argument("--n", type=int, default=8)
    args = ap.parse_args()
    flavors = [f.strip() for f in args.flavors.split(",") if f.strip()]
    token, mid = auth()
    print(f"auth ok; fabricated host {FAB_URL}; flavors={flavors} n={args.n}", flush=True)

    jobs = [(f, i) for f in flavors for i in range(1, args.n + 1)]
    results = []
    with ThreadPoolExecutor(max_workers=CONCURRENCY) as ex:
        futs = [ex.submit(run_one, token, mid, f, i) for (f, i) in jobs]
        for fu in as_completed(futs):
            results.append(fu.result())
            with _lock:
                (OUT / "recall-distance-results.json").write_text(json.dumps(results, indent=2))

    # rollup: per-flavor emission and drop totals
    roll = {}
    for f in flavors:
        rs = [r for r in results if r.get("flavor") == f and "totals" in r]
        agg = defaultdict(lambda: defaultdict(int))
        for r in rs:
            for ident, c in r["totals"].items():
                for k, v in c.items():
                    agg[ident][k] += v
        total_ok = sum(agg[i].get("ok", 0) for i in ("host", "org", "hub"))
        total_drop = sum(agg[i].get("drop", 0) for i in ("host", "org", "hub"))
        roll[f] = {"sessions": len(rs),
                   "per_identifier": {k: dict(v) for k, v in agg.items()},
                   "faithful_emissions": total_ok, "dropped_emissions": total_drop}
    (OUT / "recall-distance-rollup.json").write_text(json.dumps(roll, indent=2))
    print("\n==== DISTANCE-RECALL ROLLUP ====", flush=True)
    print(json.dumps(roll, indent=2), flush=True)


if __name__ == "__main__":
    main()
