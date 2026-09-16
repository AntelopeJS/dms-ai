<script setup lang="ts">
import { computed, onUnmounted, ref, watch } from "vue";
import {
	TOOL_CLUSTER_COLLAPSE_LINGER_MS,
	TOOL_CLUSTER_LABEL,
	TOOL_CLUSTER_VISIBLE_LIMIT,
	TOOL_STATUS,
} from "../constants/conversation";
import type { ToolCallMessage, ToolStatus } from "../types/conversation";
import { toolSummary } from "../utils/tool-summary";
import ToolCallEntry from "./ToolCallEntry.vue";

interface Props {
	tools: ToolCallMessage[];
	// True while this is the trailing tool activity of a running turn.
	live: boolean;
}

const props = defineProps<Props>();

// null = follow the run automatically; once the user clicks, their choice is
// pinned (true = forced open with full detail, false = forced collapsed).
const override = ref<boolean | null>(null);
// Reveal of the rows hidden behind the last-N cap, independent of open state.
const showAll = ref(false);

// When a cluster stops being live it lingers open briefly so a fast hand-off to
// the next cluster doesn't read as a flash.
const lingering = ref(false);
let lingerTimer: ReturnType<typeof setTimeout> | null = null;

watch(
	() => props.live,
	(isLive, wasLive) => {
		if (isLive) {
			lingering.value = false;
			if (lingerTimer !== null) clearTimeout(lingerTimer);
			lingerTimer = null;
			return;
		}
		if (!wasLive) return;
		lingering.value = true;
		if (lingerTimer !== null) clearTimeout(lingerTimer);
		lingerTimer = setTimeout(() => {
			lingering.value = false;
			lingerTimer = null;
		}, TOOL_CLUSTER_COLLAPSE_LINGER_MS);
	},
);

onUnmounted(() => {
	if (lingerTimer !== null) clearTimeout(lingerTimer);
});

const rollupStatus = computed<ToolStatus>(() => {
	if (props.tools.some((t) => t.status === TOOL_STATUS.PENDING)) {
		return TOOL_STATUS.PENDING;
	}
	if (props.tools.some((t) => t.status === TOOL_STATUS.ERROR)) {
		return TOOL_STATUS.ERROR;
	}
	return TOOL_STATUS.SUCCESS;
});

// Errors stay open even once settled so failures are never hidden.
const hasError = computed<boolean>(() =>
	props.tools.some((t) => t.status === TOOL_STATUS.ERROR),
);

const autoOpen = computed<boolean>(
	() => props.live || lingering.value || hasError.value,
);
const isOpen = computed<boolean>(() =>
	override.value !== null ? override.value : autoOpen.value,
);
// A deliberate expand shows every row; the live peek caps to the last N.
const isFull = computed<boolean>(() => override.value === true || showAll.value);

const visibleTools = computed<ToolCallMessage[]>(() =>
	isFull.value ? props.tools : props.tools.slice(-TOOL_CLUSTER_VISIBLE_LIMIT),
);
const hiddenCount = computed<number>(
	() => props.tools.length - visibleTools.value.length,
);

// Spinner while the agent is actively working here, even between two quick
// tools where nothing is momentarily pending.
const glyphStatus = computed<ToolStatus>(() =>
	props.live ? TOOL_STATUS.PENDING : rollupStatus.value,
);

const headline = computed<string>(() => {
	const active =
		props.tools.find((t) => t.status === TOOL_STATUS.PENDING) ??
		props.tools.at(-1);
	if (active === undefined) return "";
	return toolSummary(active.toolName, active.args);
});

const countLabel = computed<string>(
	() => `${TOOL_CLUSTER_LABEL} ${props.tools.length} tools`,
);

function toggle(): void {
	override.value = !isOpen.value;
}

function revealEarlier(): void {
	showAll.value = true;
}
</script>

<template>
	<section class="tool-cluster" :data-status="rollupStatus">
		<button
			type="button"
			class="cluster-header"
			:aria-expanded="isOpen"
			@click="toggle"
		>
			<span class="cluster-toggle">{{ isOpen ? "▾" : "▸" }}</span>
			<span class="cluster-glyph" :data-status="glyphStatus" aria-hidden="true">
				<svg v-if="glyphStatus === 'pending'" class="cluster-spin" viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><path d="M21 12a9 9 0 1 1-6.2-8.6"/></svg>
				<svg v-else-if="glyphStatus === 'error'" viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M18 6 6 18M6 6l12 12"/></svg>
				<svg v-else viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg>
			</span>
			<span class="cluster-count">{{ countLabel }}</span>
			<span v-if="!isOpen && headline.length > 0" class="cluster-headline">
				{{ headline }}
			</span>
		</button>
		<div v-if="isOpen" class="cluster-body">
			<button
				v-if="hiddenCount > 0"
				type="button"
				class="cluster-earlier"
				@click="revealEarlier"
			>
				▴ {{ hiddenCount }} earlier
			</button>
			<ToolCallEntry
				v-for="tool in visibleTools"
				:key="tool.id"
				:message="tool"
			/>
		</div>
	</section>
</template>

<style scoped>
.tool-cluster {
	border: 1px solid var(--hair);
	border-radius: var(--radius-md);
	background: var(--surface-card);
	overflow: hidden;
}

.cluster-header {
	display: flex;
	align-items: center;
	gap: 8px;
	width: 100%;
	padding: 8px 10px;
	background: transparent;
	border: none;
	cursor: pointer;
	font: inherit;
	text-align: left;
	color: var(--fg);
}

.cluster-header:hover {
	background: var(--surface-card-2);
}

.cluster-toggle {
	color: var(--fg-tertiary);
	font-size: 11px;
	flex: 0 0 auto;
}

.cluster-glyph {
	width: 20px;
	height: 20px;
	flex: 0 0 auto;
	display: grid;
	place-items: center;
	border-radius: 6px;
}

.cluster-glyph[data-status="pending"] {
	color: var(--warning-400);
}

.cluster-glyph[data-status="success"] {
	color: var(--success-400);
}

.cluster-glyph[data-status="error"] {
	color: var(--danger-400);
}

.cluster-spin {
	animation: cluster-spin 0.9s linear infinite;
}

@keyframes cluster-spin {
	to {
		transform: rotate(360deg);
	}
}

.cluster-count {
	font-weight: 600;
	font-size: 12.5px;
	flex: 0 0 auto;
}

.cluster-headline {
	font-family: var(--font-mono);
	font-size: 11px;
	color: var(--fg-tertiary);
	white-space: nowrap;
	overflow: hidden;
	text-overflow: ellipsis;
	min-width: 0;
	flex: 1;
}

.cluster-body {
	display: flex;
	flex-direction: column;
	gap: 6px;
	padding: 6px;
	border-top: 1px solid var(--hair);
	background: var(--surface-inset);
}

.cluster-earlier {
	align-self: flex-start;
	background: none;
	border: none;
	padding: 2px 2px 0;
	font: inherit;
	font-size: 11px;
	color: var(--fg-tertiary);
	cursor: pointer;
}

.cluster-earlier:hover {
	color: var(--accent);
}
</style>
