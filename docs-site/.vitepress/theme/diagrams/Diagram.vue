<script setup lang="ts">
import { computed } from 'vue'
import DHub from './DHub.vue'
import DPipeline from './DPipeline.vue'
import DSequence from './DSequence.vue'
import DState from './DState.vue'
import { specs } from './specs'
import type { DiagramSpec, Tone } from './types'

const props = defineProps<{ id: string }>()
const spec = computed<DiagramSpec>(() => {
	const s = specs[props.id]
	if (!s) throw new Error(`Diagram: no spec "${props.id}"`)
	return s
})

const KIND = { pipeline: 'Flow', hub: 'Architecture', sequence: 'Sequence', state: 'States' }
const DEFAULT_LEGEND: Record<Tone, string> = {
	fermi: 'Fermi control plane',
	agent: 'agents and models',
	human: 'you, your Mac, gates',
	ext: 'third party',
	pass: 'allowed / done',
	fail: 'refused / failed',
}
const TONES: Tone[] = ['fermi', 'agent', 'human', 'ext', 'pass', 'fail']
const legend = computed(() => {
	const json = JSON.stringify(spec.value)
	return TONES.filter((t) => json.includes(`"tone":"${t}"`)).map((t) => ({
		tone: t,
		text: spec.value.legend?.[t] ?? DEFAULT_LEGEND[t],
	}))
})
</script>

<template>
	<figure class="fx-fig" role="group" :aria-label="spec.alt">
		<header class="fx-head">
			<span class="fx-kicker">{{ KIND[spec.type] }}</span>
			<span class="fx-title">{{ spec.title }}</span>
		</header>
		<div class="fx-body">
			<DPipeline v-if="spec.type === 'pipeline'" :lanes="spec.lanes" :join="spec.join" />
			<DHub v-else-if="spec.type === 'hub'" :spec="spec" />
			<DSequence v-else-if="spec.type === 'sequence'" :spec="spec" />
			<DState v-else :spec="spec" />
		</div>
		<figcaption v-if="legend.length || spec.caption" class="fx-foot">
			<span v-for="l in legend" :key="l.tone" class="fx-legend" :class="`fx-t-${l.tone}`"><i aria-hidden="true" />{{ l.text }}</span>
			<span v-if="spec.caption" class="fx-caption">{{ spec.caption }}</span>
		</figcaption>
	</figure>
</template>
