<script setup lang="ts">
import DSeqSteps from './DSeqSteps.vue'
import type { SeqStep, SequenceSpec } from './types'

const props = defineProps<{ spec: SequenceSpec }>()

const num = new Map<SeqStep, number>()
const walk = (steps: SeqStep[]) => {
	for (const s of steps) {
		if ('frame' in s) for (const b of s.branches) walk(b.steps)
		else if ('from' in s) num.set(s, num.size + 1)
	}
}
walk(props.spec.steps)
</script>

<template>
	<div class="fx-seq" :style="{ '--n': spec.participants.length }">
		<div class="fx-seq-heads">
			<div v-for="p in spec.participants" :key="p.id" class="fx-seq-head" :class="`fx-t-${p.tone ?? 'ext'}`">
				<b>{{ p.label }}</b>
				<small v-if="p.sub">{{ p.sub }}</small>
			</div>
		</div>
		<div class="fx-seq-body">
			<div class="fx-seq-lifelines" aria-hidden="true"><span v-for="p in spec.participants" :key="p.id" /></div>
			<DSeqSteps :steps="spec.steps" :parts="spec.participants" :num="num" />
		</div>
	</div>
</template>
