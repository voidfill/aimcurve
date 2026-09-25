<script setup lang="ts">
/**
 * Drop stats files, or a folder holding them, anywhere on the page to import
 * them once. A drop is a snapshot, exactly like choosing files.
 *
 * `dragenter` and `dragleave` fire for every child the pointer crosses, so a
 * depth counter, not the last event, decides whether a drag is over the page.
 *
 * Drags that carry no files, such as text or a link from the page itself, are
 * left alone. A file drag is always cancelled, even while importing is
 * unavailable, because an uncancelled drop navigates the tab to the file.
 */
import { computed, ref } from 'vue';
import { useEventListener } from '@vueuse/core';
import { useDb } from '../composables/useDb';
import { useImport } from '../composables/useImport';
import { dragHasFiles, filesFromEntries, type DropEntry } from '../lib/ingest/drop';

const { ready, error: dbError } = useDb();
const { importFiles } = useImport();

const available = computed(() => ready.value && dbError.value === null);

const depth = ref(0);
const dragging = computed(() => depth.value > 0);
const notice = ref<string | null>(null);
let clearNotice: ReturnType<typeof setTimeout> | undefined;

function flash(text: string): void {
	notice.value = text;
	clearTimeout(clearNotice);
	clearNotice = setTimeout(() => (notice.value = null), 3000);
}

function isFileDrag(event: DragEvent): boolean {
	return event.dataTransfer !== null && dragHasFiles(Array.from(event.dataTransfer.types));
}

useEventListener(window, 'dragenter', (event: DragEvent) => {
	if (!isFileDrag(event)) return;
	event.preventDefault();
	depth.value += 1;
});

useEventListener(window, 'dragover', (event: DragEvent) => {
	if (!isFileDrag(event)) return;
	event.preventDefault();
	if (event.dataTransfer !== null) event.dataTransfer.dropEffect = available.value ? 'copy' : 'none';
});

useEventListener(window, 'dragleave', (event: DragEvent) => {
	if (!isFileDrag(event)) return;
	depth.value = Math.max(0, depth.value - 1);
});

useEventListener(window, 'drop', (event: DragEvent) => {
	if (!isFileDrag(event)) return;
	event.preventDefault();
	depth.value = 0;
	if (!available.value || event.dataTransfer === null) return;

	// Taken now: the item list is emptied as soon as this handler yields.
	const entries: DropEntry[] = [];
	for (const item of Array.from(event.dataTransfer.items)) {
		const entry = item.kind === 'file' ? item.webkitGetAsEntry() : null;
		if (entry !== null) entries.push(entry);
	}

	void (async () => {
		let files: File[];
		try {
			files = await filesFromEntries(entries);
		} catch {
			flash('That drop could not be read.');
			return;
		}
		if (files.length === 0) {
			flash('No Stats.csv or Performance.perf files in that drop.');
			return;
		}
		await importFiles(files);
	})();
});
</script>

<template>
	<Transition name="fade">
		<div v-if="dragging" class="overlay" aria-hidden="true">
			<div class="target" :class="{ unavailable: !available }">
				<svg viewBox="0 0 24 24"><path d="M12 15V4m0 0 4 4m-4-4-4 4M4 15v4a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-4" /></svg>
				<p class="title">{{ available ? 'Drop to import' : 'Importing is unavailable right now' }}</p>
				<p class="sub">Your stats folder or its files. Nothing leaves this browser.</p>
			</div>
		</div>
	</Transition>
	<Transition name="fade">
		<p v-if="notice !== null" class="notice" role="status">{{ notice }}</p>
	</Transition>
</template>

<style scoped>
.overlay {
	position: fixed;
	inset: 0;
	z-index: 50;
	display: grid;
	place-items: center;
	padding: var(--space-6);
	background: rgb(11 13 15 / 0.78);
	backdrop-filter: blur(3px);
	/* The drag events belong to the window; the overlay must not eat them. */
	pointer-events: none;
}

.target {
	display: flex;
	flex-direction: column;
	align-items: center;
	gap: var(--space-2);
	width: min(32rem, 100%);
	padding: var(--space-8) var(--space-6);
	border: 2px dashed color-mix(in srgb, var(--color-accent) 70%, transparent);
	border-radius: 14px;
	background: color-mix(in srgb, var(--color-accent) 8%, var(--color-surface));
	text-align: center;
}

.target.unavailable {
	border-color: var(--color-border-strong);
	background: var(--color-surface);
}

svg {
	width: 2rem;
	height: 2rem;
	fill: none;
	stroke: var(--color-accent);
	stroke-width: 1.5;
	stroke-linecap: round;
	stroke-linejoin: round;
}

.unavailable svg {
	stroke: var(--color-text-faint);
}

.title {
	font-size: 1.0625rem;
	font-weight: 600;
}

.sub {
	font-size: 0.875rem;
	color: var(--color-text-muted);
}

.notice {
	position: fixed;
	left: 50%;
	bottom: var(--space-6);
	z-index: 50;
	transform: translateX(-50%);
	padding: var(--space-2) var(--space-4);
	border: 1px solid var(--color-border-strong);
	border-radius: 8px;
	background: var(--color-surface-raised);
	font-size: 0.875rem;
	box-shadow: 0 8px 24px rgb(0 0 0 / 0.4);
}

.fade-enter-active,
.fade-leave-active {
	transition: opacity 120ms ease;
}

.fade-enter-from,
.fade-leave-to {
	opacity: 0;
}
</style>
