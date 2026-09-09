// Box MCP surface — ALLOWLIST (inverted from a denylist after the 2026-09-06
// adversarial review found 79 tools leaking through enumeration, including
// mac_file_read, task_enqueue spoofing, retriever_set SQL, and skill_set
// persistence). A box session registers ONLY these tools; everything else —
// present and future — is denied by default. You cannot forget to deny what
// is not allowed.
export const BOX_ALLOWED_TOOLS = new Set<string>([
	// procedural knowledge (skill bodies are not owner-private account data)
	'skill_search',
	'skill_load',
	// capability discovery
	'meta_list_capabilities',
	// mission-scoped credential reads (capability-gated + rate-limited server-side)
	'secret_resolve',
])

// Reviewer C1 (2026-09-06): the allowlist restricts tool NAMES, not DATA SCOPE.
// fs_read/fs_list/search/memory_recall return the whole account, not the box's
// own data — removed from the box surface. A mission that needs a specific fact
// or file gets it injected at launch (prompt/repo/sessions), not by reading the
// owner's global stores. secret_resolve stays (capability-gated) because verify
// flows need named secrets; scope it per-box when box principals land in secrets.

export function isBoxAllowedTool(name: string): boolean {
	return BOX_ALLOWED_TOOLS.has(name)
}
