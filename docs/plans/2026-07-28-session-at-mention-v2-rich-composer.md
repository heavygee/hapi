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

## Feature flag

Enable rich path (default off → v1 textarea):

- `localStorage.setItem('hapi.composer.richMentions', '1')`
- or URL `?richMentions=1`
- or `VITE_RICH_COMPOSER_MENTIONS=true` at build time

Wire format on send / drafts: `[title](/sessions/<id>)` mixed with prose.

## Out of scope for v2 kickoff

- Chipping `/` slash commands or `$` skills
- Structured `mentions[]` on hub messages (optional later)
- Auto `ping-peer` on mention

## Tracking

| Track | Issue |
|-------|-------|
| v1 plain-text `@` autocomplete | [#1213](https://github.com/tiann/hapi/issues/1213) |
| v2 rich composer (this plan) | [#1216](https://github.com/tiann/hapi/issues/1216) |

Branch: `feat/session-mention-rich-composer` (based on v1 tip). `#1215` was a duplicate filing and is closed.
