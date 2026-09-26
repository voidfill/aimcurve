/**
 * The data source the analysis composables read through (D2 of the About
 * design): the database in the app, the bundled snapshot on the About page.
 *
 * `App.vue` provides the database; About provides the snapshot from a parent
 * of the component that reads it, because `inject` never sees the calling
 * component's own `provide`. There is deliberately no default: a view that
 * forgot its provider fails loudly instead of silently reading the database.
 *
 * Must not import `useDb` or `db/client`, or PGlite would follow into About.
 */
import { inject, provide, type InjectionKey, type Ref } from 'vue';
import type { DataSource } from '../lib/data-source';

export interface SourceApi {
	/** Null until the source is ready. */
	source: Readonly<Ref<DataSource | null>>;
	/** Bumps whenever the source's data changes. */
	revision: Ref<number>;
}

export const SOURCE_KEY: InjectionKey<SourceApi> = Symbol('aimcurve.source');

export function provideSource(api: SourceApi): void {
	provide(SOURCE_KEY, api);
}

export function useSource(): SourceApi {
	const api = inject(SOURCE_KEY, null);
	if (api === null) throw new Error('No data source was provided for this view');
	return api;
}
