<script setup lang="ts">
import DText from './DText.vue'
import type { StateSpec } from './types'

// A vertical rail of states. Transitions to the next state in rail order sit on the rail; every
// other transition is listed as an exit on its source card, so nothing has to cross anything.
const props = defineProps<{ spec: StateSpec }>()
const order = props.spec.states.map((s) => s.id)
const byId = Object.fromEntries(props.spec.states.map((s) => [s.id, s]))
for (const t of props.spec.transitions)
	for (const id of [t.from, t.to])
		if (id !== 'end' && !byId[id]) throw new Error(`state: unknown state "${id}"`)

const last = order[order.length - 1]
const onRail = (t: StateSpec['transitions'][number]) =>
	order.indexOf(t.to) === order.indexOf(t.from) + 1 || (t.from === last && t.to === 'end')
const rail = (id: string) => props.spec.transitions.find((t) => t.from === id && onRail(t))
const exits = (id: string) => props.spec.transitions.filter((t) => t.from === id && !onRail(t))
const glyph = (t: StateSpec['transitions'][number]) =>
	t.to === 'end' ? '◉' : order.indexOf(t.to) < order.indexOf(t.from) ? '↩' : '↪'
</script>

<template>
	<div class="fx-state">
		<div class="fx-st-start"><span class="fx-st-dot" aria-hidden="true" /><span class="fx-st-start-label"><DText :text="spec.start" /></span></div>
		<div class="fx-st-rail"><span class="fx-line"><svg class="fx-ah fx-ah-end" viewBox="0 0 10 10" aria-hidden="true"><path d="M0 0L10 5L0 10z" /></svg></span></div>
		<template v-for="s in spec.states" :key="s.id">
			<div class="fx-st-card" :class="`fx-t-${s.tone ?? 'fermi'}`">
				<div class="fx-st-name">
					<b>{{ s.label }}</b>
					<small v-if="s.note"><DText :text="s.note" /></small>
				</div>
				<ul v-if="exits(s.id).length" class="fx-st-exits">
					<li v-for="(t, i) in exits(s.id)" :key="i">
						<span class="fx-st-glyph" aria-hidden="true">{{ glyph(t) }}</span>
						<span v-if="t.to === 'end'" class="fx-chip fx-t-ext">end</span>
						<span v-else class="fx-chip" :class="`fx-t-${byId[t.to].tone ?? 'fermi'}`">{{ byId[t.to].label }}</span>
						<span class="fx-st-why"><DText :text="t.label" /></span>
					</li>
				</ul>
			</div>
			<div v-if="rail(s.id)" class="fx-st-rail" :class="`fx-t-${rail(s.id)?.tone ?? 'wire'}`">
				<span class="fx-line"><svg class="fx-ah fx-ah-end" viewBox="0 0 10 10" aria-hidden="true"><path d="M0 0L10 5L0 10z" /></svg></span>
				<span class="fx-arrow-label"><DText :text="rail(s.id)!.label" /></span>
			</div>
			<div v-else-if="s.id !== last" class="fx-st-gap" />
		</template>
		<div v-if="rail(last)" class="fx-st-end"><span class="fx-st-bull" aria-hidden="true" />end</div>
	</div>
</template>
