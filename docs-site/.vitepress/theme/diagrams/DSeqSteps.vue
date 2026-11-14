<script setup lang="ts">
import DText from './DText.vue'
import type { Participant, SeqStep } from './types'

// Renders a list of sequence steps (recursive for loop/alt frames). Each message is one grid row
// spanning its two lifelines; `num` holds every message's step number, counted in document order.
const props = defineProps<{ steps: SeqStep[]; parts: Participant[]; num: Map<SeqStep, number> }>()

const idx = (id: string) => {
	const i = props.parts.findIndex((p) => p.id === id)
	if (i < 0) throw new Error(`sequence: unknown participant "${id}"`)
	return i
}
const part = (id: string) => props.parts[idx(id)]

function span(s: SeqStep) {
	if ('frame' in s) return {}
	if ('note' in s) {
		const ix = s.over.map(idx)
		const a = Math.min(...ix)
		const b = Math.max(...ix)
		return { '--a': a + 1, '--b': b + 2, '--k': b - a + 1 }
	}
	const f = idx(s.from)
	const t = idx(s.to)
	if (f === t) {
		// A self-call is drawn as an action box from its lifeline to the next one.
		const a = f === props.parts.length - 1 ? f - 1 : f
		return { '--a': a + 1, '--b': a + 3, '--k': 2 }
	}
	return { '--a': Math.min(f, t) + 1, '--b': Math.max(f, t) + 2, '--k': Math.abs(f - t) + 1 }
}
const rtl = (s: SeqStep) => 'from' in s && idx(s.to) < idx(s.from)
const selfRight = (s: SeqStep) =>
	'from' in s && s.from === s.to && idx(s.from) === props.parts.length - 1
</script>

<template>
	<template v-for="(s, i) in steps" :key="i">
		<div v-if="'frame' in s" class="fx-seq-frame">
			<template v-for="(b, bi) in s.branches" :key="bi">
				<div class="fx-seq-tab" :class="{ 'fx-seq-else': bi > 0 }">
					<b v-if="bi === 0">{{ s.frame }}</b><span>{{ b.label }}</span>
				</div>
				<DSeqSteps :steps="b.steps" :parts="parts" :num="num" />
			</template>
		</div>
		<div v-else-if="'note' in s" class="fx-seq-note" :class="`fx-t-${s.tone ?? 'human'}`" :style="span(s)">
			<span class="fx-seq-ends"><span v-for="o in s.over" :key="o" class="fx-chip" :class="`fx-t-${part(o).tone ?? 'ext'}`">{{ part(o).short ?? part(o).label }}</span></span>
			<DText :text="s.note" />
		</div>
		<div
			v-else
			class="fx-seq-msg"
			:class="[`fx-t-${part(s.from).tone ?? 'ext'}`, { 'fx-rtl': rtl(s), 'fx-self': s.from === s.to, 'fx-self-r': selfRight(s), 'fx-reply': s.reply }]"
			:style="span(s)"
		>
			<span class="fx-seq-ends">
				<span class="fx-chip" :class="`fx-t-${part(s.from).tone ?? 'ext'}`">{{ part(s.from).short ?? part(s.from).label }}</span>
				<template v-if="s.from !== s.to">
					<span class="fx-seq-dir" aria-label="to">{{ s.reply ? '⇢' : '→' }}</span>
					<span class="fx-chip" :class="`fx-t-${part(s.to).tone ?? 'ext'}`">{{ part(s.to).short ?? part(s.to).label }}</span>
				</template>
				<span v-else class="fx-seq-dir">internal</span>
			</span>
			<span class="fx-seq-label"><span class="fx-num">{{ num.get(s) }}</span><DText :text="s.label" /></span>
			<span v-if="s.from !== s.to" class="fx-line" :class="{ 'fx-dashed': s.reply }">
				<svg class="fx-ah" :class="rtl(s) ? 'fx-ah-start' : 'fx-ah-end'" viewBox="0 0 10 10" aria-hidden="true"><path :d="rtl(s) ? 'M10 0L0 5L10 10z' : 'M0 0L10 5L0 10z'" /></svg>
			</span>
		</div>
	</template>
</template>
