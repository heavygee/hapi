# In-session content search (#1756) Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use test-driven-development to implement task-by-task.

**Goal:** Add find-in-this-conversation UI in the open session header that reuses FTS + jump from #1598.

**Architecture:** Header search control calls `GET /api/sessions/:id/content-search`. Selecting a hit navigates to `?messageId=&messageQuery=` so HappyThread’s existing locate / highlight / prev-next path runs. No new indexer or schema bump.

**Tech Stack:** React web, TanStack Query, existing ApiClient + HappyThread search target.

---

### Task 1: SessionInChatSearch component (TDD)

**Files:**
- Create: `web/src/components/SessionInChatSearch.tsx`
- Create: `web/src/components/SessionInChatSearch.test.tsx`
- Modify: `web/src/lib/locales/en.ts`, `zh-CN.ts`

**Behavior:**
- Collapsed: search icon (`data-testid="session-in-chat-search-toggle"`)
- Expand → input (≥2 chars) → debounced ranked matches list
- Click / Enter → `onSelectMatch(messageId, query)`
- Escape closes; Cmd/Ctrl+Shift+F opens (document in tooltip — do **not** steal browser Cmd/Ctrl+F)
- Show role + snippet; if snippet looks like attachment name, still show as text (no vision)

### Task 2: Wire SessionHeader + SessionChat + router

**Files:**
- Modify: `SessionHeader.tsx` (+ test)
- Modify: `SessionChat.tsx`
- Modify: `router.tsx` — `onSearchMessage` → navigate with messageId/messageQuery

### Task 3: FUE + gates

- `useFue('session-in-chat-search')` on the toggle
- Unit tests green; Playwright open→type→select→land
- Soup tip + remat; ping parent

---
