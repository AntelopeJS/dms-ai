<script setup lang="ts">
import { computed, inject } from "vue";
import { ASSISTANT_SESSION_KEY } from "../runtime/assistant-session";
import { LAUNCHER_ICON } from "../runtime/constants";
import type { LauncherState } from "../runtime/launcher-state";

const sessionRef = inject(ASSISTANT_SESSION_KEY, null);
const state = computed<LauncherState>(
	() => sessionRef?.value?.launcherState.value ?? "connected",
);
</script>

<template>
	<span class="dms-ai-launcher" :data-state="state" aria-hidden="true">
		<UIcon :name="LAUNCHER_ICON" class="dms-ai-launcher__icon" />
		<span class="dms-ai-launcher__dot" />
	</span>
</template>

<style scoped>
.dms-ai-launcher {
	position: relative;
	display: inline-flex;
	width: 18px;
	height: 18px;
	flex: none;
}

.dms-ai-launcher__icon {
	width: 18px;
	height: 18px;
	transform-origin: center;
	transition:
		color 0.2s ease,
		opacity 0.2s ease;
}

.dms-ai-launcher__dot {
	position: absolute;
	right: -3px;
	bottom: -3px;
	width: 7px;
	height: 7px;
	box-sizing: border-box;
	border-radius: 50%;
	background: currentColor;
	box-shadow: 0 0 0 1.5px var(--ui-bg);
	opacity: 0;
	transform: scale(0.4);
	transition:
		opacity 0.2s ease,
		transform 0.2s ease,
		background-color 0.2s ease;
}

.dms-ai-launcher__dot::after {
	content: "";
	position: absolute;
	inset: 0;
	border-radius: 50%;
	background: var(--ui-warning);
	opacity: 0;
}

.dms-ai-launcher:not([data-state="connected"]) .dms-ai-launcher__dot {
	opacity: 1;
	transform: scale(1);
}

.dms-ai-launcher[data-state="disconnected"] .dms-ai-launcher__icon {
	opacity: 0.4;
}

.dms-ai-launcher[data-state="disconnected"] .dms-ai-launcher__dot {
	background: var(--ui-bg);
	border: 1.5px solid var(--ui-text-dimmed);
	box-shadow: none;
}

.dms-ai-launcher[data-state="connected"] {
	animation: dms-ai-launcher-settle 0.45s ease-out;
}

.dms-ai-launcher[data-state="working"] .dms-ai-launcher__icon {
	color: var(--ui-primary);
	animation: dms-ai-launcher-twinkle 2.6s ease-in-out infinite;
}

.dms-ai-launcher[data-state="working"] .dms-ai-launcher__dot {
	background: var(--ui-primary);
}

.dms-ai-launcher[data-state="finished"] .dms-ai-launcher__icon {
	animation: dms-ai-launcher-pop 0.5s cubic-bezier(0.34, 1.56, 0.64, 1);
}

.dms-ai-launcher[data-state="finished"] .dms-ai-launcher__dot {
	background: var(--ui-success);
	animation: dms-ai-launcher-dot-in 0.5s cubic-bezier(0.34, 1.56, 0.64, 1);
}

.dms-ai-launcher[data-state="question"] .dms-ai-launcher__icon {
	animation: dms-ai-launcher-nudge 5s ease-in-out infinite;
}

.dms-ai-launcher[data-state="question"] .dms-ai-launcher__dot {
	background: var(--ui-warning);
	box-shadow:
		0 0 0 1.5px var(--ui-bg),
		0 0 0 3.5px color-mix(in srgb, var(--ui-warning) 35%, transparent);
}

.dms-ai-launcher[data-state="question"] .dms-ai-launcher__dot::after {
	animation: dms-ai-launcher-ping 1.8s cubic-bezier(0, 0, 0.2, 1) infinite;
}

@keyframes dms-ai-launcher-settle {
	from {
		transform: scale(0.88);
	}
}

@keyframes dms-ai-launcher-twinkle {
	0%,
	100% {
		opacity: 1;
		transform: scale(1) rotate(0deg);
	}
	50% {
		opacity: 0.78;
		transform: scale(1.14) rotate(14deg);
	}
}

@keyframes dms-ai-launcher-pop {
	0% {
		transform: scale(0.8);
	}
	60% {
		transform: scale(1.22);
	}
}

@keyframes dms-ai-launcher-dot-in {
	from {
		opacity: 0;
		transform: scale(0);
	}
}

@keyframes dms-ai-launcher-nudge {
	0%,
	84%,
	100% {
		transform: rotate(0deg);
	}
	88% {
		transform: rotate(-14deg);
	}
	92% {
		transform: rotate(11deg);
	}
	96% {
		transform: rotate(-5deg);
	}
}

@keyframes dms-ai-launcher-ping {
	0% {
		opacity: 0.55;
		transform: scale(1);
	}
	75%,
	100% {
		opacity: 0;
		transform: scale(2.6);
	}
}

:root.dms-reduce-motion .dms-ai-launcher,
:root.dms-reduce-motion .dms-ai-launcher__icon,
:root.dms-reduce-motion .dms-ai-launcher__dot,
:root.dms-reduce-motion .dms-ai-launcher__dot::after {
	animation: none !important;
	transition: none;
}

@media (prefers-reduced-motion: reduce) {
	:root:not(.dms-full-motion) .dms-ai-launcher,
	:root:not(.dms-full-motion) .dms-ai-launcher__icon,
	:root:not(.dms-full-motion) .dms-ai-launcher__dot,
	:root:not(.dms-full-motion) .dms-ai-launcher__dot::after {
		animation: none !important;
		transition: none;
	}
}
</style>
