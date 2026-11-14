<script setup lang="ts">
import DArrow from './DArrow.vue'
import DNode from './DNode.vue'
import DPipeline from './DPipeline.vue'
import DPort from './DPort.vue'
import type { HubSpec } from './types'

defineProps<{ spec: HubSpec }>()
</script>

<template>
	<div class="fx-hub" :class="spec.orient === 'v' ? 'fx-v' : 'fx-h'" :style="{ '--rows': Math.max(spec.left.length, spec.right.length, 1) }">
		<div v-for="(s, i) in spec.left" :key="`l${i}`" class="fx-spoke fx-spoke-l" :style="{ '--row': i + 1 }">
			<DNode :node="s.node" />
			<div class="fx-spoke-links">
				<DArrow v-for="(l, j) in s.links" :key="j" :link="l" />
				<DPort v-for="(l, j) in s.links" :key="`p${j}`" :link="l" :peer="spec.hubShort" side="left" />
			</div>
		</div>
		<div class="fx-hub-core"><DNode :node="spec.hub" /></div>
		<div v-for="(s, i) in spec.right" :key="`r${i}`" class="fx-spoke fx-spoke-r" :style="{ '--row': i + 1 }">
			<div class="fx-spoke-links">
				<DArrow v-for="(l, j) in s.links" :key="j" :link="l" />
				<DPort v-for="(l, j) in s.links" :key="`p${j}`" :link="l" :peer="spec.hubShort" side="right" />
			</div>
			<DNode :node="s.node" />
		</div>
	</div>
	<DPipeline v-if="spec.footer" class="fx-hub-footer" :lanes="spec.footer" />
</template>
