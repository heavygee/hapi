# Handoff: orchestrate a live VR demo of HAPI + QAR for Charlie

**Date:** 2026-09-04
**Spawned by:** session named **"Overseer stand-in"** (durable agentSessionId
`90d0312b-46c6-468d-8c00-77c6b20a322f` — a find-key, not a ping target; resolve the name to a
current hub id before replying).
**Operator request:** *"I need to wow a new colleague about my VR working situation. His name is
**Charlie**, I'm going to be putting him in my headset and showing him HAPI and QAR will be active.
I think it will be very impressive for the Jessica/xev voice to address him, welcome him and explain
what they are looking at and how to operate the system. I will need to orchestrate such a session
when he's wearing the headset. Help me understand the things I should do and show to make it clear."*

**Your job:** make the operator look good in front of a colleague, live, with no fumbling. Two
deliverables: a **spoken welcome in the Jessica/xev voice addressed to Charlie by name**, and a
**runbook the operator can follow while a guest is wearing his headset**.

**Your job is NOT:** building new features, refactoring the voice stack, or improving QAR. This is
choreography and preparation on top of what already works.

---

## Pre-flight facts I verified today — do not trust older docs on these

The runbooks are stale on exactly the things that will break a live demo:

| Thing | Verified state (2026-09-04) | Why it matters |
|---|---|---|
| QAR reachable at **`http://100.93.248.78:8789`** (tailnet IP) | `{"ok":true,"version":"1.1.71"}` | This is the working path. Use it. |
| MagicDNS **`quest-3`** | **does NOT resolve** from oos-linux (`Could not resolve host`) | Any script or doc using the `quest-3` hostname fails here. |
| LAN **`192.168.86.71:8789`** | **connection refused** | The headset is *not on the home LAN* right now — tailnet shows it on an external direct address. Docs citing `.71` (and older ones citing `.92`) are stale. |
| QAR app version | **1.1.71** (live reading 2026-09-04) | A reading of **1.1.64** on 2026-08-30 is simply superseded — the sideload was updated since. **No documentation cites a QAR version at all**; the only `1.1.64` strings in the estate are stale generated build artifacts under a worktree's `app/build/`, which regenerate and must not be hand-edited. Corrected here because the original line in this brief wrongly said "docs and prior notes say 1.1.64". |
| Heartbeat | **fresh, age 0 min** | The relay app is alive and reporting. Good. |
| `worn` | **false** right now | See the gotcha below — this one can silently kill your demo. |

**The `worn` gotcha, and it is the big one.** `scripts/quest-audio-relay/heartbeat-fresh.sh` gates
routing on `QUEST_AUDIO_RELAY_REQUIRE_WORN=1` by default, and `system-voice.sh`'s hunt group only
routes to the Quest when that gate passes. So voice will **silently fall through to another output**
(Teemo, or local `aplay` on proxmox) unless the headset is genuinely on a head and reporting
`worn: true`. In a demo that means: Charlie hears nothing, and the greeting plays out loud in
another room. **Verify `worn: true` after he puts it on and before you trigger the greeting.**

Check it with:

    curl -s http://100.93.248.78:8789/status | jq '{version,worn,busy,serverRunning}'

---

## What to work out and hand back

1. **The greeting itself.** Jessica/xev voice, addressed to Charlie by name. It should welcome him,
   say plainly what he is looking at, and tell him how to operate it. Short enough to hold a
   stranger's attention in a headset — this is a first impression, not a tutorial. The operator's
   persona canon lives in the estate (`SOUL.md`, the `system-voice` registry rules, and
   `docs/runbooks/quest-standalone-system-voice.md`); match the established voice rather than
   inventing a new one. Note the estate distinguishes **Jessica** (estate secretary) from other
   personas — check which one actually speaks through xev before writing in her voice.
2. **A trigger the operator can fire on cue**, without leaving the guest staring at nothing while he
   types. Pre-stage the audio if that is what it takes; a pre-rendered WAV POSTed to `/play` is more
   reliable live than generating TTS on the spot. `scripts/quest-audio-relay/play.sh` is the
   existing consumer.
3. **A demo sequence** — what to show, in what order, so the impressive thing is legible to someone
   who has never seen it. Consider: he cannot see the HAPI web UI unless it is in the headset, so
   decide what is *spatial* versus what needs narrating.
4. **A pre-flight checklist** the operator runs 5 minutes before, with the verify commands inline.
   Assume he will be talking to a guest and cannot debug.
5. **A failure plan.** If the greeting does not play, what does he say and do so it reads as a pause
   rather than a broken system? Demos fail; a recovery line is worth more than a perfect script.

---

## Constraints

- **Do not disturb the headset while it is in use.** Estate rule: check the foreground app before
  launching or sideloading anything at the Quest. If the operator is mid-demo, no ADB pushes, no
  installs, no restarts.
- **Runtime audio is HTTP only** (`POST /play`). Do not route playback through ADB.
- **Verify renders before claiming they work.** Estate rule from prior XR work: do not eyeball a
  screenshot and declare success — check the actual pixel/audio path. If you cannot verify
  something, say so in the runbook rather than letting it fail live.
- No new features, no refactors, no PRs. This is preparation.
- If you need to test audio, coordinate — do not fire test playback into a headset someone is
  wearing.

## Close the loop

Report to the session named **"Overseer stand-in"** — resolve the name to a current hub id
(`scripts/tooling/hapi-overseer-call.sh resolve 'Overseer stand-in'`), or ping the durable
agentSessionId above. Hub ids rotate; do not cache one.

Deliver the runbook as a file the operator can open on a phone or second screen mid-demo, not as a
wall of chat text.
