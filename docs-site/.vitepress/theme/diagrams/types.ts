// Diagram specs. Every diagram is data; the renderers turn it into HTML that reflows instead of
// shrinking, so the text stays readable from a 320 px phone to a wide monitor.

/** Semantic colour roles from design/tokens.json (the same ones the promo video uses). */
export type Tone = 'fermi' | 'agent' | 'human' | 'ext' | 'pass' | 'fail'

export interface DNodeSpec {
	title: string
	/** Small line under the title, inside the header band. */
	sub?: string
	/** Body lines. A line wrapped in backticks renders as code. */
	lines?: string[]
	tone?: Tone
	/** `store` draws a database glyph; groups are any node with `items`. */
	kind?: 'box' | 'store'
	/** Inner nodes: the node becomes a group container with a reflowing grid of items. */
	items?: DNodeSpec[]
	/** Item spans the whole row of its group. */
	wide?: boolean
}

/**
 * A connector. `next` points in reading order (left to right, or top to bottom when stacked),
 * `prev` against it, `both` either way.
 */
export interface DLinkSpec {
	label?: string
	dir?: 'next' | 'prev' | 'both'
	dashed?: boolean
	tone?: Tone
}

interface Common {
	title: string
	/** Plain-language description of the whole figure for screen readers. */
	alt: string
	caption?: string
	/** Override the legend text per tone. */
	legend?: Partial<Record<Tone, string>>
}

/** Lanes of nodes joined by connectors; optional shared node every lane flows into. */
export interface PipelineSpec extends Common {
	type: 'pipeline'
	lanes: { label?: string; nodes: DNodeSpec[]; links: DLinkSpec[]; toJoin?: DLinkSpec }[]
	join?: DNodeSpec
}

/** One central node with spokes on the left and right. */
export interface HubSpec extends Common {
	type: 'hub'
	hub: DNodeSpec
	/** Short name of the hub, used by the stacked (narrow) layout: "→ to Worker". */
	hubShort: string
	/** `h`: spokes left and right of the hub (default). `v`: left spokes above, right spokes below. */
	orient?: 'h' | 'v'
	left: { node: DNodeSpec; links: DLinkSpec[] }[]
	right: { node: DNodeSpec; links: DLinkSpec[] }[]
	/** Extra rows drawn under the hub figure (e.g. a side path). */
	footer?: PipelineSpec['lanes']
}

export interface Participant {
	id: string
	label: string
	/** Short name for the stacked layout chips. Defaults to `label`. */
	short?: string
	sub?: string
	tone?: Tone
}

export type SeqStep =
	| { from: string; to: string; label: string; reply?: boolean; tone?: Tone }
	| { note: string; over: string[]; tone?: Tone }
	| { frame: 'loop' | 'alt'; branches: { label: string; steps: SeqStep[] }[] }

export interface SequenceSpec extends Common {
	type: 'sequence'
	participants: Participant[]
	steps: SeqStep[]
}

export interface StateSpec extends Common {
	type: 'state'
	start: string
	/** Rail order, top to bottom. A transition to the next state in this list is drawn on the rail. */
	states: { id: string; label: string; note?: string; tone?: Tone }[]
	/** `to: 'end'` is the final state. */
	transitions: { from: string; to: string; label: string; tone?: Tone }[]
}

export type DiagramSpec = PipelineSpec | HubSpec | SequenceSpec | StateSpec
