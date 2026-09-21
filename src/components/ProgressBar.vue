<script setup lang="ts">
/**
 * The bar for an import pass.
 *
 * `total === 0` is the listing phase, not a finished pass: a pass starts at
 * `{ done: 0, total: 0 }` and only learns its total once the first chunk
 * commits. Dividing by it would paint a full bar over work not yet started, so
 * that case renders an indeterminate sweep instead and exposes no value to
 * assistive technology.
 */
import { computed } from 'vue';

const props = defineProps<{ done: number; total: number; label: string }>();

const determinate = computed(() => props.total > 0);
const percent = computed(() =>
	determinate.value ? Math.min(100, Math.round((props.done / props.total) * 100)) : 0,
);
</script>

<template>
	<div class="bar">
		<div
			class="track"
			role="progressbar"
			:aria-label="label"
			aria-valuemin="0"
			:aria-valuemax="determinate ? total : undefined"
			:aria-valuenow="determinate ? done : undefined"
		>
			<div
				class="fill"
				:class="{ sweep: !determinate }"
				:style="determinate ? { width: `${percent}%` } : undefined"
			></div>
		</div>
		<span class="value">
			<template v-if="determinate">{{ done }} / {{ total }} files</template>
			<template v-else>Scanning…</template>
		</span>
	</div>
</template>

<style scoped>
.bar {
	display: flex;
	align-items: center;
	gap: var(--space-3);
}

.track {
	position: relative;
	flex: 1;
	height: 0.5rem;
	border-radius: 999px;
	background: color-mix(in srgb, var(--color-text-muted) 22%, transparent);
	overflow: hidden;
}

.fill {
	height: 100%;
	border-radius: inherit;
	background: linear-gradient(
		90deg,
		color-mix(in srgb, var(--color-accent) 70%, var(--color-text)),
		var(--color-accent)
	);
	transition: width 180ms ease-out;
}

/* No width of its own: the sweep is the whole point of the indeterminate state. */
.fill.sweep {
	position: absolute;
	inset-block: 0;
	width: 35%;
	animation: sweep 1.1s ease-in-out infinite;
}

@keyframes sweep {
	from {
		transform: translateX(-100%);
	}
	to {
		transform: translateX(286%);
	}
}

/*
	The global reduced-motion rule collapses animations to a single 0.01ms run,
	which would park the sweep off-screen and leave an empty track. A static
	filled track says "working" without moving anything.
*/
@media (prefers-reduced-motion: reduce) {
	.fill.sweep {
		position: static;
		width: 100%;
		animation: none !important;
		opacity: 0.55;
	}
}

.value {
	color: var(--color-text-muted);
	font-family: var(--font-mono);
	font-size: 0.8125rem;
	font-variant-numeric: tabular-nums;
	white-space: nowrap;
}
</style>
