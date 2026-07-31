#!/usr/bin/env bun
/**
 * Overseer live-brain tool-selection battery (opt-in, needs a running brain + a GPU).
 *
 * The replay harness (hub/src/overseer/replayHarness.ts) is deterministic and CI-safe — it never
 * touches an LLM. This battery is the complement: it drives scripted operator utterances through the
 * REAL overseer tool schemas + system prompt against a live OpenAI-compatible brain and asserts which
 * tool the model picks (and key args) in a single round. It is NOT a CI test (no GPU in CI) — run it
 * by hand when validating a brain/model against the tool surface.
 *
 * Usage:
 *   BRAIN_URL=http://127.0.0.1:8080/v1 bun scripts/tooling/overseer-brain-battery.mjs
 *   BRAIN_URL=https://api.openai.com/v1 BRAIN_MODEL=gpt-4o BRAIN_API_KEY=sk-... bun scripts/tooling/overseer-brain-battery.mjs
 *
 * Exit code: 0 if every scenario passes, 1 otherwise.
 */
import { buildOverseerOpenAiTools, buildOverseerSystemPrompt } from '@hapi/protocol'

const BRAIN = (process.env.BRAIN_URL ?? 'http://127.0.0.1:8080/v1').replace(/\/+$/, '')
const MODEL = process.env.BRAIN_MODEL ?? 'main'
const API_KEY = process.env.BRAIN_API_KEY ?? ''
const tools = buildOverseerOpenAiTools()
const system = buildOverseerSystemPrompt()

/** Each scenario: an operator line + a predicate over the first tool call (null tc = the brain answered without a tool). */
const scenarios = [
    { name: 'inbox read', user: "What's waiting in my inbox right now?", check: (tc) => tc?.name === 'query_inbox' },
    { name: 'neglect lens', user: 'What am I forgetting? Anything I abandoned?', check: (tc) => tc?.name === 'query_open_loops' },
    {
        name: 'record done (write)',
        user: 'Mark inbox item 42 as done — it shipped.',
        check: (tc) => tc?.name === 'record_disposition' && tc.args?.itemId === 42 && tc.args?.action === 'done'
    },
    {
        name: 'record dismiss (write)',
        user: 'Dismiss item 7, it is just the routine PR-flood noise.',
        check: (tc) => tc?.name === 'record_disposition' && tc.args?.itemId === 7 && tc.args?.action === 'dismiss'
    },
    {
        name: 'dispositions cluster (discovery)',
        user: 'Show me what I have dispositioned recently, grouped by category.',
        check: (tc) => tc?.name === 'query_dispositions' && Array.isArray(tc.args?.groupBy) && tc.args.groupBy.includes('category')
    },
    {
        name: 'GUARD: asking-about must not write',
        user: 'What is the status of item 5? I just want to know, do not change anything.',
        check: (tc) => tc == null || tc.name !== 'record_disposition'
    }
]

async function askOnce(user) {
    const res = await fetch(`${BRAIN}/chat/completions`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...(API_KEY ? { Authorization: `Bearer ${API_KEY}` } : {}) },
        body: JSON.stringify({
            model: MODEL,
            messages: [{ role: 'system', content: system }, { role: 'user', content: user }],
            tools,
            tool_choice: 'auto',
            temperature: 0,
            max_tokens: 512
        })
    })
    if (!res.ok) throw new Error(`brain ${res.status}: ${(await res.text()).slice(0, 200)}`)
    const data = await res.json()
    const call = data.choices?.[0]?.message?.tool_calls?.[0]
    if (!call) return { tc: null, raw: data.choices?.[0]?.message?.content ?? '' }
    let args = {}
    try { args = JSON.parse(call.function?.arguments ?? '{}') } catch { args = { _unparsed: call.function?.arguments } }
    return { tc: { name: call.function?.name, args }, raw: '' }
}

console.log(`Overseer brain battery -> ${BRAIN} (model=${MODEL})\n`)
let pass = 0
for (const s of scenarios) {
    const t0 = Date.now()
    try {
        const { tc, raw } = await askOnce(s.user)
        const ok = s.check(tc)
        if (ok) pass += 1
        const shown = tc ? `${tc.name}(${JSON.stringify(tc.args)})` : `NO TOOL — "${raw.slice(0, 60)}"`
        console.log(`${ok ? 'PASS' : 'FAIL'}  [${Date.now() - t0}ms]  ${s.name}\n        -> ${shown}`)
    } catch (e) {
        console.log(`ERROR ${s.name}: ${e.message}`)
    }
}
console.log(`\n${pass}/${scenarios.length} scenarios passed`)
process.exit(pass === scenarios.length ? 0 : 1)
