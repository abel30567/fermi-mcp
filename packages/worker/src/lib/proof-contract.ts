import { z } from 'zod'

/**
 * Structured, mechanically-checked proof contracts (#36). A contract is JSON
 * naming a kind and an expectation; the checker is a pure function over
 * (contract, evidence-accessors) so the exact same code runs at /box/complete,
 * in the box runner's pre-submit self-check, and in fleetctl verify. Free-text
 * contracts predating #36 are grandfathered at the enforcement point but new
 * launches must be structured.
 */

export const proofContractSchema = z.discriminatedUnion('kind', [
	// Evidence is an uploaded artifact: must exist, optionally with a minimum
	// size (kills the empty-file vacuous pass) and/or an exact sha256.
	z.object({
		kind: z.literal('artifact'),
		name: z.string().min(1).max(128),
		min_bytes: z.number().int().positive().optional(),
		sha256: z
			.string()
			.regex(/^[0-9a-f]{64}$/)
			.optional(),
	}),
	// Evidence is a live URL: status and optional body regex, fetched by the
	// checker itself — the box cannot fake it.
	z.object({
		kind: z.literal('http'),
		url: z.string().url(),
		expect_status: z.number().int().min(100).max(599).default(200),
		body_matches: z.string().max(512).optional(),
	}),
	// Evidence is a command exit code. Not worker-checkable (no shell): the
	// runner self-checks pre-submit and the orchestrator replays via fleetctl.
	z.object({
		kind: z.literal('test'),
		cmd: z.string().min(1).max(1024),
		expect_exit: z.number().int().default(0),
	}),
	// Evidence is a DOM assertion. Needs a browser: same replay story as test.
	z.object({
		kind: z.literal('dom'),
		url: z.string().url(),
		selector: z.string().min(1).max(256),
		text_matches: z.string().max(512).optional(),
	}),
])

export type ProofContract = z.infer<typeof proofContractSchema>

export function proofContractHelp(): string {
	return (
		'proof_contract must be JSON of one of: ' +
		'{"kind":"artifact","name":...,"min_bytes"?,"sha256"?} | ' +
		'{"kind":"http","url":...,"expect_status"?,"body_matches"?} | ' +
		'{"kind":"test","cmd":...,"expect_exit"?} | ' +
		'{"kind":"dom","url":...,"selector":...,"text_matches"?}'
	)
}

export function parseProofContract(
	raw: string,
): { ok: true; contract: ProofContract } | { ok: false; error: string } {
	let json: unknown
	try {
		json = JSON.parse(raw)
	} catch {
		return { ok: false, error: proofContractHelp() }
	}
	const parsed = proofContractSchema.safeParse(json)
	if (!parsed.success) return { ok: false, error: proofContractHelp() }
	return { ok: true, contract: parsed.data }
}

export interface ProofCheckDeps {
	/** Fetch an uploaded artifact's bytes by name, or null if absent. */
	getArtifact: (name: string) => Promise<{ bytes: ArrayBuffer } | null>
	/** Fetch a URL (http kind). Omit to make http contracts unverifiable. */
	fetchUrl?: (url: string) => Promise<{ status: number; body: string }>
}

export interface ProofCheckResult {
	verdict: 'pass' | 'fail' | 'unverifiable'
	detail: string
}

async function sha256HexOf(bytes: ArrayBuffer): Promise<string> {
	const digest = await crypto.subtle.digest('SHA-256', bytes)
	return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

export async function checkProofContract(
	contract: ProofContract,
	deps: ProofCheckDeps,
): Promise<ProofCheckResult> {
	switch (contract.kind) {
		case 'artifact': {
			const artifact = await deps.getArtifact(contract.name)
			if (!artifact) return { verdict: 'fail', detail: `artifact_missing: ${contract.name}` }
			const size = artifact.bytes.byteLength
			if (size === 0) return { verdict: 'fail', detail: `artifact_empty: ${contract.name}` }
			if (contract.min_bytes && size < contract.min_bytes) {
				return { verdict: 'fail', detail: `artifact_too_small: ${size} < ${contract.min_bytes}` }
			}
			if (contract.sha256) {
				const actual = await sha256HexOf(artifact.bytes)
				if (actual !== contract.sha256) {
					return { verdict: 'fail', detail: `artifact_sha256_mismatch: ${actual}` }
				}
			}
			return { verdict: 'pass', detail: `artifact ${contract.name} (${size} bytes)` }
		}
		case 'http': {
			if (!deps.fetchUrl) return { verdict: 'unverifiable', detail: 'no_fetch_in_this_context' }
			let res: { status: number; body: string }
			try {
				res = await deps.fetchUrl(contract.url)
			} catch (e) {
				return { verdict: 'fail', detail: `fetch_failed: ${String(e)}` }
			}
			if (res.status !== contract.expect_status) {
				return { verdict: 'fail', detail: `status ${res.status} != ${contract.expect_status}` }
			}
			if (contract.body_matches && !new RegExp(contract.body_matches).test(res.body)) {
				return { verdict: 'fail', detail: `body_no_match: ${contract.body_matches}` }
			}
			return { verdict: 'pass', detail: `http ${contract.url} ${res.status}` }
		}
		case 'test':
			return { verdict: 'unverifiable', detail: 'test contracts replay via fleetctl verify' }
		case 'dom':
			return { verdict: 'unverifiable', detail: 'dom contracts replay via fleetctl verify' }
	}
}
