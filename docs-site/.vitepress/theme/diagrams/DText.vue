<script setup lang="ts">
import { computed } from 'vue'

// Splits `code` spans out of a label so tool names and routes render in the mono face.
const props = defineProps<{ text: string }>()
const parts = computed(() => props.text.split(/(`[^`]+`)/).filter(Boolean))
</script>

<template>
	<template v-for="(p, i) in parts" :key="i">
		<code v-if="p.startsWith('`')" class="fx-code">{{ p.slice(1, -1) }}</code>
		<template v-else>{{ p }}</template>
	</template>
</template>
