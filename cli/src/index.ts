#!/usr/bin/env bun

// Drain resume mint-proof from stdio fd before any other CLI work awaits
// (pass 2f B1 — same-UID /proc/<pid>/fd race). Side effect on import.
import '@/agent/peerSessionTagFd'
import { runCli } from './commands/runCli'

void runCli()
