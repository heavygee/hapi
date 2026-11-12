import { beforeEach, describe, expect, it, vi } from 'vitest'

type ToolHandler = (args: Record<string, unknown>) => Promise<unknown>

const harness = vi.hoisted(() => ({
    tools: new Map<string, ToolHandler>(),
    configs: new Map<string, Record<string, unknown>>(),
    registered: new Map<string, { enabled: boolean; enable(): void; disable(): void }>(),
    callTool: vi.fn(async (_request: unknown) => ({
        content: [{ type: 'text', text: 'forwarded' }],
        isError: false
    }))
}))

vi.mock('@modelcontextprotocol/sdk/server/mcp.js', () => ({
    McpServer: class {
        // The real SDK returns a RegisteredTool handle; link_pr uses its
        // enable()/disable() to track hub githubPrAwareness, so the mock has to
        // return one too or the bridge dies on an undefined handle.
        registerTool(name: string, config: Record<string, unknown>, handler: ToolHandler) {
            // The real SDK throws on a second registration of the same name, and
            // the bridge does not catch it: the process dies with
            // "[hapi-mcp] Fatal: Tool <name> is already registered" and the
            // session gets NO tools at all. A bare Map just overwrote, so this
            // whole suite stayed green while an absorb had duplicated the
            // session_job block and broken MCP for every new session
            // (2026-11-12). Match the SDK so the next duplicate fails here
            // rather than in production.
            if (harness.tools.has(name)) throw new Error(`Tool ${name} is already registered`)
            harness.tools.set(name, handler)
            harness.configs.set(name, config)
            const tool = {
                enabled: true,
                enable(): void { tool.enabled = true },
                disable(): void { tool.enabled = false }
            }
            harness.registered.set(name, tool)
            return tool
        }

        async connect(): Promise<void> {}
    }
}))

vi.mock('@modelcontextprotocol/sdk/server/stdio.js', () => ({
    StdioServerTransport: class {}
}))

vi.mock('@modelcontextprotocol/sdk/client/index.js', () => ({
    Client: class {
        async connect(): Promise<void> {}

        async callTool(request: unknown): Promise<unknown> {
            return harness.callTool(request)
        }
    }
}))

vi.mock('@modelcontextprotocol/sdk/client/streamableHttp.js', () => ({
    StreamableHTTPClientTransport: class {
        constructor(_url: URL) {}
    }
}))

import { runHappyMcpStdioBridge } from './happyMcpStdioBridge'

describe('runHappyMcpStdioBridge tool forwarding', () => {
    beforeEach(() => {
        harness.tools.clear()
        harness.configs.clear()
        harness.callTool.mockClear()
    })

    it('describes display_image as user output rather than image input', async () => {
        await runHappyMcpStdioBridge([
            '--url',
            'http://127.0.0.1:43006',
            '--tools',
            'display_image'
        ])

        const description = harness.configs.get('display_image')?.description
        expect(description).toContain('human user')
        expect(description).toContain('does not provide image input to the model')
        expect(description).toContain('cannot be used to read, inspect, or analyze image contents')
    })

    it('registers and forwards skill_lookup when the HTTP server enables it', async () => {
        await runHappyMcpStdioBridge([
            '--url',
            'http://127.0.0.1:43006',
            '--tools',
            'change_title,display_image,display_video,display_media,display_links,list_peers,ping_peer,inspect_peer,session_job,skill_lookup'
        ])

        expect([...harness.tools.keys()].sort()).toEqual([
            'change_title',
            'display_image',
            'display_media',
            'display_links',
            'display_video',
            'inspect_peer',
            'list_peers',
            'ping_peer',
            'session_job',
            'skill_lookup',
        ].sort())

        const handler = harness.tools.get('skill_lookup')
        expect(handler).toBeDefined()
        await expect(handler?.({ name: 'review' })).resolves.toEqual({
            content: [{ type: 'text', text: 'forwarded' }],
            isError: false
        })
        expect(harness.callTool).toHaveBeenCalledWith({
            name: 'skill_lookup',
            arguments: { name: 'review' }
        })
    })

    it('keeps skill_lookup hidden when the upstream HTTP server does not enable it', async () => {
        await runHappyMcpStdioBridge([
            '--url',
            'http://127.0.0.1:43006',
            '--tools',
            'change_title,display_image,display_video'
        ])

        expect([...harness.tools.keys()]).toEqual(['change_title', 'display_image', 'display_video'])
    })

    it('forwards display_links arguments unchanged', async () => {
        await runHappyMcpStdioBridge([
            '--url',
            'http://127.0.0.1:43006',
            '--tools',
            'display_links'
        ])

        const handler = harness.tools.get('display_links')
        const href = 'https://github.com/tia' + 'nn' + '/hapi/issues/1516'
        await expect(handler?.({ urls: [{ href, title: 'Issue 1516' }] })).resolves.toEqual({
            content: [{ type: 'text', text: 'forwarded' }],
            isError: false
        })
        expect(harness.callTool).toHaveBeenCalledWith({
            name: 'display_links',
            arguments: { urls: [{ href, title: 'Issue 1516' }] }
        })
    })

    it('forwards display_media arguments unchanged', async () => {
        await runHappyMcpStdioBridge([
            '--url',
            'http://127.0.0.1:43006',
            '--tools',
            'display_media'
        ])

        const handler = harness.tools.get('display_media')
        await expect(handler?.({ path: '/tmp/sample.wav', title: 'sample.wav' })).resolves.toEqual({
            content: [{ type: 'text', text: 'forwarded' }],
            isError: false
        })
        expect(harness.callTool).toHaveBeenCalledWith({
            name: 'display_media',
            arguments: { path: '/tmp/sample.wav', title: 'sample.wav' }
        })
    })

    it('registers ping_peer when included in --tools', async () => {
        await runHappyMcpStdioBridge([
            '--url',
            'http://127.0.0.1:43006',
            '--tools',
            'change_title,display_image,display_video,display_media,ping_peer'
        ])

        expect([...harness.tools.keys()]).toEqual([
            'change_title',
            'display_image',
            'display_video',
            'display_media',
            'ping_peer'
        ])
    })

    it('registers session_job when included in --tools', async () => {
        await runHappyMcpStdioBridge([
            '--url',
            'http://127.0.0.1:43006',
            '--tools',
            'change_title,display_image,list_peers,ping_peer,inspect_peer,session_job'
        ])

        expect([...harness.tools.keys()].sort()).toEqual([
            'change_title',
            'display_image',
            'inspect_peer',
            'list_peers',
            'ping_peer',
            'session_job',
        ].sort())
    })

    it.each(['auto', 'queue', 'steer'])('advertises and forwards ping_peer delivery mode %s', async (deliveryMode) => {
        await runHappyMcpStdioBridge(['--url', 'http://127.0.0.1:43006', '--tools', 'ping_peer'])
        const schema = harness.configs.get('ping_peer')?.inputSchema as {
            parse(input: unknown): unknown
        }
        const args = { sessionIdPrefix: 'peer-id', message: 'hello', deliveryMode }
        expect(harness.configs.get('ping_peer')?.description).toContain('auto (default)')
        expect(schema.parse(args)).toEqual(args)
        expect(() => schema.parse({ ...args, deliveryMode: 'interrupt' })).toThrow()
        await harness.tools.get('ping_peer')?.(args)
        expect(harness.callTool).toHaveBeenCalledWith({ name: 'ping_peer', arguments: args })
    })

    it('registers inspect_peer when included in --tools', async () => {
        await runHappyMcpStdioBridge([
            '--url',
            'http://127.0.0.1:43006',
            '--tools',
            'change_title,display_image,display_video,display_media,ping_peer,inspect_peer'
        ])

        expect([...harness.tools.keys()]).toEqual([
            'change_title',
            'display_image',
            'display_video',
            'display_media',
            'ping_peer',
            'inspect_peer'
        ])
    })
    it('registers spawn_peer when included in --tools', async () => {
        await runHappyMcpStdioBridge([
            '--url',
            'http://127.0.0.1:43006',
            '--tools',
            'change_title,display_image,display_video,display_media,spawn_peer'
        ])

        expect([...harness.tools.keys()]).toEqual([
            'change_title',
            'display_image',
            'display_video',
            'display_media',
            'spawn_peer'
        ])
    })

    it('registers and forwards link_issue when included in --tools', async () => {
        await runHappyMcpStdioBridge([
            '--url',
            'http://127.0.0.1:43006',
            '--tools',
            'change_title,link_issue'
        ])

        expect([...harness.tools.keys()]).toEqual(['change_title', 'link_issue'])

        const handler = harness.tools.get('link_issue')
        expect(handler).toBeTypeOf('function')
    })

    it('registers list_peers when included in --tools', async () => {
        await runHappyMcpStdioBridge([
            '--url',
            'http://127.0.0.1:43006',
            '--tools',
            'change_title,display_image,display_video,display_media,list_peers,search_peers,ping_peer,inspect_peer'
        ])

        expect([...harness.tools.keys()]).toEqual([
            'change_title',
            'display_image',
            'display_video',
            'display_media',
            'ping_peer',
            'inspect_peer',
            'list_peers',
            'search_peers',
        ])
    })

    it('registers search_peers when included in --tools', async () => {
        await runHappyMcpStdioBridge([
            '--url',
            'http://127.0.0.1:43006',
            '--tools',
            'search_peers'
        ])

        expect([...harness.tools.keys()]).toEqual(['search_peers'])
    })

    it('registers archive_peer when included in --tools', async () => {
        await runHappyMcpStdioBridge([
            '--url',
            'http://127.0.0.1:43006',
            '--tools',
            'archive_peer'
        ])

        expect([...harness.tools.keys()]).toEqual(['archive_peer'])
    })

    it('hides peer tools under HAPI_DISABLE_PEER_TOOLS even when listed in --tools', async () => {
        process.env.HAPI_DISABLE_PEER_TOOLS = '1'
        try {
            await runHappyMcpStdioBridge([
                '--url',
                'http://127.0.0.1:43006',
                '--tools',
                'change_title,list_peers,ping_peer,inspect_peer'
            ])

            expect([...harness.tools.keys()]).toEqual(['change_title'])
        } finally {
            delete process.env.HAPI_DISABLE_PEER_TOOLS
        }
    })

    it('drops peer tools from the default tool list under HAPI_DISABLE_PEER_TOOLS', async () => {
        // No --tools: the bridge seeds its default list, which includes the
        // peer tools. Positive control first so the disabled run below proves
        // filtering rather than an empty seed.
        await runHappyMcpStdioBridge(['--url', 'http://127.0.0.1:43006'])

        const seeded = [...harness.tools.keys()]
        for (const name of ['change_title', 'list_peers', 'search_peers', 'ping_peer', 'inspect_peer', 'spawn_peer', 'archive_peer', 'search_content']) {
            expect(seeded).toContain(name)
        }
        // The fork's default list, not upstream's: link_issue/link_pr and the
        // soup peer tools (search_peers, archive_peer) are fork-only. The
        // upstream expectation here contradicted the positive control three
        // lines above, which already required search_peers and archive_peer.
        expect([...harness.tools.keys()]).toEqual([
            'change_title',
            'link_pr',
            'link_issue',
            'display_image',
            'display_video',
            'display_media',
            'session_job',
            'ping_peer',
            'spawn_peer',
            'archive_peer',
            'inspect_peer',
            'list_peers',
            'search_peers',
            'search_content'
        ])

        harness.tools.clear()
        harness.configs.clear()

        process.env.HAPI_DISABLE_PEER_TOOLS = '1'
        try {
            await runHappyMcpStdioBridge(['--url', 'http://127.0.0.1:43006'])

            const remaining = [...harness.tools.keys()]
            for (const name of ['list_peers', 'search_peers', 'ping_peer', 'inspect_peer', 'spawn_peer', 'archive_peer']) {
                expect(remaining).not.toContain(name)
            }
            // search_content is a transcript search, not a peer tool: it survives the kill switch.
            for (const name of ['change_title', 'display_image', 'display_video', 'display_media', 'search_content']) {
                expect(remaining).toContain(name)
            }
            // session_job is own-session — kept when peer tools are stripped.
            expect([...harness.tools.keys()]).toEqual([
                'change_title',
                'link_pr',
                'link_issue',
                'display_image',
                'display_video',
                'display_media',
                'session_job',
                'search_content',
            ])
        } finally {
            delete process.env.HAPI_DISABLE_PEER_TOOLS
        }
    })
})
