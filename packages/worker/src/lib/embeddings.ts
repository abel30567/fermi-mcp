const EMBED_DIM = 384

function fnv1aDeterministicEmbedding(text: string, dim = EMBED_DIM): number[] {
	const bytes = new TextEncoder().encode(text)
	const out = new Float32Array(dim)
	let h = 0x811c9dc5
	for (let i = 0; i < bytes.length; i++) {
		h = (h ^ bytes[i]) >>> 0
		h = Math.imul(h, 0x01000193) >>> 0
		const idx = h % dim
		// alternating sign keyed by byte position so different texts diverge
		out[idx] += (i & 1) === 0 ? 1 : -1
	}
	let norm = 0
	for (let i = 0; i < dim; i++) norm += out[i] * out[i]
	norm = Math.sqrt(norm) || 1
	const arr = new Array<number>(dim)
	for (let i = 0; i < dim; i++) arr[i] = out[i] / norm
	return arr
}

export async function embedText(
	text: string,
	env: Env,
): Promise<{ vector: number[]; offline: boolean; error?: string }> {
	if (!text.trim()) {
		return { vector: fnv1aDeterministicEmbedding(' '), offline: true, error: 'empty_text' }
	}
	try {
		const result = (await env.AI.run('@cf/baai/bge-small-en-v1.5', {
			text: [text],
		})) as { data?: number[][] }
		const vec = result?.data?.[0]
		if (!vec || vec.length !== EMBED_DIM) {
			return {
				vector: fnv1aDeterministicEmbedding(text),
				offline: true,
				error: `unexpected_embed_dim_${vec?.length ?? 0}`,
			}
		}
		return { vector: vec, offline: false }
	} catch (err) {
		return {
			vector: fnv1aDeterministicEmbedding(text),
			offline: true,
			error: err instanceof Error ? err.message : 'embed_failed',
		}
	}
}

export const EMBEDDING_DIM = EMBED_DIM
