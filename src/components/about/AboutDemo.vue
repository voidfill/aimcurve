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
import type { Attempt } from '../../lib/run/queries';

const props = defineProps<{ attempt: Attempt }>();

const { data } = useScenario(ref(props.attempt.scenarioHash));
</script>

<template>
	<AboutRun :attempt="attempt" />
	<AboutProgress v-if="data" :data="data" />
	<div v-else class="placeholder" aria-hidden="true"></div>
</template>

<style scoped>
.placeholder {
	height: 420px;
}
</style>
