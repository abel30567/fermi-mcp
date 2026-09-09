import { describe, expect, it } from 'vitest'
import { BOX_ALLOWED_TOOLS, isBoxAllowedTool } from '../src/lib/box-scope.ts'
import { defineTool } from '../src/lib/tool.ts'
import type { FermiMCP } from '../src/mcp/index.ts'

function fakeAgent(principal: 'owner' | 'box') {
	const registered: string[] = []
	const agent = {
		principal,
		bindings: {},
		state: {},
		server: {
			tool: (name: string) => {
				registered.push(name)
			},
		},
	} as unknown as FermiMCP
	return { agent, registered }
}

const def = (name: string, risk: 'low' | 'high' = 'low') => ({
	name,
	description: 'x',
	schema: {},
	scope: ['read'],
	risk,
	mutates: false,
	handler: async () => ({ content: [] }),
})

describe('box tool scoping', () => {
	it('denies fleet control, mac lateral movement, secret mutation, and persistence', () => {
		for (const t of [
			'cloud_agent_launch',
			'cloud_agent_destroy',
			'channel_send',
			'secret_set',
			'oauth_register_client',
			'schedule_create',
			'hooks_register',
			'team_spawn',
			// the reviewer-found gap: read/exfil mac tools must be denied too —
			// the entire mac_ prefix is denied structurally, present and future
			'mac_shell',
			'mac_file_read',
			'mac_file_move',
			'mac_screenshot',
			'mac_screen_ocr',
			'mac_clipboard_get',
			'mac_clipboard_set',
			'mac_system_info',
			'mac_some_future_tool',
		]) {
			expect(isBoxAllowedTool(t)).toBe(false)
		}
		expect(BOX_ALLOWED_TOOLS.has('cloud_agent_launch')).toBe(false)
	})

	it('keeps the tools verification agents actually need', () => {
		for (const t of ['secret_resolve', 'skill_load', 'skill_search', 'meta_list_capabilities']) {
			expect(isBoxAllowedTool(t)).toBe(true)
		}
		// review C-2/C-3/C-4/M-4: these were the leak paths — must stay off
		for (const t of [
			'task_enqueue',
			'task_claim',
			'task_complete',
			'task_wait',
			'retriever_set',
			'retriever_run',
			'skill_set',
			'profile_update',
			'memory_write',
			'package_set',
			'context_bootstrap',
			'conversation_history',
			'session_search',
			'web_session_list',
			'web_session_get',
			'fs_write',
			'execute',
			'totp_setup',
			'browser_session_launch',
			'any_future_tool',
		]) {
			expect(isBoxAllowedTool(t)).toBe(false)
		}
	})

	it('a box session skips registration of denied tools but keeps allowed ones', () => {
		const { agent, registered } = fakeAgent('box')
		defineTool(agent, def('cloud_agent_launch', 'high'))
		defineTool(agent, def('secret_set', 'high'))
		defineTool(agent, def('task_enqueue'))
		defineTool(agent, def('secret_resolve'))
		defineTool(agent, def('skill_load'))
		expect(registered).toEqual(['secret_resolve', 'skill_load'])
	})

	it('an owner session registers everything', () => {
		const { agent, registered } = fakeAgent('owner')
		defineTool(agent, def('cloud_agent_launch', 'high'))
		defineTool(agent, def('secret_resolve'))
		expect(registered).toEqual(['cloud_agent_launch', 'secret_resolve'])
	})
})
