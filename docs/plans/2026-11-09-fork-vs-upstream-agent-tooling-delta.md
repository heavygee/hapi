# Fork vs upstream agent tooling delta (decision-grade)

**Status:** accepted by Meta; landed on fork `main` as docs-only (no product code; nothing pushed to `tiann/hapi`).  
**Date:** 2026-11-09  
**Parent:** [tooling/meta bot](/sessions/cbd1073e-4fd3-4f4a-bff8-cf9ba97bca6d)  
**Assessor session:** `ee885f68-b756-4498-8fdb-f824e7f02053`  
**Baselines (pinned SHAs at assessment time):**

| Tree | Ref | Evidence |
|---|---|---|
| Upstream | `upstream/main` @ `2161a9ff9` (release 0.34.4) | `git fetch upstream main` then `git show upstream/main:cli/src/claude/utils/startHappyServer.ts` |
| Soup tip (what `:3006` / this session actually runs) | driver `HEAD` @ `26e5eebc3` incl. restore `e08eb8b69` | `git -C ~/coding/hapi/driver rev-parse HEAD` |
| Fork `main` / `origin/main` | post-0.34.4 absorb (`317cb3a27` lineage) | shape-agnostic `registerTool(...)` count = **10**, identical to `317cb3a27^1` |

## Method (verify, do not infer)

1. **`gh` identity.** `docs/operator/AGENTS.md` § Upstream relationship: upstream collaborator is **heavygee**. Verified: `gh api user` → `heavygee`; `gh-ll api user` → `gavinc` (Location Lounge only - wrong for `tiann/hapi`). All PR/issue citations below used `gh` as heavygee (`--author heavygee` / `--author @me` would both resolve to heavygee on this host; `gh-ll` would silently miss every PR).
2. **Tool union.** Shape-agnostic count of `registerTool(...)` / `registerTool<...>(...)` name literals (not the pre-`#2312` `registerTool<any, any>(` shape alone - that probe under-counts after the allowlist rewrite). Cross-checked live MCP catalog from this Cursor session via HAPI MCP namespace discovery.
3. **Calibration cases (known-in-set before quoting the list):**
   - `search_content` ∈ soup union **and** live MCP catalog (this session) **and** fork `main` type union - present.
   - `set_voice_mode` ∈ soup union, **absent** from `upstream/main` `HapiMcpToolName` (`rg` → none) - present/absent as claimed.
   - `set_voice_mode` **absent** from this live Cursor MCP catalog - expected: Cursor STDIO bridge `DEFAULT_TOOL_NAMES` in `cli/src/codex/happyMcpStdioBridge.ts:39-53` omits it (Claude HTTP path still registers it in `startHappyServer.ts:1101-1102`).
4. **Attempt status.** `gh pr list/view --repo tiann/hapi` for heavygee + mentioned community PRs; fork `docs/plans/` for absorb notes; `git log -S` / module tree for "never attempted."
5. **Did not touch** remat / `hapi-driver-*` / holds.

## Structural finding (read before the table)

**Fork `main` carries 10 MCP tools by design. That is not damage from the 0.34.4 merge.**

Shape-agnostic re-probe (after Meta nearly acted on a false negative from grepping only the old `registerTool<any, any>(` call shape):

| Surface | Registered tools | Notes |
|---|---|---|
| `origin/main` / fork `main` | **10** | identical to `317cb3a27^1` (pre-merge parent) - nothing lost on the shared branch |
| Soup tip `startHappyServer` | **16** | main’s 10 + six layer-delivered tools |
| Live Cursor MCP this session | **15** | soup’s 16 minus `set_voice_mode` (bridge default omits it) |

**Main’s 10** = upstream’s nine (`change_title`, `display_image`, `display_video`, `display_media`, `list_peers`, `ping_peer`, `inspect_peer`, `spawn_peer`, `skill_lookup`) + fork-product `search_content`.

**Layer-delivered on soup only (do not “fix” main by promoting these onto it):** `set_voice_mode`, `link_issue`, `display_links`, `search_peers`, `archive_peer`, `session_job`. They arrive via soup layers by design. Pushing them onto fork `main` without an upstream landing plan recreates permanent absorb conflict for every peer.

What *was* a real strip incident: commit `e08eb8b69` (`fix(soup): restore fork tools the 0.34.4 absorb stripped`) - taking upstream’s `startHappyServer` / `happyMcpStdioBridge` wholesale during a **soup** absorb deleted the layer tools while their tests survived. That is the per-release failure mode `#2312`’s `enabledTools` allowlist makes permanent unless layer extras are re-threaded every soup absorb. It is **not** evidence that fork `main` lost tools.

Related absorb docs (same day): `2026-11-09-upstream-0344-sync-conflicts.md`, `2026-11-09-runcli-lazy-dispatch-absorb.md`, `2026-11-09-fork-divergence-on-hot-upstream-files.md`.

---

## Table

Legend for **Upstream status:** `absent` / `exists-equivalent` / `exists-and-diverges`.  
Legend for **Recommendation:** drop ours / finish landing / open a PR / keep fork-only deliberately.

### A. MCP tools (soup tip sixteen)

| Tool/feature | Upstream status | Our attempt status | Delta if both exist | Recommendation |
|---|---|---|---|---|
| `change_title` | **exists-equivalent** - `HapiMcpToolName` + `registerTool('change_title')` in `upstream/main:cli/src/claude/utils/startHappyServer.ts`; ACP re-enable `#1672` (junmo-kim, merged). | **merged upstream** - `#1896` (heavygee, merged 2026-09-21) made title write `metadata.name`. | Ours and theirs share the same tool; remaining delta is launcher policy (`emitTitleSummary` / title locks `#2072`), not a second tool. | **drop fork-only maintenance of the tool itself** - stay on upstream; only carry soup overlays when a real delta remains. |
| `display_image` | **exists-equivalent** - same file; media lineage includes `#1405` (NightWatcher314, merged), `#1568` (techotaku39, merged), `#944` (heavygee, merged). | **open PR** for prompt bug: `#2164` (MERGEABLE) - Cursor prompt strings applied to all flavors. Earlier cross-flavor attempt `#958` **closed** without merge. | Behavior equivalent; description text can tell non-Cursor flavors the wrong tool name (`#2164` body cites unconditional `DISPLAY_*_PROMPT_CURSOR`). | **finish landing** `#2164` (small, MERGEABLE) - otherwise keep paying a flavor-prompt tax on every soup tip. |
| `display_video` | **exists-equivalent** - same registration path as image. | Same `#2164` / closed `#958`. | Same prompt-flavor delta as image. | **finish landing** via `#2164`. |
| `display_media` | **exists-equivalent** - upstream `#1405` audio/file display. | Same `#2164`. | Same. | **finish landing** via `#2164`. |
| `list_peers` | **exists-equivalent** - tool + `HAPI_DISABLE_PEER_TOOLS` (`#2052`); docs at hapi.run how-it-works. | **merged upstream** - `#1372` (heavygee, merged 2026-08-05). | Soup list copy mentions `search_peers` as follow-on; upstream copy does not. Core list behavior matches. | **drop ours as a divergent product** - keep description nits only until `search_peers` lands or is declined. |
| `ping_peer` | **exists-and-diverges** - tool on upstream; `#2167` waitForReply (swear01, merged 2026-11-09); `#2298` auto-steer (junmo-kim, merged 2026-11-07); `#5a5731f93` stop waking unrelated sessions; delivery modes `#2197`. | **merged** origin `#1195`; **open** attribution `#2251` (CONFLICTING, supersedes `#1618`); **open stale** auto-steer `#1825` - substance already merged as `#2298`; fortress `#1473` **closed/declined**. | **Theirs:** `waitForReply` / `forwardPeerReply` / `supportsPeerReply` wired through MCP (`startHappyServer` markers). **Ours (soup):** `authenticatedSourceSessionId` path comments + `From:` discipline; inspect paging lives beside upstream cursor fetch (`MAX_INSPECT_PAGES`, `InspectMessagesFetch` in soup `pingPeer.ts`). **Neither tree currently implements durable `agentSessionId` resolve in `resolveSessionByPrefix`** (prefix/id only at `2161a9ff9` and soup tip) - yet live MCP **descriptions still claim** agentSessionId resolve (doc/code drift; restore targeted by `#2251` / fork `#137` history). | **finish landing** `#2251` (attribution + durable resolve). **Close `#1825`** - it is superseded by merged `#2298`; leaving it open is a misleading signal and a small ongoing babysit cost. Keep paying the `pingPeer.ts` contract-union tax until inspect paging is upstreamed or dropped (see `inspect_peer`). |
| `inspect_peer` | **exists-and-diverges** - tool exists; `#2167` added single-page cursor fetch for waitForReply (`isReadyEvent`, no `MAX_INSPECT_PAGES` on upstream). Community issue `#2250` (techotaku39, OPEN) asks for richer inspect pagination/filtering. | **merged** via `#1228` (composer + inspect). Soup keeps multi-page snippet accumulation (`messageTotal`, `hasMore`, `rowsScanned`, … on `InspectPeerResult`). | **Ours:** paging metadata for agent reports. **Theirs:** cursor/`watch` for reply forwarding. 0.34.4 sync doc: these are **two contracts in one function** - naive keep-both breaks either inspect reports or waitForReply. | **Uncertain vehicle, not uncertain need:** do **not** keep forever-fork paging (silent-drop risk proven `1b4438be5` / 11-05). Prefer finish-landing a merged contract - **uncertain** whether that is our own PR or collaborating on `#2250`. Interim: keep on soup and budget the contract merge every absorb. |
| `spawn_peer` | **exists-equivalent** - tool + Parent UUID stamp in remit. | **merged** `#1922` (heavygee); earlier `#1511` **closed** (superseded). Open follow-ups: `#1892` permissionMode default, `#1931` machine in product MCP/CLI. | Parent stamp behavior aligned (`spawnPeer.ts` Parent markers on both trees). Estate wrapper `hapi-spawn-peer` still owns cross-host `--machine` until `#1931`. | **drop divergent spawn_peer core**; **keep fork-only** `scripts/tooling/hapi-spawn-peer.sh` until `#1931` lands; babysit `#1892`/`#1931` separately. |
| `skill_lookup` | **exists-equivalent** - upstream `#1035` era; in `HapiMcpToolName`. | **merged** fix `#1096` (stop `$name` user-turn prepend). | Descriptions match at registration site. Cursor bridge defaults omit it unless `--tools` adds it; live session has it. | **drop ours** as a fork tool story - stay synced with upstream. |
| `search_peers` | **absent** from upstream MCP union and from upstream `pingPeer.ts` (`searchPeerSessions` absent). Hub keyword search lives on soup (`hub/.../sessionSearchMatch.ts`); not on upstream tool list. | **open PR** `#2010` (CONFLICTING, updated 2026-10-13); issue `#1710` OPEN. | N/A (fork-only tool). Finds quiet/aged sessions beyond `list_peers` recency (name/summary/path/agentSessionId). | **finish landing** - rebase `#2010`; high daily-fleet value; conflicts are absorb cost until merged. |
| `archive_peer` | **absent** as MCP/CLI tool. Hub `POST /sessions/:id/archive` **exists** upstream (`sessions.ts`); no agent-facing twin of `spawn_peer`. | **open PR** `#2021` (CONFLICTING); issue `#2020` OPEN. Related `#1705` closed (archive death-confirmation - different ask, `not_planned` family per `2026-11-08-meta-swap-retitle-audit-race.md`). | N/A. Soft stand-down for Peer Done / Meta idle. | **finish landing** `#2021` after rebase - argue as MCP/CLI twin of spawn, not as `#1705` re-litigation. Until merged, keep on soup (layer-delivered) and budget the `#2312` re-thread. |
| `link_issue` | **absent** from upstream MCP union. | **open** inside Boards mega-PR `#2147` (files include `cli/src/modules/linkIssue/*`, `commands/linkIssue.ts`, `startHappyServer.ts`). No successful standalone upstream merge. | N/A. Self-session GitHub issue chip via `PATCH .../link-issue` (soup hub route today). | **Uncertain:** finish-landing a **thin split** out of `#2147` vs keep layer-only until Boards ships. Do **not** promote onto fork `main` as a “fix.” Bias: split if Boards stays heavy - session-row chips are already a hot conflict site (`2026-11-09-fork-divergence-on-hot-upstream-files.md`). |
| `session_job` | **absent** from upstream MCP union / attached-job model. | **open PR** `#1424` (MERGEABLE, large +10k/−328, updated 2026-11-09); issues `#1404`, `#2000`. | N/A. MCP refuses `action=set`; create via `hapi job run` babysitter; update/clear/list over MCP. Drives session-row progress (same hot file as presence badges). | **finish landing** `#1424` while MERGEABLE - highest leverage fork-only tool for fleet ops; pairs with row-UI upstreaming decision in the divergence plan. |
| `display_links` | **absent** from upstream MCP union. | **open PR** `#1564` (CONFLICTING, stale 2026-09-16); issue `#1516` OPEN. Soup landed tip via `ad7ebce13` / compose notes. | N/A. Cursor-only; mitigates doubled-letter URL recall (`tia`+`nn`). Gated by `enableDisplayLinks` / `--tools`. | **finish landing** `#1564` (rebase) - Cursor-specific but not estate-private; upstream already takes Cursor MCP pain PRs. |
| `set_voice_mode` | **absent** (`rg` clean on upstream `startHappyServer.ts`). | **never attempted** as an upstream PR (no `gh search prs` / issue hits for `set_voice_mode`). Soup-only voice turn-shape tips (`feat(voice): per-session voice-mode turn shape`). | N/A. Marks session for short voice-relay turns; Claude path registers; Cursor bridge default omits. | **keep fork-only deliberately** (layer-delivered) until voice-first estate story is pitched - upstream has ElevenLabs/dictation but not this agent tool; opening a PR needs a non-estate rationale. Accept `#2312` re-thread cost on Claude soup absorbs. |
| `search_content` | **absent** as MCP/CLI tool. **Hub search API already exists upstream** - see scope note below. | **never attempted** on `tiann/hapi` as MCP. Fork-only: `d0bcac38e` / heavygee/hapi `#172` (merged on fork); steer fixes on fork `#198` OPEN. **Already on fork `main`’s 10-tool product union by design** (not a layer). | See **`search_content` scope** below - do not re-implement FTS. | **open a PR** scoped to the MCP/CLI credentialed wrapper + fail-closed errors + agent steer - **not** a new search backend. Lowest-risk upstreaming of the fork extras; already the steady-state main delta vs upstream. |

### B. Non-tool agent tooling (found in scope)

| Tool/feature | Upstream status | Our attempt status | Delta if both exist | Recommendation |
|---|---|---|---|---|
| Peer attribution / `From:` stamping | **exists-and-diverges** - soft nametag direction open upstream; fortress HMAC **declined** (`#1473` closed). Product docs on soup (`docs/operator/AGENTS.md` § Peer message identity). | **open** `#2251` (supersedes `#1618`); estate script stamps `From:` when `HAPI_SESSION_ID` set. | **Ours:** `scripts/tooling/hapi-ping-peer.sh` auto-stamp + mismatch warn/`STRICT_FROM`; MCP still requires manual `From:` (documented). **Theirs (via `#2251`):** hub `meta.sentFrom` + CLI peer-messages route. Live descriptions claim durable resolve that code lacks (see `ping_peer`). | **finish landing** `#2251`; **keep fork-only** estate stamp script as belt-and-braces even after merge (timers / non-broker callers). |
| Durable `agentSessionId` resolve | **absent** on upstream `resolveSessionByPrefix` (id/prefix only - verified excerpt). | **mid-flight** `#2251` / historical fork `#137` (silently deleted 2026-11-05 by `1b4438be5`, still absent on soup tip). | N/A until `#2251` merges. | **finish landing** `#2251` - descriptions already advertise it; shipping lie is worse than fork-only honesty. |
| `hapi ping-peer` / `inspect-peer` / `spawn-peer` product CLI | **exists-equivalent** - upstream ships these commands (how-it-works). | **merged** with the MCP landings (`#1195`, `#1228`, `#1922`). Fork `main` also registers `search-content` via lazy `registry.ts`. | Soup additionally registers layer CLIs (`search-peers`, `archive-peer`, `link-issue`, `display-links`, `job`) that are **not** on fork `main` by design. Soup still has a fat `runCli.ts` (298 lines) while `main` absorbed upstream’s thin lazy dispatcher (61 lines) - see absorb plan. | **finish landing** lazy `runCli` absorb on soup (`2026-11-09-runcli-lazy-dispatch-absorb.md`) while keeping layer CLI registration inside lazy/registry branches - without stranding soup-only commands. |
| `hapi-ping-peer` / `hapi-spawn-peer` PATH wrappers | **absent** upstream (no `scripts/tooling` estate wrappers on `upstream/main`). | Estate-only under `scripts/tooling/` + `~/.local/bin`. | Wrappers add From-stamp, soup PATH hygiene, cross-host `--machine`, fail-closed remit. | **keep fork-only deliberately** - operator estate utensils, not product. |
| Session jobs CLI (`hapi job …`) | **absent** upstream. | Tied to `#1424` / `#1404`; soup module `cli/src/modules/sessionJob`. | N/A. | **finish landing** with `#1424`. |
| `enabledTools` allowlist (`#2312`) | **exists-equivalent** - merged 2026-11-09 (techotaku39); exports `HapiMcpToolName` (9 names) + `includeTool` gating. | Soup absorbed surgically in `e08eb8b69` (union widened to 16; allowlist applied after peer kill switch). | **Theirs:** Pi peer-only server + nine-name union. **Ours:** same mechanism, larger union - any omitted fork name is silently unaddressable. | **keep fork-only union extensions** until each extra tool lands or is declined - changing nothing means re-applying the `e08eb8b69` patch every release. |
| Driver remat / soup scripts (`hapi-driver-rebuild`, layers, holds) | **absent** - upstream has no soup tip-forward kitchen. | Fork/estate only (`docs/tooling/driver-soup.md`). | N/A. | **keep fork-only deliberately** - not a candidate for upstream. |
| `index.ts` try/catch exit-0 backstop | **absent** on upstream `main()`. | Kept explicitly in 0.34.4 absorb notes. | Prevents unhandled rejection → exit 0 (silent-success class). | **keep fork-only deliberately** until upstream wants the same backstop; small, high-value. |

---

## `search_content` scope (so the PR is not mis-built)

Upstream **already ships the search backend.** Do not re-implement FTS, indexing, or the web content-search UI.

**Upstream hub already gives** (`upstream/main:hub/src/web/routes/sessions.ts`):

- `GET /api/sessions/content-search?query=&limit=&sessionId=` (fleet; optional multi `sessionId`)
- `POST /api/sessions/content-search` with `{ query, limit?, sessionIds? }` (same; body-limit protected)
- `GET /api/sessions/:id/content-search` (single-session; higher default limit)
- Match payload with snippets / totals / `hasPotentiallyIncompleteResults` (trigram FTS over transcript text)
- Auth via ordinary hub JWT (web/native clients already call these routes)

**Our MCP/CLI adds on top of that API** (`cli/src/modules/searchContent/searchContent.ts`, `commands/searchContent.ts`, MCP registration):

- CLI_API_TOKEN → JWT exchange (same pattern as `ping_peer`) so agents never hand-mint JWTs
- Fail-closed errors: auth/backend failure is an error, **never** a silent empty `[]` (the Overseer false-negative class)
- Agent-facing discovery: MCP tool name + description + flavor steer so models call it instead of inventing curl
- Dense CLI formatting (`hapi search-content`) for PATH use when MCP is not registered yet
- Trigram query tips in the tool/CLI help (short/common substrings are noisy)

**Out of scope for the upstream PR:** new hub endpoints, changing FTS ranking, web UI search chrome, Overseer-only query_events pagination. Copy the thin wrapper; point at the existing routes.

---

## Summary for the operator

### How much is redundant vs novel

| Bucket | Count | Items |
|---|---|---|
| Upstream already ships (core tool) | **9** | `change_title`, `display_*`×3, `list_peers`, `ping_peer`, `inspect_peer`, `spawn_peer`, `skill_lookup` |
| Of those, still meaningfully diverging on soup | **2–3** | `ping_peer` (attribution / waitForReply union), `inspect_peer` (paging vs cursor), plus description drift on durable ids |
| On fork `main` beyond upstream (by design) | **1** | `search_content` |
| Soup-layer MCP only (not on main) | **6** | `search_peers`, `archive_peer`, `link_issue`, `session_job`, `display_links`, `set_voice_mode` |
| Truly estate-private (keep) | **few** | `set_voice_mode` (until pitched), `hapi-*-peer` wrappers, remat/soup, exit-0 backstop |
| Should upstream (open or finish) | **most of the fork extras** | especially `search_content` (wrapper-only PR), `session_job` (`#1424` MERGEABLE), `search_peers` / `archive_peer` / `display_links` (open but CONFLICTING); `link_issue` **uncertain** (split vs wait on Boards) |

Roughly **half the live agent tool surface is now shared with upstream**; the old "fork-only playground" assumption is dead. The novel half is still real fleet value - but most already have upstream issues/PRs, so "novel" is not the same as "no landing path."

### Per-release conflict cost if we change nothing

1. **Silent unaddressable soup-layer tools.** `#2312` `enabledTools` / `HapiMcpToolName` means every **soup** absorb must re-list every layer tool. Miss one → green tests that never call it, tool gone from agents. Measured this morning on soup: `e08eb8b69`. Fork `main`’s 10-tool set was stable across the merge.
2. **`pingPeer.ts` permanent contract merge.** Upstream waitForReply cursor + soup inspect paging. Already aborted sync twice the same day (`2026-11-09-upstream-0344-sync-conflicts.md`). Precedent for silent feature death: 11-05 `agentSessionId` resolve.
3. **Main vs soup is intentional layering, not a bug to “fix.”** Main = 10-tool product union. Soup adds six layer tools. Tip-forward without restoring **layers** strands `:3006`; promoting layers onto main without upstream landings creates permanent shared-branch conflict. Lazy `runCli` on `main` (61 lines) vs soup (298) is the CLI twin of the same layering.
4. **Hot UI file coupling.** `session_job` + issue chips share `SessionRowSummary.tsx` with upstream presence work - see divergence plan options 1/2/3.
5. **Open PR rot.** `#1825` superseded by `#2298` but still open (**close it**); `#1564`/`#2010`/`#2021` CONFLICTING and aging; `#2251` CONFLICTING while descriptions already claim its behavior.

**Do-nothing burn rate:** one careful multi-hour **soup** absorb tax per upstream release (plus ongoing babysit of conflicting PRs), with a demonstrated non-zero chance of silently deleting layer capabilities that daily Meta/fleet workflows depend on.

### Suggested decision package (not executed)

1. **Close `#1825`** - superseded by merged `#2298`; do not leave it open as a fake landing signal.
2. **Land while MERGEABLE:** `#1424` (session_job), `#2164` (display prompts).
3. **Rebase CONFLICTING landings:** `#2010`, `#2021`, `#1564`, `#2251`.
4. **Open thin new PR:** `search_content` MCP/CLI wrapper only (see scope section) - no new hub search API.
5. **Keep deliberate fork-only / layer-only:** `set_voice_mode`, estate PATH wrappers, remat/soup, exit-0 backstop - accepted conflict budget. `link_issue` stays **uncertain** (split vs Boards).
6. **Do not** “fix” fork `main` by pushing soup-layer tools onto it. Main’s 10 is correct. Restore layers on soup absorbs; upstream them via PRs when landing.

### Friction mode (steelman)

**Opposite case:** stop upstreaming the fork extras; declare soup layers a permanent product fork for agent tooling; staff the absorb tax. Kill-criterion: if Meta cannot restore the full soup tip tool set within one absorb without a multi-hour archaeology (already failed once on 0.34.4 soup), the "keep fork-only" budget is a fiction - you are choosing silent capability loss, not ownership. Cheapest falsification: next upstream bump, time the `HapiMcpToolName` + bridge restore on soup and symbol-diff both parents; if restore >30 minutes or drops a symbol, the do-nothing plan is already falsified. Separately: if someone “fixes” main by promoting the six layer tools onto it without landings, that is also a fail - it converts intentional layering into permanent shared-branch conflict.

---

## Evidence index (primary)

- Upstream tool union: `git show upstream/main:cli/src/claude/utils/startHappyServer.ts` → `export type HapiMcpToolName` (9 names) + `enabledTools` / `includeTool` from `#2312`.
- Fork `main` / `origin/main`: shape-agnostic register count **10**, identical to `317cb3a27^1`.
- Soup tip: `~/coding/hapi/driver/cli/src/claude/utils/startHappyServer.ts` register/union **16**; restore commit `e08eb8b69` (soup-layer strip, not main loss).
- Live catalog: HAPI MCP namespace on this session (15 tools; no `set_voice_mode`).
- Cursor bridge defaults: `cli/src/codex/happyMcpStdioBridge.ts` `DEFAULT_TOOL_NAMES`.
- `search_content` wrapper: `cli/src/modules/searchContent/searchContent.ts`; upstream routes in `hub/src/web/routes/sessions.ts` (content-search).
- PR states: `gh pr view` as heavygee on `tiann/hapi` for `#1195 #1228 #1372 #1424 #1473 #1511 #1564 #1618 #1825 #1896 #1922 #2010 #2021 #2164 #2167 #2251 #2298 #2312` (and related).
- Identity: `gh api user` → heavygee; `gh-ll` → gavinc (not used).
