#!/usr/bin/env bash
# project-registry.sh - Multi-repo project registry for PR classification
#
# Provides functions for:
# - Loading project configuration from YAML
# - Resolving repo targets and metadata
# - Determining control semantics (ours vs theirs)
# - GitHub host handling (github.com vs GHES)

set -euo pipefail

# Default paths
DEFAULT_PROJECTS_CONFIG="${HAPI_PROJECTS_CONFIG:-config/projects.yaml}"

# Global variables for caching
declare -A PR_PROJECT_CACHE=()
declare -A PR_REPO_TO_PROJECT=()
declare -g PR_CONFIG_LOADED=""

# Load project configuration from YAML
# Usage: pr_load_config [config_path]
pr_load_config() {
    local config_path="${1:-$DEFAULT_PROJECTS_CONFIG}"
    
    if [[ ! -f "$config_path" ]]; then
        echo "ERROR: Project config not found: $config_path" >&2
        return 1
    fi
    
    # Mark as loaded
    PR_CONFIG_LOADED="$config_path"
    
    # Build cache of repo -> project mappings
    local projects
    projects=$(yq eval '.projects | keys | .[]' "$config_path" 2>/dev/null || echo "")
    
    for project in $projects; do
        local targets_json
        targets_json=$(yq eval ".projects.$project.targets" "$config_path" -o json 2>/dev/null || echo "[]")
        
        # Parse each target
        echo "$targets_json" | jq -r '.[] | @base64' | while read -r encoded_target; do
            local target_json
            target_json=$(echo "$encoded_target" | base64 -d)
            
            local repo host target_id control primary
            repo=$(echo "$target_json" | jq -r '.repo // empty')
            host=$(echo "$target_json" | jq -r '.host // "github.com"')
            target_id=$(echo "$target_json" | jq -r '.id // "upstream"')
            control=$(echo "$target_json" | jq -r '.control // "theirs"')
            primary=$(echo "$target_json" | jq -r '.primary // false')
            
            if [[ -n "$repo" && "$repo" != "null" ]]; then
                # Cache repo -> project mapping
                PR_REPO_TO_PROJECT["$repo"]="$project"
                
                # Cache full target info
                local cache_key="$project:$target_id"
                PR_PROJECT_CACHE["$cache_key:repo"]="$repo"
                PR_PROJECT_CACHE["$cache_key:host"]="$host"
                PR_PROJECT_CACHE["$cache_key:control"]="$control" 
                PR_PROJECT_CACHE["$cache_key:primary"]="$primary"
            fi
        done
    done
}

# Get project name for a repository
# Usage: pr_get_project_for_repo "owner/name"
pr_get_project_for_repo() {
    local repo="$1"
    
    # Ensure config is loaded
    if [[ -z "$PR_CONFIG_LOADED" ]]; then
        pr_load_config
    fi
    
    echo "${PR_REPO_TO_PROJECT[$repo]:-}"
}

# Get target information for a repository
# Usage: pr_get_target_for_repo "owner/name"
# Returns: "target_id\tcontrol\thost\tprimary"
pr_get_target_for_repo() {
    local repo="$1"
    
    # Direct lookup using yq
    local target_info
    target_info=$(yq eval ".projects[] | .targets[] | select(.repo == \"$repo\") | [.id // \"upstream\", .control // \"theirs\", .host // \"github.com\", .primary // false] | @tsv" "$DEFAULT_PROJECTS_CONFIG" 2>/dev/null | head -1)
    
    if [[ -n "$target_info" ]]; then
        echo "$target_info"
    else
        # Default fallback for unknown repos
        echo "upstream	theirs	github.com	true"
    fi
}

# Get all repositories for a project
# Usage: pr_get_project_repos "project_name"
# Returns: One repo per line
pr_get_project_repos() {
    local project="$1"
    
    yq eval ".projects.$project.targets[].repo" "$DEFAULT_PROJECTS_CONFIG" 2>/dev/null || true
}

# Get all projects
# Usage: pr_get_all_projects
pr_get_all_projects() {
    yq eval '.projects | keys | .[]' "$DEFAULT_PROJECTS_CONFIG" 2>/dev/null || true
}

# Get all monitored repositories
# Usage: pr_get_all_monitored_repos
pr_get_all_monitored_repos() {
    local repos=()
    
    # Get all projects and their repos
    local projects
    projects=$(pr_get_all_projects)
    for project in $projects; do
        local project_repos
        project_repos=$(pr_get_project_repos "$project")
        for repo in $project_repos; do
            repos+=("$repo")
        done
    done
    
    printf '%s\n' "${repos[@]}" | sort -u
}

# Get GitHub host for repository
# Usage: pr_get_repo_host "owner/name"
pr_get_repo_host() {
    local repo="$1"
    local target_info
    target_info=$(pr_get_target_for_repo "$repo")
    
    echo "$target_info" | cut -f3
}

# Check if we can access GitHub host for repository
# Usage: pr_check_repo_access "owner/name"
pr_check_repo_access() {
    local repo="$1"
    local host
    host=$(pr_get_repo_host "$repo")
    
    if [[ "$host" == "github.com" ]]; then
        # Standard GitHub - use regular gh
        gh auth status >/dev/null 2>&1
    else
        # GHES - check if gh can access it
        # Try a simple API call to test connectivity
        gh api --hostname "$host" /user >/dev/null 2>&1
    fi
}

# Execute gh command with appropriate host
# Usage: pr_gh_for_repo "owner/name" [gh_args...]
pr_gh_for_repo() {
    local repo="$1"
    shift
    
    local host
    host=$(pr_get_repo_host "$repo")
    
    if [[ "$host" == "github.com" ]]; then
        gh "$@"
    else
        gh --hostname "$host" "$@"
    fi
}

# Backwards compatibility function for existing code
# Usage: pec_pr_target_for_repo "owner/name"
# Returns: "target_id\tcontrol" (matches existing format)
pec_pr_target_for_repo() {
    local repo="$1"
    local target_info
    target_info=$(pr_get_target_for_repo "$repo" 2>/dev/null) || {
        # Fallback to default if registry fails
        echo "upstream	theirs"
        return 0
    }
    
    # Extract target_id and control (first two fields)
    echo "$target_info" | cut -f1-2
}

# Test function to validate configuration
pr_test_config() {
    local config_path="${1:-$DEFAULT_PROJECTS_CONFIG}"
    
    echo "Testing project registry configuration: $config_path"
    
    if [[ ! -f "$config_path" ]]; then
        echo "ERROR: Config file not found"
        return 1
    fi
    
    # Test YAML parsing
    if ! yq eval '.' "$config_path" >/dev/null 2>&1; then
        echo "ERROR: Invalid YAML syntax"
        return 1
    fi
    
    # Load and test
    pr_load_config "$config_path"
    
    echo "Projects found:"
    pr_get_all_projects | while read -r project; do
        echo "  $project:"
        pr_get_project_repos "$project" | while read -r repo; do
            local target_info
            target_info=$(pr_get_target_for_repo "$repo")
            echo "    $repo -> $target_info"
        done
    done
    
    echo "Configuration test passed"
}

# If run directly, run tests
if [[ "${BASH_SOURCE[0]}" == "${0}" ]]; then
    pr_test_config "$@"
fi