<script setup lang="ts">
import DArrow from './DArrow.vue'
import DNode from './DNode.vue'
import DPort from './DPort.vue'
import type { PipelineSpec } from './types'

defineProps<{ lanes: PipelineSpec['lanes']; join?: PipelineSpec['join'] }>()
</script>

<template>
	<div class="fx-pipe" :class="{ 'fx-has-join': join }" :style="{ '--lanes': lanes.length }">
		<template v-for="(lane, li) in lanes" :key="li">
			<div class="fx-lane" :style="{ '--row': li + 1 }">
				<div v-if="lane.label" class="fx-lane-label">{{ lane.label }}</div>
				<div class="fx-lane-track" :data-n="lane.nodes.length">
					<template v-for="(n, i) in lane.nodes" :key="i">
						<DNode :node="n" />
						<DArrow v-if="i < lane.nodes.length - 1" class="fx-step" :link="lane.links[i] ?? {}" />
					</template>
				</div>
			</div>
			<div v-if="join" class="fx-tojoin" :style="{ '--row': li + 1 }">
				<DArrow :link="lane.toJoin ?? {}" />
				<DPort :link="lane.toJoin ?? {}" :peer="join.title" side="left" />
			</div>
		</template>
		<div v-if="join" class="fx-join"><DNode :node="join" /></div>
	</div>
</template>
