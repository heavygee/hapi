# Overseer altitude: cross-session only (#108)

**Status:** implementing on `feat/overseer-inbox-turn-supersede`  
**Issue:** https://github.com/heavygee/hapi/issues/108

## Canon

Overseer helps the operator keep track **across** many sessions at the tip of each surface. It does **not** act as memory for what matters **inside** a session — that stays with the agent and the transcript.

## Rules

1. **Operator turn on session S** (human user-message: web / Telegram / CLI local / `ping_session` via `sendMessage`) → dismiss all active inbox items with `relatedSessionId=S` (`dismiss` / `obsoleted`, feedback `superseded_by_operator_turn`), including sleeping snoozes.
2. **Not a trigger:** resume/reopen alone; agent-only messages.
3. **Re-promote:** a newer attention event after that turn may create a fresh item.
4. **`query_open_loops` / "what am I forgetting?":** whole sessions that still need attention **and** that the operator has not turned on since that need — not unfinished work inside a session already re-entered.

## Kill criterion

After an operator user-message lands on S, no active inbox row remains for `relatedSessionId=S` until a newer attention event re-promotes.
