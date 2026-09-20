<script setup lang="ts"></script>

<template>
	<header>
		<strong>aimcurve</strong>
		<nav>
			<RouterLink :to="{ name: 'run' }">Run</RouterLink>
			<RouterLink :to="{ name: 'data' }">Data</RouterLink>
		</nav>
	</header>
</template>
