/**
 * Hold-phase audio gate.
 *
 * While a call is parked on hold the GPT-Live session is closed (it bills per
 * second of session time). This detector watches the inbound μ-law stream for
 * the shape of a person picking up: a burst of speech-like energy followed by
 * real silence — an agent says "thanks for holding, how can I help?" and waits.
 * Hold music never goes quiet, so it never trips the gate. A false positive
 * (a recorded "please continue to hold" followed by a pause) costs one short
 * GPT-Live session, which the model ends itself by calling wait_on_hold again.
 */

export const FRAME_MS = 20 // μ-law media frames are 160 bytes = 20 ms at 8 kHz

/** G.711 μ-law byte → 16-bit linear PCM sample. */
export function ulawToPcm16(byte: number): number {
	const u = ~byte & 0xff
	const sign = u & 0x80
	const exponent = (u >> 4) & 0x07
	const mantissa = u & 0x0f
	const sample = (((mantissa << 3) + 0x84) << exponent) - 0x84
	return sign ? -sample : sample
}

/** Root-mean-square amplitude of a μ-law frame on the 16-bit PCM scale (0..32767). */
export function ulawFrameRms(bytes: Uint8Array): number {
	if (bytes.length === 0) return 0
	let sum = 0
	for (let i = 0; i < bytes.length; i++) {
		const s = ulawToPcm16(bytes[i])
		sum += s * s
	}
	return Math.sqrt(sum / bytes.length)
}

export interface HoldDetectorOptions {
	/** Frames at or above this RMS count as sound (default 500). */
	activeRms?: number
	/** A sound run must last at least this long to count as speech (default 400 ms). */
	minBurstMs?: number
	/** Silence after the burst that means the speaker is waiting for us (default 1800 ms). */
	silenceMs?: number
	/** Minimum gap between two triggers (default 20 s) — bounds false-positive cost. */
	cooldownMs?: number
	/** Ignore audio for this long after entering hold (default 3 s). */
	armDelayMs?: number
	/** A silence run shorter than this is a pause inside one utterance (default 600 ms). */
	gapResetMs?: number
}

export class HoldDetector {
	private readonly activeRms: number
	private readonly minBurstMs: number
	private readonly silenceMs: number
	private readonly cooldownMs: number
	private readonly armDelayMs: number
	private readonly gapResetMs: number

	private startedAt: number | null = null
	private burstMs = 0
	private silentMs = 0
	private lastBurstMs = 0
	private lastTriggerAt = Number.NEGATIVE_INFINITY

	constructor(opts: HoldDetectorOptions = {}) {
		this.activeRms = opts.activeRms ?? 500
		this.minBurstMs = opts.minBurstMs ?? 400
		this.silenceMs = opts.silenceMs ?? 1800
		this.cooldownMs = opts.cooldownMs ?? 20_000
		this.armDelayMs = opts.armDelayMs ?? 3000
		this.gapResetMs = opts.gapResetMs ?? 600
	}

	/** Start a fresh hold period. The trigger cooldown deliberately survives resets. */
	reset(): void {
		this.startedAt = null
		this.burstMs = 0
		this.silentMs = 0
		this.lastBurstMs = 0
	}

	/**
	 * Feed one frame's RMS. Returns true exactly once per "someone spoke, then went
	 * quiet" pattern (subject to arm delay and cooldown).
	 */
	feed(rms: number, atMs: number, frameMs = FRAME_MS): boolean {
		if (this.startedAt === null) this.startedAt = atMs
		if (atMs - this.startedAt < this.armDelayMs) return false
		if (rms >= this.activeRms) {
			if (this.silentMs >= this.gapResetMs) this.burstMs = 0
			this.burstMs += frameMs
			this.silentMs = 0
			return false
		}
		if (this.silentMs === 0) this.lastBurstMs = this.burstMs
		this.silentMs += frameMs
		if (this.silentMs < this.silenceMs) return false
		if (this.lastBurstMs < this.minBurstMs) return false
		if (atMs - this.lastTriggerAt < this.cooldownMs) return false
		this.lastTriggerAt = atMs
		this.lastBurstMs = 0 // a new burst is required before the next trigger
		this.burstMs = 0
		return true
	}
}
