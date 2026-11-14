<script setup lang="ts">
import DText from './DText.vue'
import type { DNodeSpec } from './types'

defineProps<{ node: DNodeSpec; mini?: boolean }>()
</script>

<template>
	<div
		class="fx-node"
		:class="[`fx-t-${node.tone ?? 'ext'}`, { 'fx-mini': mini, 'fx-group': node.items, 'fx-wide': node.wide }]"
	>
		<div class="fx-node-head">
			<svg v-if="node.kind === 'store'" class="fx-db" viewBox="0 0 16 18" aria-hidden="true">
				<ellipse cx="8" cy="4" rx="6.5" ry="2.6" />
				<path d="M1.5 4v10c0 1.4 2.9 2.6 6.5 2.6s6.5-1.2 6.5-2.6V4M1.5 9c0 1.4 2.9 2.6 6.5 2.6s6.5-1.2 6.5-2.6" />
			</svg>
			<span class="fx-node-title"><DText :text="node.title" /></span>
			<span v-if="node.sub" class="fx-node-sub"><DText :text="node.sub" /></span>
		</div>
		<div v-if="node.lines?.length || node.items?.length" class="fx-node-body">
			<p v-for="(l, i) in node.lines" :key="i"><DText :text="l" /></p>
			<div v-if="node.items" class="fx-items">
				<DNode v-for="(it, i) in node.items" :key="i" :node="it" mini />
			</div>
		</div>
	</div>
</template>
