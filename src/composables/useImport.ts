/**
 * The import controller, as reactive state.
 *
 * A module singleton, and deliberately thin: the lifecycle lives in
 * `import-controller.ts`, which knows nothing about Vue. This mirrors its
 * `onState` callback into one `reactive` object and turns `onCommitted` into a
 * revision counter that data views watch.
 *
 * Exactly one controller exists per document, so exactly one ingest worker and
 * at most one folder watcher exist per document.
 */
import { markRaw, reactive, ref, shallowRef, watch, type Ref } from 'vue';
import type { PGliteInterface } from '@electric-sql/pglite';
import {
	createImportController,
	initialImportState,
	type ImportController,
	type ImportState,
} from '../lib/run/import-controller';
import { useDb } from './useDb';

export interface ImportApi {
	state: ImportState;
	/** Increments after every pass that wrote rows, including a partly committed failed one. */
	revision: Ref<number>;
	connect: () => Promise<void>;
	reconnect: () => Promise<void>;
	importFiles: (files: FileList | File[]) => Promise<void>;
	disconnect: () => Promise<void>;
	retryScan: () => Promise<void>;
}

let api: ImportApi | undefined;

function create(): ImportApi {
	const state = reactive<ImportState>(initialImportState());
	const revision = ref(0);
	// The controller owns a `Worker` and a `FileSystemDirectoryHandle`; a deep
	// proxy over either wraps their methods and breaks them, so it is held raw.
	const controller = shallowRef<ImportController | null>(null);

	const { pg } = useDb();

	function start(handle: PGliteInterface | null): boolean {
		if (handle === null || controller.value !== null) return false;
		const instance = markRaw(
			createImportController(
				handle,
				(next) => {
					Object.assign(state, next);
				},
				async () => {
					revision.value += 1;
				},
			),
		);
		controller.value = instance;
		// Once per document lifetime, because the controller is created once.
		void instance.restore();
		return true;
	}

	if (!start(pg.value)) {
		// Not a component watcher — there is no scope here — so it stops itself
		// as soon as the connection arrives.
		const stop = watch(pg, (handle) => {
			if (start(handle)) stop();
		});
	}

	const act = (run: (c: ImportController) => Promise<void>) => async (): Promise<void> => {
		const instance = controller.value;
		if (instance === null) return;
		await run(instance);
	};

	return {
		state,
		revision,
		connect: act((c) => c.connect()),
		reconnect: act((c) => c.reconnect()),
		importFiles: async (files: FileList | File[]) => {
			// The caller resets its input value right after this returns; the
			// controller copies the `FileList` before its first await.
			await controller.value?.importFiles(files);
		},
		disconnect: act((c) => c.disconnect()),
		retryScan: act((c) => c.retryScan()),
	};
}

export function useImport(): ImportApi {
	api ??= create();
	return api;
}

if (import.meta.hot) {
	// Re-running this module would create a second DB worker, ingest worker,
	// and watcher beside the live ones. Escalate to a full reload instead.
	import.meta.hot.accept(() => import.meta.hot!.invalidate());
}
