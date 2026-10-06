# Session @-mention v2 — rich composer (follow-up to #1213)

**Status:** in progress (peer worktree `session-mention-rich-composer`).  
**v1 (feat/session-at-mention-autocomplete):** `@` autocomplete + **plain-text** expansion to Copy-reference grammar; `/sessions/<id>` autolinks in transcript.  
**v2 (this note):** replace the plain textarea composer with a segmented editor so mentions behave like `@people` (inline, positional).

## Spike decision (2026-07-28)

**Custom segmented editor** (not TipTap / Lexical).

- TipTap Mention is the industry default (~165KB ProseMirror core) and wins for CMS/docs; Lexical wins for high-scale messaging shells ([PkgPulse 2026](https://www.pkgpulse.com/guides/tiptap-vs-lexical-vs-slate-vs-quill-rich-text-editor-2026)).
- HAPI needs **one atom type**, must **reuse the existing Autocomplete picker** (TipTap's suggestion UI is the wrong surface), and keeps a textarea fallback behind a flag.
- Kill criterion: if IME/caret/atom-backspace burns >2 days of dogfood fixes, pivot to TipTap `Document`+`Paragraph`+`Text`+`Mention` **without** TipTap Suggestion (still reuse HAPI picker).

## Why v1 stayed dumb

Attachment-style chips cannot express "this clause → session A, that clause → session B" in one message. That needs caret-local tokens inside the typing surface. Faking chips beside a textarea trains the wrong mental model. Dogfood tried attachment chips; reverted for v1.

## v2 goals

- Insert a `session` segment at the caret from the existing `@` autocomplete picker
- Multiple mid-message mentions with surrounding prose
- Backspace deletes a whole mention token
- Serialize on send to markdown session links (agents stay text-safe)
- Feature-flag; keep textarea path until Enter/IME/drafts/send-error parity

## Default path (not a user setting)

Rich segmented composer is **on by default** - same posture as v1 `@` autocomplete (no opt-in affordance). Temporary dual-path during spike was an engineering kill-switch, not a product setting.

Emergency opt-out only (operators / regression):

- `localStorage.setItem('hapi.composer.richMentions', '0')` or `?richMentions=0`
- or build `VITE_RICH_COMPOSER_MENTIONS=false`

Wire format on send / drafts: `[title](/sessions/<id>)` mixed with prose. Proof: peer-stack MP4 (chips + baseline composer behaviors), not a still.

## Out of scope for v2 kickoff

- Chipping `/` slash commands or `$` skills
- Structured `mentions[]` on hub messages (optional later)
- Auto `ping-peer` on mention

## Tracking

| Track | Issue |
|-------|-------|
| v1 plain-text `@` autocomplete | [#1213](https://github.com/tiann/hapi/issues/1213) |
| v2 rich composer (this plan) | [#1215](https://github.com/tiann/hapi/issues/1215) |

Branch: `feat/session-mention-rich-composer` (based on v1 tip). PR must use `Fixes #1215` (not #1213; not #1216).

`#1216` was a parallel filing and is closed as a duplicate of `#1215`.
