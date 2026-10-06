# Handoff: press-and-hold-to-talk as a conversational surface into the Overseer

**Date:** 2026-08-29
**Spawned by:** the session named **"Overseer stand-in"** (durable agentSessionId
`90d0312b-46c6-468d-8c00-77c6b20a322f` — that is a *find-key*, not a ping target; resolve the name
to a current hub id before replying, see "Close the loop").
**Your role:** thinking partner for the operator on a deliberately half-formed idea.
**Your role is NOT:** implementer. Do not open a PR. Do not start building. If you find yourself
writing code before the shape is agreed, you have misread this brief.

---

## Operator request (close to verbatim)

> "I find myself in need of a thing that is like the click-to-listen / speech-to-text thing, but it
> should actually be a way to converse with you, the Overseer. What I really want to do is just
> point at the HAPI interface, click and hold on it — either in a particular place or just in any
> place — and then talk to you, to basically tell you what I want, with the understanding that you
> will go and find what I'm talking about, because there'll either be some history that you can
> find, or you will know where a new thing should be spawned because it's going to be in a
> particular section.
>
> I realise this is a half-formed idea, but it would be useful … it's a way into the Overseer that I
> think I need. And with all the tooling that we've just added — the search peers, the corrected
> ping peers and all the other stuff — I think we have all the building blocks in place."

He asked specifically for a **Claude Opus** peer so the conversation is a good one. Treat this as a
design dialogue, not a ticket.

---

## The idea, as I understand it (challenge this)

Press and hold **anywhere** in the HAPI UI — possibly on a *specific* element, possibly just
anywhere — speak intent in plain language, release, and the Overseer:

1. works out what you meant,
2. **finds** the relevant existing thing (a session, a PR, an inbox item, a past decision), or
3. **knows where** a new thing should be spawned, because *where you pressed* carries meaning.

The press location is the interesting part. "Point at it and talk about it" gives the Overseer a
deictic anchor — *this* session, *this* PR chip, *this* section — that plain voice input lacks. That
may be the whole idea, or it may be a distraction; worth deciding early.

---

## Building blocks that already exist (verified, not aspirational)

| Piece | Where | State |
|---|---|---|
| Dictation providers (OpenAI / ElevenLabs / Deepgram / Groq / openai-compatible / browser-local) | `web/src/hooks/realtimeTranscription.ts`, `useVoiceInputPreferences.ts` | shipped |
| Browser-cloud STT provider (Google/Apple via classic Web Speech API) | issue #1639, branch `fix/voice-mobile-parity-1593` (pushed, not merged) | built |
| `useLongPress` hook, already reused in several places | `web/src/hooks/useLongPress.ts` | shipped |
| Long-press-to-talk on the session search box | issue #1594, in soup on `:3006` | **being reworked to push-to-talk (hold = talk, release = commit) right now** |
| Overseer read/act API (`query_inbox`, `query_events`, `explain_priority`, `record_disposition`, `ping_session`, converse) | `driver/hub/src/overseer/`, wrapper `scripts/tooling/hapi-overseer-call.sh` | live |
| Overseer inbox + events substrate (prioritised attention queue) | `inbox_items`, `overseer_events` in the hub DB | live, ~193 open items |
| Peer addressing: resolve-by-name / durable `agentSessionId` | `hapi-overseer-call.sh resolve` | live (built this week) |
| `ping_peer` / `spawn_peer` / `inspect_peer` | MCP + CLI | live; attributed delivery restored 2026-08-29 |
| Overseer converse loop (LLM + tools, modality-agnostic; "voice/XR reuse this") | `driver/hub/src/overseer/converse.ts` | live, brain-backed |

The operator's instinct that "the building blocks are in place" is basically right. The converse
loop was explicitly designed to be modality-agnostic, so a voice surface is a transport on top of an
existing brain, not a new brain.

---

## Questions worth putting to him early

These are starters — find better ones.

1. **Does the press location actually carry meaning, or is it just a mic button?** Anchored ("I
   pressed on *this* session") is far more powerful but needs every surface to expose what it is.
   Unanchored is trivially shippable. Which does he actually want first?
2. **What happens on release?** #1594 is settling on hold-to-talk / release-to-commit for *search*.
   Should the Overseer surface mirror that exactly, so the gesture means one consistent thing
   everywhere? Or is a conversation necessarily longer than a walkie-talkie press?
3. **Where does the answer appear?** Inline where he pressed, in a dedicated Overseer panel, spoken
   back, or as a new session? He has said he eventually wants voice back — TTS is a separate
   question from STT and may not be v1.
4. **What is the Overseer allowed to DO from a press?** Read-only ("find me the thing") is safe.
   Acting ("spawn a peer to do X") is the actual value, and is where the disposition/write-path
   rules and the write-intent gate matter.
5. **Failure modes.** Misheard intent that spawns the wrong work is worse than no feature. What is
   the confirm step, and does it differ for read vs write?
6. **Scope honesty.** Is this one feature, or the beginning of the real Overseer UI? Saying so
   up-front changes whether it should be built thin or designed properly.

---

## Context you should read before the conversation

- `docs/plans/2026-08-14-overseer-general-agent-tooling-gaps.md` — what the Overseer role needs,
  what already existed, what got built this week.
- `docs/operator/overseer-standin-activity-log.md` — the running log of a general agent standing in
  as Overseer. Long, but it is the empirical record of what the role actually does all day:
  triage, verifying agents' claims, catching process failures, routing work. It also honestly logs
  five occasions where that stand-in asserted things before verifying them, which is directly
  relevant to question 5.
- `docs/plans/2026-06-03-overseer-framing.md` and `2026-07-31-overseer-action-architecture-standing-orders.md`
  — the secretary-not-COO framing, autonomy tiers, and the disposition write-path.
- `docs/plans/2026-08-17-a2a-nametag-only-thesis.md` — recent, and a useful cautionary tale about
  over-engineering an identity mechanism until it had to be walked back.

---

## Constraints

- **Do not implement.** No PR, no branch work, until the operator says the shape is right.
- If it graduates to implementation, it goes through normal intake
  (`docs/tooling/new-feature-intake.md`) — issue first. Skipping that is a documented, repeated
  failure mode in this estate.
- Do not touch `~/coding/hapi/driver` by hand.
- Beware scope collision with **#1594** (search push-to-talk) — same gesture, adjacent surface,
  active peer. Coordinate rather than duplicate.
- Any voice work should reuse the configured dictation provider, not hardcode one.

---

## Close the loop (mandatory)

When you have something worth reporting — a shape, a disagreement, or a conclusion that this is a
bad idea (a legitimate outcome) — resolve **"Overseer stand-in"** to a current hub id and ping it:

```bash
/work/coding/hapi/scripts/tooling/hapi-overseer-call.sh resolve 'Overseer stand-in'
# take line 1's hubId, then MCP ping_peer or hapi ping-peer that id
```

Hub session ids in this estate **rotate frequently** — one peer moved through three ids in an hour.
Never cache one; resolve immediately before sending. Open your message with your name, then verdict.
Then emit `AGENT_NOTIFY_SUMMARY`. The summary line alone does not close the loop.

Mostly, though: the operator wants to *talk this through*. Talk to him first.
