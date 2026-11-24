# Exit reflection: e2e-trace-artifacts (PR #2589)

## Shipped as

- PR(s): tiann/hapi#2589 (squash merge `6f7420aa6`, tip `7a0e63337`)
- Absorber (if superseded): n/a
- Session: [Peer #2589: upload Playwright CI artifacts](/sessions/2a230a2c-33d1-4a6d-8c80-ae3429e2c56c)

## Non-code residue

- Residual risk left on the record (PR body, not only chat): `if-no-files-found: ignore` silently permits an empty `playwright-artifacts` upload. Bites when only `test:passkey:browser` fails — that custom Chromium script never writes `playwright-report/` / `test-results/`, and the later e2e step does not run. Same silent-pass class the PR exists to fix.
- Follow-up check (not done yet): at the **first real `browser` job failure**, confirm the `playwright-artifacts` zip is non-empty. If empty under a Playwright-step failure, hotfix `ignore` → `warn` (or `error`).
- Caught GitHub's recorded PR base (`4e36c995`) stale vs live `upstream/main` (`6b4fc8249`, #945 underneath); re-derived gates + trial merge rather than inheriting Meta's numbers.
- Caught a mint-poisoned lane B grant: auth file bound to `7a0e63337373a2b…` (not a git object) while tip was `7a0e6333739e5e…` — same 9-char prefix, full compare fails. Stopped rather than burning a confusing gate failure; Meta re-minted on the real SHA.
- No soup layer ever added for `ci/upload-playwright-artifacts` (confirmed in `config/driver-manifest.yaml`).

## Promote?

- [x] `none` — transferable babysit habits (re-verify base, scrutinise silent-empty uploads, refuse bad grants) already land via Meta brief / PR body; no High-signal or tooling-doc patch owed from this peer.

## Open questions / landmines

- First live failing `browser` run still has not proven the artifact zip is non-empty under a Playwright-step failure. Until then, treat the upload path as unverified end-to-end.
