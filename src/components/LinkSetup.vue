<script setup lang="ts">
/**
 * The way out of a KovaaK's install that Chromium will not open.
 *
 * It is offered next to Connect rather than behind a failure, because the
 * picker cannot tell us it failed: a blocklisted folder rejects with the same
 * `AbortError` a cancel does. Anyone whose game sits in Program Files hits
 * this on their first attempt, so a remedy only reachable through an error is
 * a remedy most of them would never see.
 */
import { computed, ref } from 'vue';
import { buildScript, DEFAULT_KOVAAKS_PATH } from '../lib/run/link-setup';

const path = ref(DEFAULT_KOVAAKS_PATH);
const result = computed(() => buildScript(path.value));
const copied = ref(false);

let clear: ReturnType<typeof setTimeout> | undefined;

async function copy(): Promise<void> {
	const current = result.value;
	if (!current.ok) return;
	try {
		// The trailing newline runs the closing `}` on paste instead of leaving
		// the loop waiting at the prompt for an Enter nobody knows to press.
		await navigator.clipboard.writeText(`${current.script}\n`);
		copied.value = true;
		clearTimeout(clear);
		clear = setTimeout(() => (copied.value = false), 2000);
	} catch {
		// A denied clipboard leaves the script on screen to select by hand,
		// which is the whole fallback this needs.
		copied.value = false;
	}
}
</script>

<template>
	<details class="setup">
		<summary>Kovaak's in Program Files?</summary>

		<p class="lede">Chrome can't open folders there. Move your stats out once and link them back.</p>

		<label class="field">
			<span>Your Kovaak's folder — the one with <code>stats</code> and <code>performances</code> in it:</span>
			<input v-model="path" type="text" spellcheck="false" autocomplete="off" />
		</label>

		<!--
			An unusable path ends the panel: every line below this one talks about
			a script that does not exist yet, and leaving them up would have the
			user reading instructions for a command they cannot run.
		-->
		<p v-if="!result.ok" class="hint invalid">{{ result.reason }}</p>
		<template v-else>
			<p class="hint">In Steam: right-click KovaaK's → Manage → Browse local files, then open <code>FPSAimTrainer</code>.</p>

			<p class="lede">
				Close KovaaK's, then paste this into PowerShell <strong>as administrator</strong> (right-click
				Start → Terminal (Admin)) — Windows protects Program Files.
			</p>

			<div class="script">
				<pre><code>{{ result.script }}</code></pre>
				<button
					type="button"
					class="copy"
					:class="{ copied }"
					:aria-label="copied ? 'Copied' : 'Copy'"
					:title="copied ? 'Copied' : 'Copy'"
					@click="copy()"
				>
					<svg viewBox="0 0 24 24" aria-hidden="true">
						<path v-if="copied" d="m5 13 4 4 10-10" />
						<template v-else>
							<rect x="9" y="9" width="11" height="11" rx="2" />
							<path d="M5 15H4a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v1" />
						</template>
					</svg>
				</button>
			</div>

			<p class="lede">
				Then Connect folder and pick <code>aimcurve</code> in your user folder. KovaaK's keeps
				writing where it always did.
			</p>
		</template>
	</details>
</template>

<style scoped>
.setup {
	border-top: 1px solid var(--color-border);
	padding-top: var(--space-3);
	font-size: 0.875rem;
}

summary {
	cursor: pointer;
	color: var(--color-text-muted);
}

summary:hover,
.setup[open] summary {
	color: var(--color-text);
}

.setup[open] summary {
	margin-bottom: var(--space-3);
}

.lede,
.hint {
	color: var(--color-text-muted);
}

.hint {
	font-size: 0.8125rem;
}

.invalid {
	margin-top: var(--space-1);
	color: var(--color-danger);
}

.field {
	display: flex;
	flex-direction: column;
	gap: var(--space-1);
	margin-top: var(--space-3);
	color: var(--color-text-muted);
}

input {
	width: 100%;
	padding: var(--space-2);
	border: 1px solid var(--color-border);
	border-radius: 8px;
	background: var(--color-bg);
	color: var(--color-text);
	font-family: var(--font-mono);
	font-size: 0.8125rem;
}

input:focus-visible {
	outline: 2px solid var(--color-accent);
	outline-offset: 1px;
}

.setup > .lede:not(:first-of-type) {
	margin-top: var(--space-3);
}

.script {
	position: relative;
	margin-top: var(--space-2);
}

pre {
	margin: 0;
	padding: var(--space-3);
	border: 1px solid var(--color-border);
	border-radius: 8px;
	background: var(--color-bg);
	/* The card is narrow and the paths are long. Wrapping keeps every command
	   on screen; a scrollbar would hide the one line the user has to check. */
	white-space: pre-wrap;
	overflow-wrap: anywhere;
}

code {
	font-family: var(--font-mono);
	font-size: 0.8125rem;
}

.copy {
	position: absolute;
	top: var(--space-2);
	right: var(--space-2);
	display: flex;
	padding: var(--space-1);
	border: 1px solid var(--color-border);
	border-radius: 6px;
	background: var(--color-bg);
	color: var(--color-text-muted);
	cursor: pointer;
	opacity: 0;
	transition: opacity 120ms ease;
}

/* Keyboard users never hover, and a pointer that cannot hover would never
   reveal it at all, so neither is left without the button. */
.script:hover .copy,
.copy:focus-visible,
.copy.copied {
	opacity: 1;
}

@media (hover: none) {
	.copy {
		opacity: 1;
	}
}

.copy:hover {
	border-color: var(--color-accent);
	color: var(--color-accent);
}

.copy.copied {
	color: var(--color-accent);
}

.copy svg {
	width: 1rem;
	height: 1rem;
	fill: none;
	stroke: currentColor;
	stroke-width: 1.5;
	stroke-linecap: round;
	stroke-linejoin: round;
}
</style>
