import { z } from 'zod'
import { defineCapability } from '../lib/capability.ts'
import {
	deleteMemory,
	listRecentMemories,
	recallMemories,
	updateMemory,
	writeMemory,
} from '../lib/memory-store.ts'

export function registerMemoryCapabilities() {
	defineCapability({
		name: 'memory_recall',
		domain: 'memory',
		description:
			'Query memories by keyword. Returns matching non-decayed memories, pinned first by default.',
		inputSchema: z.object({
			query: z.string().describe('Search term to match against memory body'),
			limit: z.number().int().min(1).max(100).default(10),
			sort_by: z
				.enum(['relevance', 'created_at'])
				.default('relevance')
				.describe("'relevance' = pinned-first then newest; 'created_at' = pure recency"),
		}),
		scope: ['read'],
		risk: 'low',
		readOnly: true,
		idempotent: true,
		keywords: ['memory', 'recall', 'search', 'query'],
		handler: async (args, env) => {
			const results = await recallMemories(args.query, args.limit, env, args.sort_by)
			return { results, total: results.length }
		},
	})

	defineCapability({
		name: 'memory_list_recent',
		domain: 'memory',
		description: 'List the N most recently created non-decayed memories, newest first.',
		inputSchema: z.object({
			limit: z.number().int().min(1).max(100).default(10),
		}),
		scope: ['read'],
		risk: 'low',
		readOnly: true,
		idempotent: true,
		keywords: ['memory', 'recent', 'latest', 'newest', 'list'],
		handler: async (args, env) => {
			const results = await listRecentMemories(args.limit, env)
			return { results, total: results.length }
		},
	})

	defineCapability({
		name: 'memory_write',
		domain: 'memory',
		description: 'Store a new memory entry. Optionally pin it to prevent decay.',
		inputSchema: z.object({
			kind: z.enum(['fact', 'preference', 'event']),
			body: z.string().min(1),
			pinned: z.boolean().default(false),
		}),
		scope: ['write:memory'],
		risk: 'low',
		readOnly: false,
		keywords: ['memory', 'store', 'write', 'save', 'remember'],
		handler: async (args, env) => writeMemory(args, env),
	})

	defineCapability({
		name: 'memory_update',
		domain: 'memory',
		description: 'Update an existing memory by id; only provided fields change.',
		inputSchema: z.object({
			id: z.number().int(),
			patch: z.object({
				kind: z.enum(['fact', 'preference', 'event']).optional(),
				body: z.string().optional(),
				pinned: z.boolean().optional(),
			}),
		}),
		scope: ['write:memory'],
		risk: 'low',
		readOnly: false,
		keywords: ['memory', 'update', 'edit'],
		handler: async (args, env) => updateMemory(args.id, args.patch, env),
	})

	defineCapability({
		name: 'memory_delete',
		domain: 'memory',
		description: 'Soft-delete a memory by marking it as decayed.',
		inputSchema: z.object({ id: z.number().int() }),
		scope: ['write:memory'],
		risk: 'med',
		readOnly: false,
		destructive: true,
		keywords: ['memory', 'delete', 'forget'],
		handler: async (args, env) => deleteMemory(args.id, env),
	})
}
