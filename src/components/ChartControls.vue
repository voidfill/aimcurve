<script setup lang="ts">
/**
 * The chart header (Run view R4): title and axis note, layer toggles, the
 * baseline option and the local-pace window. A toggle that cannot apply is
 * disabled with its reason as a tooltip rather than hidden.
 */
import { computed } from 'vue';
import { BASELINE_OPTIONS, type BaselineOption } from '../lib/run/baseline';
import type { ChartSettings } from '../composables/useRunAnalysis';

const props = defineProps<{
	settings: ChartSettings;
	kind: 'clock' | 'race';
	recentCount: number;
	baselineKind: 'charted' | 'flat' | 'none';
	baselineLabel: string | null;
	/** Why the rank bands cannot be shown, or null when they can. */
	ranksDisabled: string | null;
}>();

const emit = defineEmits<{ (event: 'update', patch: Partial<ChartSettings>): void }>();

interface Toggle {
	key: 'local' | 'accumulated' | 'baseline' | 'baseLocal' | 'recent' | 'ranks';
	label: string;
	rule: string;
	disabled: string | null;
}

const toggles = computed<Toggle[]>(() => {
	const none = props.baselineKind === 'none';
	const flat = props.baselineKind === 'flat';
	const base = props.baselineLabel ?? 'baseline';
	return [
		{ key: 'local', label: 'local pace', rule: '1.5px solid #cfd6dd', disabled: null },
		{ key: 'accumulated', label: 'accumulated', rule: '3px solid #ffffff', disabled: null },
		{
			key: 'baseline',
			label: base,
			rule: flat ? '2px dotted #f0b23f' : '3px dashed #f0b23f',
			disabled: none ? 'No baseline to compare with' : null,
		},
		{
			key: 'baseLocal',
			label: `${base.replace(' · no curve', '')} local`,
			rule: '1.5px dashed #f0b23f',
			disabled: none ? 'No baseline to compare with' : flat ? 'The baseline has no curve, so it has no local pace' : null,
		},
		{
			key: 'recent',
			label: props.recentCount >= 10 ? 'recent range' : `recent · ${props.recentCount}`,
			rule: '8px solid rgba(142,154,166,.35)',
			disabled: props.recentCount === 0 ? 'No earlier comparable runs' : null,
		},
		{
			key: 'ranks',
			label: 'ranks',
			rule: '8px solid rgba(202,177,72,.3)',
			disabled: props.ranksDisabled,
		},
	];
});

const windows: ChartSettings['window'][] = [1, 3, 5];

function onOption(event: Event): void {
	emit('update', { option: (event.target as HTMLSelectElement).value as BaselineOption });
}
</script>

<template>
	<div class="controls">
		<h2>{{ kind === 'race' ? 'Pace over progress' : 'Pace over elapsed time' }}</h2>
		<span class="axis">y: projected {{ kind === 'race' ? 'time (s)' : 'score' }} · x: {{ kind === 'race' ? 'progress' : 'elapsed' }}</span>

		<div class="right">
			<button
				v-for="toggle in toggles"
				:key="toggle.key"
				type="button"
				class="chip"
				:class="{ on: settings[toggle.key] && !toggle.disabled }"
				:aria-pressed="settings[toggle.key] && !toggle.disabled"
				:disabled="toggle.disabled !== null"
				:title="toggle.disabled ?? undefined"
				@click="emit('update', { [toggle.key]: !settings[toggle.key] })"
			>
				<i :style="{ borderTop: toggle.rule }" aria-hidden="true"></i>{{ toggle.label }}
			</button>

			<label class="select">
				<span>baseline</span>
				<select :value="settings.option" @change="onOption">
					<option v-for="option in BASELINE_OPTIONS" :key="option.value" :value="option.value">
						{{ option.label }}
					</option>
				</select>
			</label>

			<div class="segment" role="group" aria-label="Local pace window">
				<button
					v-for="w in windows"
					:key="w"
					type="button"
					:class="{ on: settings.window === w }"
					:aria-pressed="settings.window === w"
					@click="emit('update', { window: w })"
				>
					{{ w === 1 ? 'raw' : `${w} s` }}
				</button>
			</div>
		</div>
	</div>
</template>

<style scoped>
.controls {
	display: flex;
	flex-wrap: wrap;
	align-items: center;
	gap: 8px 16px;
	padding: 8px 12px;
	border-bottom: 1px solid var(--color-border);
}

h2 {
	font: 500 11px/1 var(--font-mono);
	text-transform: uppercase;
	letter-spacing: 0.15em;
	color: #c3c9cf;
}

.axis {
	font: 400 11px/1 var(--font-mono);
	color: var(--color-text-faint);
	white-space: nowrap;
}

.right {
	margin-left: auto;
	display: flex;
	flex-wrap: wrap;
	align-items: center;
	gap: 8px;
}

.chip {
	display: flex;
	align-items: center;
	gap: 7px;
	padding: 5px 10px;
	border: 0;
	border-radius: 3px;
	cursor: pointer;
	background: #101418;
	box-shadow: inset 0 0 0 1px #20262c;
	font: 400 11.5px/1 var(--font-mono);
	color: #5c646c;
	white-space: nowrap;
}

.chip.on {
	background: #1b2229;
	box-shadow: inset 0 0 0 1px #38414a;
	color: var(--color-text);
}

.chip:disabled {
	cursor: not-allowed;
	opacity: 0.5;
}

.chip i {
	width: 16px;
	height: 0;
}

.select {
	display: flex;
	align-items: center;
	gap: 8px;
	font: 400 10px/1 var(--font-mono);
	text-transform: uppercase;
	letter-spacing: 0.14em;
	color: var(--color-text-faint);
}

select {
	padding: 4px 6px;
	background: var(--color-surface-raised);
	border: 1px solid var(--color-border-strong);
	border-radius: 3px;
	font: 400 11px/1 var(--font-mono);
	letter-spacing: 0;
	text-transform: none;
	color: var(--color-text);
}

.segment {
	display: flex;
	border: 1px solid var(--color-border);
	border-radius: 3px;
	overflow: hidden;
}

.segment button {
	padding: 4px 9px;
	border: 0;
	background: transparent;
	cursor: pointer;
	font: 400 11px/1 var(--font-mono);
	color: var(--color-text-faint);
}

.segment button + button {
	border-left: 1px solid var(--color-border);
}

.segment button.on {
	color: var(--color-text);
	background: var(--color-surface-raised);
	box-shadow: inset 0 1px 0 var(--color-accent);
}
</style>
