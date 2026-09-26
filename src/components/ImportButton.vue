<script setup lang="ts">
/**
 * The header's data control: one button for whatever the connection most needs
 * right now, and a menu holding the same actions as the Data page.
 *
 * "Import" is the Data page's "Choose folder": a `webkitdirectory` input. That
 * is deliberate. `showDirectoryPicker` refuses Program Files — where Steam
 * installs KovaaK's by default — while a file input reads it, and a file input
 * works in every browser. So the one-click path is the one that always works.
 *
 * The main action by state:
 * - nothing connected, or a snapshot: Import (the folder input);
 * - a live folder: a greyed "Live" status. Importing once would stop the
 *   watcher, so it is not one click away; the menu still offers it;
 * - lost permission: Reconnect, against the stored handle (Import while live
 *   folders are switched off);
 * - a failed scan: Retry;
 * - a pass running: its progress;
 * - no database: a greyed Import.
 *
 * The menu is hidden with `v-show`, not removed: closing it on click would
 * otherwise remove an input while its dialog is still open, and its `change`
 * would never reach us. Handlers call straight through, because Connect and
 * Reconnect need the click's user activation (see `ImportControls`).
 */
import { computed, ref, useTemplateRef, watch } from 'vue';
import { useRoute } from 'vue-router';
import { onClickOutside, onKeyStroke } from '@vueuse/core';
import { useDb } from '../composables/useDb';
import { useImport } from '../composables/useImport';
import { canConnectFolder, importOptions, LIVE_FOLDER_ENABLED } from '../lib/run/import-options';

const route = useRoute();
const { ready, error: dbError } = useDb();
const { state, connect, reconnect, importFiles, disconnect, retryScan } = useImport();

const canPick = canConnectFolder();
/** The control stands in for the Data tab, so it carries the "you are here" mark. */
const onData = computed(() => route.name === 'data');
const disabled = computed(() => !ready.value || dbError.value !== null);

type Primary = 'import' | 'live' | 'reconnect' | 'retry' | 'busy';

const primary = computed<Primary>(() => {
	if (state.busy) return 'busy';
	switch (state.connection) {
		case 'connected':
			return 'live';
		case 'reconnect':
			return canPick ? 'reconnect' : 'import';
		case 'error':
			return 'retry';
		default:
			return 'import';
	}
});

/** Shared with the Data page's `ImportControls`, so the two never disagree. */
const options = computed(() => importOptions(state.connection, canPick));

const progressText = computed(() => {
	const p = state.progress;
	return p === null || p.total === 0 ? '' : `${p.done}/${p.total}`;
});
const progressRatio = computed(() => {
	const p = state.progress;
	return p === null || p.total === 0 ? 0 : p.done / p.total;
});

const open = ref(false);
const root = useTemplateRef<HTMLElement>('root');
const toggle = useTemplateRef<HTMLButtonElement>('toggle');

onClickOutside(root, () => (open.value = false));
onKeyStroke('Escape', () => {
	if (!open.value) return;
	open.value = false;
	toggle.value?.focus();
});
watch(() => route.fullPath, () => (open.value = false));

/** As in `ImportControls`: the controller copies the list, so clearing is safe. */
function onFiles(event: Event): void {
	const input = event.target as HTMLInputElement;
	const files = input.files;
	if (files !== null && files.length > 0) void importFiles(Array.from(files));
	input.value = '';
	open.value = false;
}

function run(action: () => Promise<void>): void {
	open.value = false;
	void action();
}
</script>

<template>
	<div ref="root" class="import" :class="{ open, here: onData }">
		<div v-if="primary === 'busy'" class="main status" role="status">
			<span class="dot working" aria-hidden="true"></span>
			Importing<span v-if="progressText" class="count">{{ progressText }}</span>
			<span class="track" aria-hidden="true"><span :style="{ transform: `scaleX(${progressRatio})` }"></span></span>
		</div>

		<div v-else-if="primary === 'live'" class="main status" title="Watching your stats folder for new attempts">
			<span class="dot live" aria-hidden="true"></span>
			Live
		</div>

		<button v-else-if="primary === 'reconnect'" type="button" class="main warn" :disabled="disabled" @click="reconnect()">
			<span class="dot warn" aria-hidden="true"></span>
			Reconnect
		</button>

		<button v-else-if="primary === 'retry'" type="button" class="main danger" :disabled="disabled" @click="retryScan()">
			<span class="dot danger" aria-hidden="true"></span>
			Retry import
		</button>

		<label v-else class="main" :class="{ disabled }" title="Import your KovaaK's folder once">
			<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 15V4m0 0 4 4m-4-4-4 4M4 15v4a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-4" /></svg>
			Import
			<input type="file" webkitdirectory multiple :disabled="disabled" @change="onFiles" />
		</label>

		<button
			ref="toggle"
			type="button"
			class="toggle"
			aria-label="More import options"
			aria-haspopup="true"
			:aria-expanded="open"
			aria-controls="import-menu"
			@click="open = !open"
		>
			<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m6 9 6 6 6-6" /></svg>
		</button>

		<div v-show="open" id="import-menu" class="menu">
			<label class="item" :class="{ disabled }">
				<span class="title">Import folder once</span>
				<span class="sub">{{ options.live ? 'Stops watching the connected folder' : 'Any folder, Program Files included' }}</span>
				<input type="file" webkitdirectory multiple :disabled="disabled" @change="onFiles" />
			</label>

			<label class="item" :class="{ disabled }">
				<span class="title">Import files…</span>
				<span class="sub">Pick <code>.csv</code> and <code>.perf</code> files</span>
				<input type="file" multiple accept=".csv,.perf" :disabled="disabled" @change="onFiles" />
			</label>

			<template v-if="!LIVE_FOLDER_ENABLED">
				<div class="rule" role="separator"></div>
				<button type="button" class="item" disabled>
					<span class="title">Connect folder</span>
					<span class="sub">Live updates · coming later</span>
				</button>
				<button v-if="options.disconnect" type="button" class="item" :disabled="disabled" @click="run(disconnect)">
					<span class="title">Disconnect</span>
					<span class="sub">Stops watching; imported attempts stay</span>
				</button>
			</template>
			<template v-else-if="canPick">
				<div class="rule" role="separator"></div>
				<button v-if="options.reconnect" type="button" class="item" :disabled="disabled" @click="run(reconnect)">
					<span class="title">Reconnect</span>
					<span class="sub">Resume watching the saved folder</span>
				</button>
				<button v-if="options.connect !== null" type="button" class="item" :disabled="disabled" @click="run(connect)">
					<span class="title">{{ options.connect === 'another' ? 'Use another folder' : 'Connect folder' }}</span>
					<span class="sub">New attempts show up live · not in Program Files</span>
				</button>
				<button v-if="options.disconnect" type="button" class="item" :disabled="disabled" @click="run(disconnect)">
					<span class="title">Disconnect</span>
					<span class="sub">Stops watching; imported attempts stay</span>
				</button>
			</template>

			<p class="hint">Or drop files or a folder anywhere on the page.</p>

			<RouterLink :to="{ name: 'data' }" class="item manage" :aria-current="onData ? 'page' : undefined">
				<span class="title">Manage data</span>
				<span aria-hidden="true">›</span>
			</RouterLink>
		</div>
	</div>
</template>

<style scoped>
.import {
	position: relative;
	display: flex;
	align-items: stretch;
	height: 30px;
	border: 1px solid var(--color-border-strong);
	border-radius: 6px;
	background: var(--color-surface-raised);
	transition: border-color 120ms ease;
}

.import.here {
	border-color: var(--color-accent);
	box-shadow: 0 0 0 3px color-mix(in srgb, var(--color-accent) 16%, transparent);
}

.import:hover,
.import.open {
	border-color: color-mix(in srgb, var(--color-accent) 45%, var(--color-border-strong));
}

.main,
.toggle {
	display: inline-flex;
	align-items: center;
	gap: 7px;
	border: 0;
	background: transparent;
	color: var(--color-text);
	font: 500 12.5px/1 var(--font-sans);
	text-decoration: none;
	cursor: pointer;
	transition:
		background-color 120ms ease,
		color 120ms ease;
}

.main {
	position: relative;
	padding: 0 12px 0 10px;
	border-radius: 5px 0 0 5px;
}

.toggle {
	padding: 0 7px;
	border-left: 1px solid var(--color-border-strong);
	border-radius: 0 5px 5px 0;
	color: var(--color-text-muted);
}

.main:not(.status, :disabled, .disabled):hover,
.toggle:hover,
.open .toggle {
	background: color-mix(in srgb, var(--color-text) 7%, transparent);
	color: var(--color-text-strong);
}

.main:focus-visible,
.toggle:focus-visible,
.main:has(input:focus-visible) {
	outline: 2px solid var(--color-accent);
	outline-offset: 1px;
}

.main:disabled,
.main.disabled {
	color: var(--color-text-faint);
	cursor: default;
}

.main.status {
	cursor: default;
	color: var(--color-text-muted);
	overflow: hidden;
}

.count {
	font: 400 11px/1 var(--font-mono);
	color: var(--color-text-faint);
	font-variant-numeric: tabular-nums;
}

.track {
	position: absolute;
	left: 0;
	right: 0;
	bottom: 0;
	height: 2px;
}

.track span {
	display: block;
	height: 100%;
	background: var(--color-accent);
	transform-origin: left;
	transition: transform 200ms ease;
}

svg {
	width: 14px;
	height: 14px;
	fill: none;
	stroke: currentColor;
	stroke-width: 1.75;
	stroke-linecap: round;
	stroke-linejoin: round;
}

.main svg {
	color: var(--color-accent);
}

.main.disabled svg {
	color: inherit;
}

.toggle svg {
	transition: transform 150ms ease;
}

.open .toggle svg {
	transform: rotate(180deg);
}

.dot {
	width: 6px;
	height: 6px;
	border-radius: 50%;
	background: var(--color-text-muted);
}

.dot.live {
	background: var(--color-ahead);
	box-shadow: 0 0 0 3px rgb(67 212 146 / 0.18);
}

.dot.working {
	background: var(--color-accent);
	animation: pulse 1.2s ease-in-out infinite;
}

.dot.warn {
	background: var(--color-baseline);
}

.dot.danger {
	background: var(--color-danger);
}

.main.warn {
	color: var(--color-baseline);
}

.main.danger {
	color: var(--color-danger);
}

input {
	position: absolute;
	width: 1px;
	height: 1px;
	opacity: 0;
	pointer-events: none;
}

.menu {
	position: absolute;
	top: calc(100% + 6px);
	right: -1px;
	z-index: 20;
	display: flex;
	flex-direction: column;
	min-width: 16rem;
	padding: 4px;
	border: 1px solid var(--color-border-strong);
	border-radius: 8px;
	background: var(--color-surface-raised);
	box-shadow: 0 12px 32px rgb(0 0 0 / 0.45);
}

.item {
	position: relative;
	display: flex;
	flex-direction: column;
	gap: 2px;
	padding: 7px 10px;
	border: 0;
	border-radius: 5px;
	background: transparent;
	color: var(--color-text);
	text-align: left;
	text-decoration: none;
	cursor: pointer;
	transition: background-color 100ms ease;
}

.item:not(:disabled, .disabled):hover,
.item:focus-visible,
.item:has(input:focus-visible) {
	background: color-mix(in srgb, var(--color-accent) 14%, transparent);
	outline: none;
}

.item:disabled,
.item.disabled {
	opacity: 0.5;
	cursor: default;
}

.title {
	font-size: 12.5px;
	font-weight: 500;
}

.sub {
	font-size: 11.5px;
	color: var(--color-text-muted);
}

.sub code {
	font-size: 11px;
}

.rule {
	margin: 4px 0;
	border-top: 1px solid var(--color-border);
}

.hint {
	margin: 4px 0;
	padding: 6px 10px;
	border-top: 1px solid var(--color-border);
	border-bottom: 1px solid var(--color-border);
	font-size: 11.5px;
	color: var(--color-text-faint);
}

.manage {
	flex-direction: row;
	justify-content: space-between;
	align-items: center;
	color: var(--color-text-muted);
}

.manage:hover,
.manage[aria-current='page'] {
	color: var(--color-text);
}

@keyframes pulse {
	50% {
		opacity: 0.3;
	}
}
</style>
