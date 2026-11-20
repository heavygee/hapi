#!/usr/bin/env bun
/**
 * Minimal YAML subset parser for config/driver-manifest.yaml (or HAPI_DRIVER_MANIFEST)
 * Supports: base, layers with branch / pr / integrate keys.
 */
import { readFileSync } from 'node:fs';

const path = process.argv[2];
if (!path) {
    console.error('Usage: parse-driver-manifest.mjs <manifest.yaml>');
    process.exit(2);
}

// Distinguish "your path is wrong" from "the manifest is bad". A raw fs stack
// trace reads like the manifest failed to parse, which is how a tooling seat
// came to report PARSE FAILED against a manifest that was fine (2026-11-20).
// Exit 2 matches the missing-argument case: both are caller errors, neither is
// a verdict about the manifest.
let text;
try {
    text = readFileSync(path, 'utf8');
} catch (err) {
    console.error(`parse-driver-manifest.mjs: cannot read manifest: ${path}`);
    console.error(`  ${err.message.split('\n')[0]}`);
    console.error('  This is a bad PATH, not a bad manifest.');
    process.exit(2);
}

const result = { base: 'upstream/main', layers: [] };

for (const raw of text.split('\n')) {
    const line = raw.replace(/#.*$/, '').trimEnd();
    if (!line.trim() || line.trim().startsWith('#')) continue;

    const baseMatch = line.match(/^base:\s*(.+)$/);
    if (baseMatch) {
        result.base = baseMatch[1].trim();
        continue;
    }

    const branchMatch = line.match(/^\s*-\s*branch:\s*(.+)$/);
    if (branchMatch) {
        result.layers.push({ type: 'branch', ref: branchMatch[1].trim() });
        continue;
    }

    const prMatch = line.match(/^\s*-\s*pr:\s*(\d+)\s*$/);
    if (prMatch) {
        result.layers.push({ type: 'pr', ref: Number(prMatch[1]) });
        continue;
    }

    const integrateMatch = line.match(/^\s*-\s*integrate:\s*(.+)$/);
    if (integrateMatch) {
        result.layers.push({ type: 'integrate', ref: integrateMatch[1].trim() });
        continue;
    }
}

console.log(JSON.stringify(result));
