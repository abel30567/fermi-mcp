<script setup lang="ts">
import { computed } from 'vue'
import DText from './DText.vue'
import type { DLinkSpec } from './types'

// The stacked-layout stand-in for an arrow that would otherwise point at the wrong neighbour:
// it names the other end in words ("→ to Worker · /mcp").
const props = defineProps<{ link: DLinkSpec; peer: string; side: 'left' | 'right' }>()
const text = computed(() => {
	const d = props.link.dir ?? 'next'
	if (d === 'both') return ['⇄', `with ${props.peer}`]
	const towardPeer = (d === 'next') === (props.side === 'left')
	return towardPeer ? ['→', `to ${props.peer}`] : ['←', `from ${props.peer}`]
})
</script>

<template>
	<div class="fx-port" :class="`fx-t-${link.tone ?? 'wire'}`">
		<span class="fx-port-glyph" aria-hidden="true">{{ text[0] }}</span>
		<span class="fx-port-peer">{{ text[1] }}</span>
		<span v-if="link.label" class="fx-port-label"><DText :text="link.label" /></span>
	</div>
</template>
