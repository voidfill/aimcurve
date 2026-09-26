import { createRouter, createWebHashHistory } from 'vue-router';
import RunView from './views/RunView.vue';

export const router = createRouter({
	// Hash mode: deep links resolve on any static host with no rewrite
	// rules and no generated per-route HTML.
	history: createWebHashHistory(),
	routes: [
		{ path: '/', name: 'run', component: RunView },
		{ path: '/data', name: 'data', component: () => import('./views/DataView.vue') },
		{ path: '/about', name: 'about', component: () => import('./views/AboutView.vue') },
		{ path: '/scenarios', name: 'scenarios', component: () => import('./views/ScenariosView.vue') },
		{ path: '/scenario/:hash', name: 'scenario', component: () => import('./views/ScenarioView.vue') },
		// The link-preview image's source (D7 of the About design); never shipped.
		...(import.meta.env.DEV
			? [{ path: '/dev/card', name: 'dev-card', component: () => import('./views/dev/CardView.vue') }]
			: []),
		{ path: '/:pathMatch(.*)*', redirect: { name: 'run' } },
	],
});
