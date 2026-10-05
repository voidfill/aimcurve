<script setup lang="ts">
/**
 * Dev only (D7 of the About design): the 1200×630 link-preview image, drawn
 * from the demo run. `pnpm shots` captures it into `public/og.png` (see
 * docs/preview-assets.md). It covers the app shell, so the viewport is exactly
 * the card. A route of its own rather than a mode of About, so making the
 * image never marks About as seen and never ships.
 *
 * Two panels of the same size, the run's pace chart on the left and on the
 * right one category of the benchmark sheet with a subcategory's history
 * open. Their boxes overlap a little, but along a diagonal from top left to
 * bottom right each fades out to the card's background before the other fades
 * in: nothing is ever drawn over anything else.
 */
import CardChart from '../../components/about/CardChart.vue';
import CardSheet from '../../components/about/CardSheet.vue';
import { provideDemo } from '../../components/about/provideDemo';

const { state, attempt, now } = provideDemo();
</script>

<template>
	<!-- Everything past the card is cut off, so the route shows exactly what the image will. -->
	<div class="backdrop">
		<div class="card" data-shot="og">
			<header>
				<p class="brand">
					<img src="/favicon.svg" alt="" />
					<span>aim<b>curve</b></span>
				</p>
				<h1>See where your KovaaK's runs are won and lost.</h1>
				<p class="sub">Pace and bots for every run, progress across your benchmarks. Free, in your browser, fully local.</p>
			</header>
			<div v-if="state === 'ready' && attempt" class="stage">
				<div class="layer run">
					<div class="panel plot">
						<CardChart :attempt="attempt" />
					</div>
				</div>
				<div class="layer bench">
					<div class="panel sheet">
						<CardSheet :now="now" open="Speed" />
					</div>
				</div>
			</div>
		</div>
	</div>
</template>

<style scoped>
.backdrop {
	position: fixed;
	inset: 0;
	z-index: 1000;
	overflow: hidden;
	background: #2b2f34;
}

.card {
	position: absolute;
	top: 0;
	left: 0;
	width: 1200px;
	height: 630px;
	display: flex;
	flex-direction: column;
	gap: 22px;
	padding: 34px 40px 0;
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
	margin-top: 18px;
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

/*
 * Both layers cover the whole stage, so their masks share one geometry: the
 * run fades out by --out, the sheet fades in from --in, and between the two
 * is plain background. The panels themselves are the same size, each --w of
 * the stage, and run off the card's bottom edge.
 */
.stage {
	--angle: 50deg;
	--out: 48.5%;
	--in: 51.5%;
	--soft: 3%;
	--w: 65%;
	position: relative;
	flex: 1 1 0;
	min-height: 0;
}

.layer {
	position: absolute;
	inset: 0;
}

.run {
	-webkit-mask-image: linear-gradient(var(--angle), #000 calc(var(--out) - var(--soft)), transparent var(--out));
	mask-image: linear-gradient(var(--angle), #000 calc(var(--out) - var(--soft)), transparent var(--out));
}

.bench {
	-webkit-mask-image: linear-gradient(var(--angle), transparent var(--in), #000 calc(var(--in) + var(--soft)));
	mask-image: linear-gradient(var(--angle), transparent var(--in), #000 calc(var(--in) + var(--soft)));
}

.panel {
	position: absolute;
	top: 0;
	bottom: 0;
	width: var(--w);
	overflow: hidden;
	border: 1px solid var(--color-border);
	border-bottom: 0;
	border-radius: 6px 6px 0 0;
	background: var(--color-surface);
}

.plot {
	left: 0;
	display: flex;
	flex-direction: column;
	padding: 8px 10px 0 0;
}

.sheet {
	right: 0;
	padding: 10px 10px 0;
}

/* Names and candles only: the pills would squeeze the lanes, and add little here. */
.sheet :deep(.sheet) {
	min-width: 0;
}

.sheet :deep(.sheet-grid) {
	grid-template-columns: 200px minmax(0, 1fr);
}

.sheet :deep(.row > :nth-child(n + 3)) {
	display: none;
}

.plot :deep(.chart) {
	flex: 1 1 0;
	height: auto;
	min-height: 0;
	cursor: default;
}
</style>
