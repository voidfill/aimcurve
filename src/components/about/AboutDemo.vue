<script setup lang="ts">
/**
 * The About walkthrough's three beats, over the snapshot source `AboutView`
 * provides. A component of its own because `inject` never sees the calling
 * component's own `provide`: the composables must run below the provider.
 */
import { ref } from 'vue';
import AboutProgress from './AboutProgress.vue';
import AboutRun from './AboutRun.vue';
import { useScenario } from '../../composables/useScenario';
import { DEMO_PROGRESS_HASH } from '../../lib/demo/snapshot';
import type { Attempt } from '../../lib/run/queries';

defineProps<{ attempt: Attempt }>();

// Progression is shown on a different scenario than the run: the one whose
// history reads best (see DEMO_PROGRESS_HASH).
const { state, data, retry } = useScenario(ref(DEMO_PROGRESS_HASH));
</script>

<template>
	<AboutRun :attempt="attempt" />
	<AboutProgress v-if="data" :data="data" />
	<p v-else-if="state === 'error' || state === 'missing'" class="error" role="alert">
		The sample history could not be drawn.
		<button type="button" @click="retry">Try again</button>
	</p>
	<div v-else class="placeholder" aria-hidden="true"></div>
</template>

<style scoped>
.placeholder {
	height: 420px;
}

.error {
	display: flex;
	flex-wrap: wrap;
	align-items: center;
	gap: var(--space-3);
	color: var(--color-danger);
}

button {
	padding: 6px 12px;
	border: 1px solid var(--color-border-strong);
	border-radius: 6px;
	background: transparent;
	color: var(--color-text-muted);
	cursor: pointer;
}
</style>
