# Peer receipt — overseer thin-tip decision (2026-07-14)

## Decision
Soup rematerialize uses **one** umbrella tip: `feat/overseer-readonly-entity` @ `4cb90c23f` (events+inbox+entity, zero FCM). Replay stays a separate thin tip.

## Receipts
| Peer | Session | Reply | Time (UTC) |
|------|---------|-------|------------|
| Step3 | `0cceb6a6` | thin tip ready `4cb90c23f` | ~13:21 |
| #22 events | `74cba641` | ACK stand-down | 14:01:59 |
| #23 inbox | `b535443b` | ACK stand-down | 14:02:23 |
| Replay | `4f9da41a` | working thin tip (in flight) | 14:02+ |
| FCM | `16fb823c` | ACK no rebuild | 13:19 |
| Mermaid | `95858a1d` | stand by for dogfood | 13:18 |
| CreatePlan | `b0431c7a` | stand down | 11:17 |

## Blocked on
Replay peer report: tip SHA, ahead-count, FCM path count = 0.

## Then meta
Repoint manifest (drop `soup/overseer-*-nofcm` ×3 → umbrella + thin replay) → `hapi-driver-rebuild --build-web --verify`.
