# HAPI client auth (all surfaces)

Hub auth is **two-layer**. Every client must implement both layers correctly — not just web, not just Android.

## Layers

| Layer | What it is | Lifetime | Where it lives |
|---|---|---|---|
| **Access credential** | `CLI_API_TOKEN[:namespace]` (companion QR / bind paste), or Telegram `initData` (Mini App) | Until operator rotates token or re-binds Telegram | Client secure storage |
| **JWT** | Bearer ticket from `POST /api/auth` (or `POST /api/bind` for Telegram bind flow) | **4 hours** (`exp` claim) | Client memory + optional cache; always disposable |

The hub **intentionally** issues short-lived JWTs. A stolen JWT window is bounded. Long-lived trust belongs to the access credential, not the JWT.

**Reference implementation (web PWA):** `web/src/hooks/useAuth.ts` — stores access token, decodes JWT `exp`, refreshes via `POST /api/auth` before expiry, retries API calls on 401.

## Client obligations

Any client that talks to `/api/*` with a Bearer JWT **must**:

1. **Persist the access credential** (or equivalent refresh source) after first bind/login — not only the JWT.
2. **Refresh the JWT proactively** before `exp` (web uses a TTL skew; companion uses `HubSession` with ~5 min skew).
3. **Re-auth on 401** when refresh fails — surface "re-pair / log in again", not raw HTTP errors.
4. **Acceptance-test time travel** — mock clock past JWT `exp`, assert hub calls still succeed without user action.

If a client stores JWT only and discards the access credential, it will **look paired** while failing every ~4 hours. That is a client bug, not a hub limitation.

## What breaks pairing legitimately

Operator-initiated or security events — expected re-bind:

- Hub `CLI_API_TOKEN` rotated
- Hub base URL changed
- App data cleared / uninstall
- Telegram user unbound (`not_bound`)

## Surface-specific notes

### Web PWA

Auth refresh is built into `useAuth`. Agents can assume web handles TTL **if** the user logged in via access token or Telegram with working refresh path.

### Android companion (`hapi-companion`)

Phone holds credentials; watch is a proxy over Wear Data Layer. Watch never holds JWT or access token. Phone **must** use `HubSession` (or equivalent) — see `hapi-companion` skill `companion-jwt-bridge`.

### CLI / scripts / automation

Scripts that `POST /api/auth` once and cache JWT in env or a file need the same refresh loop or must re-auth on 401. Do not assume a JWT from yesterday still works.

### Telegram Mini App

Uses `initData` refresh path in `useAuth` (Telegram re-open) plus optional `/api/bind` for namespace binding. Different credential shape; same JWT TTL rule.

## Intake gate (new client or native feature)

Before shipping any new HAPI client surface, answer:

- Where is the **access credential** stored after bind?
- Where is **JWT refresh** implemented? (file + function name)
- What happens at **T + 4h + 1m** without user opening the app?
- What **operator-facing error** appears when refresh fails?

If any answer is "we only store the JWT", stop — fix auth before feature work.

## Related

- **System-wide skill:** `~/coding/skills/expiring-credential-clients` (all repos, all agents)
- Hub route: `hub/src/web/routes/auth.ts` (`setExpirationTime('4h')`)
- Web client: `web/src/hooks/useAuth.ts`
- Companion: `~/coding/hapi-companion/app/.../HubSession.kt`
- Native push contract: `docs/api/native-companion-contract.md` (FCM is separate from JWT refresh)
