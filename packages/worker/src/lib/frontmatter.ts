export interface SkillFrontmatter {
	name?: string
	description?: string
	keywords?: string[]
	allowed_tools?: string[]
}

function parseList(value: string): string[] {
	try {
		const parsed = JSON.parse(value)
		if (Array.isArray(parsed)) return parsed.map(String)
	} catch {
		// fall through to comma-split
	}
	return value
		.split(',')
		.map((s) => s.trim().replace(/^["']|["']$/g, ''))
		.filter(Boolean)
}

/**
 * Parse a `---`-fenced frontmatter block from a SKILL.md document.
 * Lines are `key: value`; `keywords` and `allowed_tools` accept JSON arrays
 * or comma-separated values. Returns the remaining markdown as `body`.
 */
export function parseFrontmatter(md: string): { meta: SkillFrontmatter; body: string } {
	const meta: SkillFrontmatter = {}
	if (!md.startsWith('---')) return { meta, body: md }
	const end = md.indexOf('\n---', 3)
	if (end < 0) return { meta, body: md }

	const block = md.slice(md.indexOf('\n') + 1, end)
	const body = md.slice(end + '\n---'.length).replace(/^\r?\n/, '')

	for (const line of block.split('\n')) {
		const colon = line.indexOf(':')
		if (colon < 0) continue
		const key = line.slice(0, colon).trim()
		const value = line.slice(colon + 1).trim()
		if (!value) continue
		if (key === 'name') meta.name = value
		else if (key === 'description') meta.description = value
		else if (key === 'keywords') meta.keywords = parseList(value)
		else if (key === 'allowed_tools') meta.allowed_tools = parseList(value)
	}
	return { meta, body }
}

export function serializeFrontmatter(meta: SkillFrontmatter, body: string): string {
	const lines: string[] = ['---']
	if (meta.name) lines.push(`name: ${meta.name}`)
	if (meta.description) lines.push(`description: ${meta.description}`)
	if (meta.keywords?.length) lines.push(`keywords: ${JSON.stringify(meta.keywords)}`)
	if (meta.allowed_tools?.length) lines.push(`allowed_tools: ${JSON.stringify(meta.allowed_tools)}`)
	lines.push('---', '')
	return `${lines.join('\n')}${body}`
}
