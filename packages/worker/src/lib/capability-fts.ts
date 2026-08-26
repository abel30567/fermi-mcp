import { type CapabilityDef, getCapabilityRegistry } from './capability.ts'

interface CapabilityIndexEntry {
	cap: CapabilityDef
	tokens: Set<string>
	trigrams: Set<string>
}

let cached: { snapshot: CapabilityDef[]; index: CapabilityIndexEntry[] } | null = null

function tokenize(text: string): string[] {
	return text
		.toLowerCase()
		.split(/[^a-z0-9_]+/)
		.filter((t) => t.length > 0)
}

function trigramsOf(text: string): Set<string> {
	const t = ` ${text.toLowerCase().replace(/[^a-z0-9 ]+/g, ' ')} `.replace(/\s+/g, ' ')
	const out = new Set<string>()
	for (let i = 0; i + 3 <= t.length; i++) {
		out.add(t.slice(i, i + 3))
	}
	return out
}

function buildIndex(): CapabilityIndexEntry[] {
	return getCapabilityRegistry().map((cap) => {
		const text = [
			cap.name,
			cap.domain,
			cap.description,
			...(cap.keywords ?? []),
			...(cap.tags ?? []),
		]
			.filter(Boolean)
			.join(' ')
		return {
			cap,
			tokens: new Set(tokenize(text)),
			trigrams: trigramsOf(text),
		}
	})
}

function ensureIndex(): CapabilityIndexEntry[] {
	const snapshot = getCapabilityRegistry()
	if (
		cached &&
		cached.snapshot.length === snapshot.length &&
		cached.snapshot.every((c, i) => snapshot[i] === c)
	) {
		return cached.index
	}
	const index = buildIndex()
	cached = { snapshot, index }
	return index
}

export interface CapabilitySearchHit {
	id: string
	cap: CapabilityDef
	score: number
}

export function searchCapabilitiesByName(query: string, limit = 10): CapabilitySearchHit[] {
	const q = query.toLowerCase()
	const out: CapabilitySearchHit[] = []
	for (const entry of ensureIndex()) {
		if (entry.cap.name.toLowerCase().includes(q)) {
			const isExact = entry.cap.name.toLowerCase() === q ? 2 : 1
			out.push({ id: `${entry.cap.name}:capability`, cap: entry.cap, score: isExact })
		}
	}
	return out.sort((a, b) => b.score - a.score).slice(0, limit)
}

export function searchCapabilitiesFts(query: string, limit = 10): CapabilitySearchHit[] {
	const queryTokens = new Set(tokenize(query))
	const queryTrigrams = trigramsOf(query)
	const scored: CapabilitySearchHit[] = []
	for (const entry of ensureIndex()) {
		let tokenHits = 0
		for (const t of queryTokens) if (entry.tokens.has(t)) tokenHits++
		let trigramHits = 0
		for (const g of queryTrigrams) if (entry.trigrams.has(g)) trigramHits++
		if (tokenHits === 0 && trigramHits === 0) continue
		const score = tokenHits * 4 + trigramHits / Math.max(1, queryTrigrams.size)
		scored.push({ id: `${entry.cap.name}:capability`, cap: entry.cap, score })
	}
	return scored.sort((a, b) => b.score - a.score).slice(0, limit)
}

export function listCapabilities(limit = 50): CapabilitySearchHit[] {
	return ensureIndex()
		.slice(0, limit)
		.map((entry) => ({ id: `${entry.cap.name}:capability`, cap: entry.cap, score: 0 }))
}
