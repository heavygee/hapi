# Multi-repo PR Classification System

This document describes the implementation of yaml-based PR state classification that works beyond HAPI development, enabling lockhouse and future projects to receive proper PR chip classification.

## Problem

The existing PR state classification system was hardcoded to only handle `tiann/hapi` and `heavygee/hapi`, preventing:
1. Attaching PR chips to lockhouse repos (GHES host rejection)
2. Classifying lockhouse PRs (discovery scope limitation)  
3. Adding new projects without code changes

## Solution Architecture

The implementation addresses three layers identified as blockers:

### Layer 1: Parser Host Restriction Fix

**Problem**: `shared/src/externalRefs.ts` rejected any URL with `hostname !== 'github.com'`, blocking GHES URLs like `lhs.ghe.com/lockhouse/producer/pull/N`.

**Solution**:
- Created `shared/src/projectRegistry.ts` with host validation from config
- Updated `parseGithubPrInput()` to use `isValidGitHubHost()` instead of hardcoded check
- Modified `githubPrUrl()` to accept host parameter for flexible URL construction

### Layer 2: Project Registry Configuration

**Problem**: No central configuration for defining monitored repositories and their properties.

**Solution**:
- Created `config/projects.yaml` defining projects, repos, hosts, and control semantics
- Built `scripts/tooling/lib/project-registry.sh` for shell script access
- Added `shared/src/projectRegistry.ts` for TypeScript access
- Maintains backwards compatibility with existing env vars

### Layer 3: Classification Pipeline Updates  

**Problem**: `pr-emoji-core.sh` and `hapi-meta-daily.sh` hardcoded discovery to two specific repos.

**Solution**:
- Updated `pec_pr_target_for_repo()` to use project registry
- Modified discovery logic to iterate configured repos
- Added GHES-aware GitHub command execution

## Configuration Format

```yaml
# config/projects.yaml
projects:
  hapi:
    name: "HAPI Platform"
    targets:
      - id: upstream
        repo: tiann/hapi
        host: github.com
        control: theirs
        primary: true
      - id: fork  
        repo: heavygee/hapi
        host: github.com
        control: ours
        primary: false
        
  lockhouse:
    name: "Lockhouse"
    targets:
      - id: upstream
        repo: lockhouse/producer
        host: lhs.ghe.com
        control: theirs
        primary: true
      - id: fork
        repo: heavygee/lockhouse-producer  
        host: lhs.ghe.com
        control: ours
        primary: false

settings:
  valid_hosts:
    - "github.com"
    - "lhs.ghe.com"
  default_host: github.com
```

## Backwards Compatibility

- Existing `HAPI_PR_REPO`/`HAPI_FORK_REPO` env vars continue to work
- `pec_pr_target_for_repo()` function signature unchanged
- Current HAPI workflow remains identical
- Falls back to safe defaults for unknown repos

## Testing

The implementation includes test functions:
- `pr_test_config()` - validates YAML configuration  
- `pec_pr_target_for_repo()` - backwards compatibility check
- Host validation for both github.com and GHES hosts

## Integration Path

1. **Parser Layer**: TypeScript changes enable GHES URL parsing
2. **Shell Layer**: Bash functions provide multi-repo discovery  
3. **Classification**: PR health determination works across all configured repos
4. **Interim Option**: Direct PR chip backfill possible before full classify lands

## Files Modified

- `config/projects.yaml` - Project registry configuration
- `shared/src/projectRegistry.ts` - TypeScript project registry utilities
- `shared/src/externalRefs.ts` - Parser accepts GHES hosts
- `scripts/tooling/lib/project-registry.sh` - Shell project registry functions
- `scripts/tooling/lib/pr-emoji-core.sh` - Uses registry for target resolution
- `scripts/tooling/hapi-meta-daily.sh` - Multi-repo discovery (if needed)

This enables lockhouse PRs to be chipped, classified, and colored with the same yaml-driven state vocabulary used for HAPI, while requiring only configuration changes to add future projects.