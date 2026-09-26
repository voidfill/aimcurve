<script setup lang="ts">
/**
 * Dev only (D7 of the About design): the 1200×630 link-preview image, drawn
 * from the demo run, to be screenshotted into `public/og.png`:
 *
 *     chrome --headless --window-size=1200,630 --screenshot=public/og.png http://localhost:4321/#/dev/card
 *
 * It covers the app shell, so the viewport is exactly the card. A route of
 * its own rather than a mode of About, so making the image never marks About
 * as seen and never ships.
 */
import CardChart from '../../components/about/CardChart.vue';
import { provideDemo } from '../../components/about/provideDemo';

const { state, attempt } = provideDemo();
</script>

<template>
	<div class="card" :data-ready="state === 'ready' ? '' : undefined">
		<header>
			<p class="brand">
				<img src="/favicon.svg" alt="" />
				<span>aim<b>curve</b></span>
			</p>
			<h1>See where your KovaaK's runs are won and lost.</h1>
			<p class="sub">Pace, bots and progress for every run. Free, in your browser, fully local.</p>
		</header>
		<div class="plot">
			<CardChart v-if="state === 'ready' && attempt" :attempt="attempt" />
		</div>
	</div>
</template>

<style scoped>
.card {
	position: fixed;
	inset: 0;
	z-index: 1000;
	width: 1200px;
	height: 630px;
	display: flex;
	flex-direction: column;
	gap: 18px;
	padding: 44px 48px 28px;
	background:
		radial-gradient(900px 420px at 85% -10%, rgba(95, 155, 214, 0.16), transparent 70%),
		var(--color-bg);
	overflow: hidden;
}

.brand {
	display: flex;
	align-items: center;
	gap: 10px;
	font: 500 20px/1 var(--font-mono);
	letter-spacing: 0.06em;
	color: var(--color-text-faint);
}

.brand img {
	width: 30px;
	height: 30px;
}

.brand b {
	font-weight: 500;
	color: var(--color-text);
}

h1 {
	margin-top: 22px;
	font-size: 46px;
	line-height: 1.05;
	letter-spacing: -0.025em;
	color: var(--color-text-strong);
}

.sub {
	margin-top: 10px;
	font-size: 20px;
	color: var(--color-text-muted);
}

.plot {
	flex: 1 1 0;
	min-height: 0;
	display: flex;
	flex-direction: column;
	border: 1px solid var(--color-border);
	border-radius: 4px;
	background: var(--color-surface);
	padding: 6px 10px 0 0;
}

.plot :deep(.chart) {
	flex: 1 1 0;
	height: auto;
	min-height: 0;
	cursor: default;
}
</style>
