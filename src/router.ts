import { createRouter, createWebHashHistory } from 'vue-router';
import RunView from './views/RunView.vue';

export const router = createRouter({
	// Hash mode: deep links resolve on any static host with no rewrite
	// rules and no generated per-route HTML.
	history: createWebHashHistory(),
	routes: [
		{ path: '/', name: 'run', component: RunView },
		{ path: '/data', name: 'data', component: () => import('./views/DataView.vue') },
		{ path: '/scenario/:hash', name: 'scenario', component: () => import('./views/ScenarioView.vue') },
		{ path: '/:pathMatch(.*)*', redirect: { name: 'run' } },
	],
});
