<script setup lang="ts">
/**
 * The About page (D5 of the About design): a short walkthrough of the charts
 * on real sample runs, then one action, importing your own stats.
 *
 * It never reads the database. The charts read a bundled snapshot of the demo
 * runs, provided here for the walkthrough below, so a first-time visitor sees
 * them at once instead of waiting for PGlite, which the app shell meanwhile
 * warms up for their import.
 */
import { onMounted, ref } from 'vue';
import AboutDemo from '../components/about/AboutDemo.vue';
import { provideDemo } from '../components/about/provideDemo';
import { markAboutSeen } from '../lib/about';
import { GITHUB_MARK_PATH, ISSUES_URL, REPO_URL } from '../lib/links';

const PRIVACY = 'Fully local: your stats stay in this browser. No server, no account, no tracking.';

const { state, attempt, now } = provideDemo();

/**
 * Browsers remember a failed dynamic import for the page's lifetime, so
 * importing the snapshot again would fail again: a retry reloads the page.
 */
function reload(): void {
	location.reload();
}

const walkthrough = ref<HTMLElement | null>(null);
function scrollToWalkthrough(): void {
	walkthrough.value?.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

onMounted(markAboutSeen);
</script>

<template>
	<article class="about">
		<header class="hero">
			<p class="eyebrow">KovaaK's run analysis</p>
			<h1>See where your runs are won and lost.</h1>
			<p class="lede">
				aimcurve reads the stats KovaaK's already saves after every run and shows how each one unfolded: where you
				pulled ahead, which bot cost you, and whether you are actually climbing your benchmarks.
			</p>
			<div class="actions">
				<RouterLink class="cta" :to="{ name: 'data' }">Import your stats</RouterLink>
				<button type="button" class="ghost" @click="scrollToWalkthrough">See an example ↓</button>
			</div>
			<p class="fine">{{ PRIVACY }}</p>
		</header>

		<div ref="walkthrough" class="walkthrough">
			<template v-if="state === 'ready' && attempt">
				<AboutDemo :attempt="attempt" :now="now" />
			</template>
			<p v-else-if="state === 'error'" class="error" role="alert">
				The sample runs could not be loaded.
				<button type="button" class="ghost" @click="reload">Reload the page</button>
			</p>
			<div v-else class="placeholder" aria-busy="true" aria-label="Loading the sample runs"></div>
		</div>

		<footer class="closing">
			<h2>Your runs are already on disk.</h2>
			<p>
				KovaaK's writes a stats file for every run you play. Point aimcurve at your <code>stats</code> folder and it
				charts all of them: every scenario, every run, every bot.
			</p>
			<div class="actions">
				<RouterLink class="cta" :to="{ name: 'data' }">Import your stats</RouterLink>
			</div>
			<p class="fine">{{ PRIVACY }}</p>

			<section class="project" aria-labelledby="project-heading">
				<h3 id="project-heading">Free and open source</h3>
				<p>
					aimcurve is a side project, still early. If it helps your practice, a star on GitHub helps other players find
					it. If something looks wrong or is missing, say so: every report makes it better.
				</p>
				<div class="actions">
					<a class="ghost star" :href="REPO_URL" target="_blank" rel="noopener">
						<svg viewBox="0 0 16 16" aria-hidden="true"><path :d="GITHUB_MARK_PATH" /></svg>
						Star on GitHub
					</a>
					<a class="ghost" :href="ISSUES_URL" target="_blank" rel="noopener">Report a bug or suggest a feature</a>
				</div>
			</section>
		</footer>
	</article>
</template>

<style scoped>
.about {
	display: flex;
	flex-direction: column;
	gap: clamp(3rem, 2rem + 4vw, 5.5rem);
	max-width: 1080px;
	margin: 0 auto;
	padding: clamp(2rem, 1rem + 5vw, 5rem) clamp(1rem, 0.5rem + 2vw, 2rem) 5rem;
}

.hero {
	max-width: 44rem;
}

.eyebrow {
	font: 500 12px/1 var(--font-mono);
	letter-spacing: 0.1em;
	text-transform: uppercase;
	color: var(--color-accent);
	margin-bottom: var(--space-4);
}

h1 {
	font-size: clamp(2rem, 1.3rem + 3.2vw, 3.4rem);
	line-height: 1.05;
	letter-spacing: -0.025em;
	color: var(--color-text-strong);
	text-wrap: balance;
}

.lede {
	margin-top: var(--space-4);
	font-size: clamp(1rem, 0.95rem + 0.3vw, 1.125rem);
	color: var(--color-text-muted);
	max-width: 60ch;
}

.actions {
	display: flex;
	flex-wrap: wrap;
	align-items: center;
	gap: var(--space-3);
	margin-top: var(--space-6);
}

.cta {
	padding: 10px 18px;
	border-radius: 6px;
	background: var(--color-accent);
	color: var(--color-accent-contrast);
	font-weight: 600;
	text-decoration: none;
	transition: filter 120ms ease;
}

.cta:hover {
	filter: brightness(1.1);
}

.ghost {
	padding: 9px 14px;
	border: 1px solid var(--color-border-strong);
	border-radius: 6px;
	background: transparent;
	color: var(--color-text-muted);
	cursor: pointer;
	transition:
		color 120ms ease,
		border-color 120ms ease;
}

.ghost:hover {
	color: var(--color-text);
	border-color: var(--color-text-faint);
}

.fine {
	margin-top: var(--space-3);
	font-size: 0.8125rem;
	color: var(--color-text-faint);
}

.walkthrough {
	display: flex;
	flex-direction: column;
	gap: clamp(3rem, 2rem + 4vw, 5rem);
	scroll-margin-top: var(--space-6);
}

.placeholder {
	height: 520px;
	border: 1px solid var(--color-border);
	border-radius: 3px;
	background: var(--color-surface);
}

.error {
	display: flex;
	flex-wrap: wrap;
	align-items: center;
	gap: var(--space-3);
	color: var(--color-danger);
}

.closing {
	padding-top: clamp(2rem, 1.5rem + 2vw, 3rem);
	border-top: 1px solid var(--color-border);
	max-width: 44rem;
}

.closing h2 {
	font-size: clamp(1.5rem, 1.2rem + 1.2vw, 2rem);
	color: var(--color-text-strong);
	letter-spacing: -0.015em;
}

.project {
	margin-top: clamp(2rem, 1.5rem + 2vw, 3rem);
	padding-top: clamp(1.5rem, 1rem + 1.5vw, 2rem);
	border-top: 1px solid var(--color-border);
}

.project h3 {
	font-size: 1.0625rem;
	color: var(--color-text-strong);
}

.project .actions {
	margin-top: var(--space-4);
}

a.ghost {
	text-decoration: none;
}

.star {
	display: inline-flex;
	align-items: center;
	gap: 8px;
}

.star svg {
	width: 16px;
	height: 16px;
	fill: currentColor;
}

.closing p:not(.fine) {
	margin-top: var(--space-3);
	color: var(--color-text-muted);
}
</style>
