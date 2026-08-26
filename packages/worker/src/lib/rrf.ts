export interface RankedItem {
	id: string
}

/**
 * Reciprocal Rank Fusion. Given multiple ranked lists of items, combine their
 * scores so items appearing high in any list get boosted.
 *
 * `id` is the stable key used for joining. The constant `k` (default 60) is the
 * standard RRF damping factor.
 */
export function reciprocalRankFusion<T extends RankedItem>(
	rankedLists: T[][],
	k = 60,
): { id: string; score: number; sources: number; items: T[] }[] {
	const accum = new Map<string, { score: number; sources: number; items: T[] }>()
	for (const list of rankedLists) {
		list.forEach((item, idx) => {
			const rank = idx + 1
			const contribution = 1 / (k + rank)
			const cur = accum.get(item.id)
			if (cur) {
				cur.score += contribution
				cur.sources += 1
				cur.items.push(item)
			} else {
				accum.set(item.id, { score: contribution, sources: 1, items: [item] })
			}
		})
	}
	return Array.from(accum.entries())
		.map(([id, v]) => ({ id, ...v }))
		.sort((a, b) => b.score - a.score)
}
