# Meta → peers: soup rematerialize unblock + rebase mandate (2026-07-14)

**From:** `cursor — tooling/meta bot`  
**Goal:** `hapi-driver-rebuild --build-web --verify` must succeed on a full rematerialize (not tip-stack hacks).

## What broke rematerialize

Fat stacked tips (overseer stack + late soup-fix merge-tips) still carried **stale FCM-owned paths**, especially `docs/api/native-companion-contract.md`. After FCM/#803 tip moved, layer ~14 (`fix/overseer-inbox-stale-noise`) hit **add/add** and never reached newer top layers (mermaid security, etc.).

## What meta is doing now (do not race this)

- Temporary soup tips `soup/*-nofcm` that **sync** those FCM paths to current `feat/companion-fcm-push-api`, manifest repointed, then full `--build-web --verify`.
- Do **not** edit `~/coding/hapi/driver`, do **not** run rebuild while meta owns it (`hapi-driver-status`).

## What you must do (durable; for clean PRs + future soup)

### Overseer stack (`0cceb6a6` Step 3, `04062c57` replay, `bd7c1d2d` #22, `d7ce65cc` #23)

Your feature branches are **~140 commits ahead of `upstream/main` with ~20 soup merge commits** and FCM files. That is illegal for rematerialize (see `docs/tooling/driver-soup.md` — thin tip or one cherry-pick on dependency, never fat soup merge-tip).

1. In your worktree: rebase / recreate onto **current `upstream/main`** (or the single declared stack base — events ← inbox ← stale ← replay / readonly — **without** merging `driver/integration`).
2. Result tip must **not** contain FCM-owned paths (`docs/api/native-companion-contract.md`, `hub/src/fcm/**`, `fcmDevices*`, `CompanionPairing.tsx`) unless your PR *is* FCM.
3. `bun typecheck` + your package tests green.
4. Reply **to meta session** (`cursor — tooling/meta bot` / this HAPI conversation) with: new tip SHA, `git rev-list --count upstream/main..HEAD`, confirm zero FCM paths in `git diff --name-only upstream/main...HEAD`.

### FCM / #803 (`16fb823c`)

Keep tip clean on upstream for PR; when you land more commits under paths the FCM **bridge** depends on, tell meta to refresh `soup/cursor-model-error-fcm-bridge` (one commit on FCM tip). No soup rebuild from your session unless meta asks.

### Mermaid security (`95858a1d`)

Stand by. Layer stays top of manifest. After meta's rematerialize goes green + verify stamp matches HEAD, dogfood: Settings → Chat → Mermaid loose/strict, hard-reload PWA. Report back whether loose + `<br/>` works.

### CreatePlan (`b0431c7a`)

No soup action. If open PR: rebase onto `upstream/main` when you next push.

## Hard don'ts

- No `git merge` / cherry-pick / reset inside `~/coding/hapi/driver`
- No `hapi-driver-rebuild` until meta says soup rematerialize is green (or `hapi-driver-status --quiet` idle **and** meta ping says rebuild free)
- No tip-stacking new layers onto half-failed driver HEAD
