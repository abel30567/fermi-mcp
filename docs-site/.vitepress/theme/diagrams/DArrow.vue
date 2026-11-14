<script setup lang="ts">
import DText from './DText.vue'
import type { DLinkSpec } from './types'

// One geometric connector: a line with arrowheads and a label. Horizontal by default; the
// container query in diagrams.css turns it vertical when the layout stacks.
const props = defineProps<{ link: DLinkSpec }>()
const glyph = { next: '↓', prev: '↑', both: '⇅' }[props.link.dir ?? 'next']
</script>

<template>
	<div class="fx-arrow" :class="[`fx-t-${link.tone ?? 'wire'}`, { 'fx-dashed': link.dashed }]">
		<span v-if="link.label" class="fx-arrow-label"><span class="fx-glyph" aria-hidden="true">{{ glyph }}</span><DText :text="link.label" /></span>
		<span class="fx-line">
			<svg v-if="link.dir === 'prev' || link.dir === 'both'" class="fx-ah fx-ah-start" viewBox="0 0 10 10" aria-hidden="true"><path d="M10 0L0 5L10 10z" /></svg>
			<svg v-if="link.dir !== 'prev'" class="fx-ah fx-ah-end" viewBox="0 0 10 10" aria-hidden="true"><path d="M0 0L10 5L0 10z" /></svg>
		</span>
	</div>
</template>
