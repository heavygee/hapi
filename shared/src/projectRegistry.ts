// Project registry utilities for multi-repo support
//
// Provides functions for reading project configuration and validating
// GitHub hosts for external reference parsing.

import fs from 'fs'
import path from 'path'

export interface ProjectTarget {
    id: string
    repo: string
    host: string
    control: 'ours' | 'theirs'
    primary: boolean
}

export interface Project {
    name: string
    description: string
    targets: ProjectTarget[]
}

export interface ProjectRegistry {
    projects: Record<string, Project>
    settings: {
        valid_hosts: string[]
        default_host: string
        discovery?: {
            merged_lookback_days: number
            min_pr_number: number
        }
        classification?: {
            stale_ms: number
            emit_events: boolean
        }
    }
}

let cachedRegistry: ProjectRegistry | null = null

function findConfigPath(): string | null {
    // Look for config/projects.yaml in current directory and up the tree
    let currentDir = process.cwd()
    const root = path.parse(currentDir).root
    
    while (currentDir !== root) {
        const configPath = path.join(currentDir, 'config', 'projects.yaml')
        if (fs.existsSync(configPath)) {
            return configPath
        }
        currentDir = path.dirname(currentDir)
    }
    
    return null
}

export function loadProjectRegistry(): ProjectRegistry {
    if (cachedRegistry) {
        return cachedRegistry
    }
    
    const configPath = findConfigPath()
    if (!configPath) {
        // Fallback to default configuration for backwards compatibility
        return {
            projects: {
                hapi: {
                    name: "HAPI Platform",
                    description: "Local-first AI agent platform",
                    targets: [
                        { id: "upstream", repo: "tiann/hapi", host: "github.com", control: "theirs", primary: true },
                        { id: "fork", repo: "heavygee/hapi", host: "github.com", control: "ours", primary: false }
                    ]
                }
            },
            settings: {
                valid_hosts: ["github.com"],
                default_host: "github.com"
            }
        }
    }
    
    try {
        // Simple YAML parsing - just need the hosts for now
        const content = fs.readFileSync(configPath, 'utf8')
        
        // Extract valid_hosts using regex (avoiding yaml dependency for now)
        const hostsMatch = content.match(/valid_hosts:\s*\n((?:\s*-\s*"[^"]+"\s*\n)*)/m)
        const validHosts = hostsMatch 
            ? hostsMatch[1].match(/"([^"]+)"/g)?.map(h => h.slice(1, -1)) || ["github.com"]
            : ["github.com"]
        
        const defaultHostMatch = content.match(/default_host:\s*(.+)/m)
        const defaultHost = defaultHostMatch?.[1]?.trim() || "github.com"
        
        cachedRegistry = {
            projects: {}, // Full parsing not needed for parser fix
            settings: {
                valid_hosts: validHosts,
                default_host: defaultHost
            }
        }
        
        return cachedRegistry
    } catch (error) {
        console.warn('Failed to load project registry, using defaults:', error)
        return {
            projects: {},
            settings: {
                valid_hosts: ["github.com"],
                default_host: "github.com"
            }
        }
    }
}

export function getValidGitHubHosts(): string[] {
    const registry = loadProjectRegistry()
    return registry.settings.valid_hosts
}

export function isValidGitHubHost(host: string): boolean {
    const validHosts = getValidGitHubHosts()
    return validHosts.includes(host)
}

export function getGitHubUrlForRepo(repo: string, number: number, host = "github.com"): string {
    return `https://${host}/${repo}/pull/${number}`
}