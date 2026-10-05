<script setup lang="ts">
/**
 * The About walkthrough's beats, over the snapshot source `AboutView`
 * provides. A component of its own because `inject` never sees the calling
 * component's own `provide`: the composables must run below the provider.
 */
import AboutBenchmark from './AboutBenchmark.vue';
import AboutRun from './AboutRun.vue';
import type { Attempt } from '../../lib/run/queries';

defineProps<{
	attempt: Attempt;
	/** The sample's last run, epoch ms: the benchmark sheet's "now". */
	now: number;
}>();
</script>

<template>
	<AboutRun :attempt="attempt" />
	<AboutBenchmark :now="now" />
</template>

