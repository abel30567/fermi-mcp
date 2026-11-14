// Knowledge MCP surface (ISSUE-88) — ALLOWLIST, default deny, like box-scope.ts.
// A knowledge session (/k/mcp) registers ONLY these tools. The allowlist limits
// tool names; the data wall is in the handlers: every one of these tools reads
// and writes only its token's namespace (lib/knowledge-store.ts).
export const KNOWLEDGE_ALLOWED_TOOLS = new Set<string>([
	'skill_search',
	'skill_load',
	'skill_set',
	'memory_recall',
	'memory_write',
	'search',
])

export function isKnowledgeAllowedTool(name: string): boolean {
	return KNOWLEDGE_ALLOWED_TOOLS.has(name)
}
