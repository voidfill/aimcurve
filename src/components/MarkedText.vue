<script setup lang="ts">
/** Text with the words of a search marked. */
import { computed } from 'vue';
import { highlight } from '../lib/benchmarks/catalog';

const props = defineProps<{ text: string; q: string }>();
const segments = computed(() => highlight(props.text, props.q));
</script>

<template>
	<template v-for="(s, i) in segments" :key="i"
		><mark v-if="s.hit">{{ s.text }}</mark
		><template v-else>{{ s.text }}</template></template
	>
</template>

<style scoped>
mark {
	border-radius: 2px;
	background: color-mix(in srgb, var(--color-accent) 30%, transparent);
	color: var(--color-text-strong);
}
</style>
