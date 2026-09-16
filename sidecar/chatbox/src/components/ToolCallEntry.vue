<script setup lang="ts">
import { computed, ref } from "vue";
import { STATUS_LABELS, TOOL_STATUS } from "../constants/conversation";
import type { ToolCallMessage } from "../types/conversation";
import { stringifyValue } from "../utils/format";
import { toolLabel, toolSummary } from "../utils/tool-summary";

interface Props {
	message: ToolCallMessage;
}

const props = defineProps<Props>();
const isExpanded = ref(false);

const STATUS_BADGE_LABELS: Record<string, string> = {
	[TOOL_STATUS.PENDING]: STATUS_LABELS.PENDING,
	[TOOL_STATUS.SUCCESS]: STATUS_LABELS.SUCCESS,
	[TOOL_STATUS.ERROR]: STATUS_LABELS.ERROR,
};

const statusLabel = computed<string>(
	() => STATUS_BADGE_LABELS[props.message.status] ?? props.message.status,
);

const title = computed<string>(() =>
	props.message.toolName.length > 0
		? toolLabel(props.message.toolName)
		: "Tool",
);
const summary = computed<string>(() =>
	toolSummary(props.message.toolName, props.message.args),
);

const argsText = computed<string>(() => stringifyValue(props.message.args));
const resultText = computed<string>(() => stringifyValue(props.message.result));

function toggle(): void {
	isExpanded.value = !isExpanded.value;
}
</script>

<template>
	<article class="tool-entry" :data-status="message.status">
		<button
			type="button"
			class="tool-header"
			:aria-expanded="isExpanded"
			@click="toggle"
		>
			<span class="tool-icon" aria-hidden="true">
				<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14.7 6.3a4 4 0 0 0-5.6 5.6l-6 6a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l6-6a4 4 0 0 0 5.6-5.6l-2.5 2.5-2-2 2.5-2.5z"/></svg>
			</span>
			<span class="tool-text">
				<span class="tool-name">{{ title }}</span>
				<span v-if="summary.length > 0" class="tool-summary">{{ summary }}</span>
			</span>
			<span class="tool-status" :data-status="message.status">{{ statusLabel }}</span>
			<span class="tool-toggle">{{ isExpanded ? "▾" : "▸" }}</span>
		</button>
		<div v-if="isExpanded" class="tool-body">
			<section v-if="argsText.length > 0" class="tool-section">
				<h4 class="tool-section-title">args</h4>
				<pre class="tool-pre">{{ argsText }}</pre>
			</section>
			<section v-if="resultText.length > 0" class="tool-section">
				<h4 class="tool-section-title">result</h4>
				<pre class="tool-pre">{{ resultText }}</pre>
			</section>
		</div>
	</article>
</template>

<style scoped>
.tool-entry {
	border: 1px solid var(--hair);
	border-radius: var(--radius-md);
	background: var(--surface-card);
	overflow: hidden;
}

.tool-header {
	display: flex;
	align-items: center;
	gap: 9px;
	width: 100%;
	padding: 8px 10px;
	background: transparent;
	border: none;
	cursor: pointer;
	font: inherit;
	text-align: left;
	color: var(--fg);
}

.tool-header:hover {
	background: var(--surface-card-2);
}

.tool-icon {
	width: 24px;
	height: 24px;
	flex: 0 0 auto;
	display: grid;
	place-items: center;
	border-radius: 6px;
	background: var(--surface-inset);
	border: 1px solid var(--hair);
	color: var(--fg-secondary);
}

.tool-text {
	flex: 1;
	min-width: 0;
	display: flex;
	align-items: baseline;
	gap: 8px;
}

.tool-name {
	font-weight: 600;
	font-size: 12.5px;
	flex: 0 0 auto;
}

.tool-summary {
	font-family: var(--font-mono);
	font-size: 11px;
	color: var(--fg-tertiary);
	white-space: nowrap;
	overflow: hidden;
	text-overflow: ellipsis;
	min-width: 0;
}

.tool-status {
	font-family: var(--font-mono);
	font-size: 9px;
	font-weight: 700;
	letter-spacing: 0.04em;
	text-transform: uppercase;
	padding: 2px 6px;
	border-radius: var(--radius-sm);
	background: var(--surface-inset);
	color: var(--fg-tertiary);
	flex: 0 0 auto;
}

.tool-status[data-status="pending"] {
	background: var(--warning-bg);
	color: var(--warning-400);
}

.tool-status[data-status="success"] {
	background: var(--success-bg);
	color: var(--success-400);
}

.tool-status[data-status="error"] {
	background: var(--danger-bg);
	color: var(--danger-400);
}

.tool-toggle {
	color: var(--fg-tertiary);
	font-size: 11px;
	flex: 0 0 auto;
}

.tool-body {
	padding: 10px 12px;
	border-top: 1px solid var(--hair);
}

.tool-section + .tool-section {
	margin-top: 8px;
}

.tool-section-title {
	margin: 0 0 4px;
	font-family: var(--font-mono);
	font-size: 10px;
	text-transform: uppercase;
	letter-spacing: 0.04em;
	color: var(--fg-tertiary);
}

.tool-pre {
	margin: 0;
	padding: 8px;
	background: var(--surface-inset);
	border: 1px solid var(--hair);
	border-radius: var(--radius-sm);
	font-family: var(--font-mono);
	font-size: 11px;
	color: var(--fg-secondary);
	white-space: pre-wrap;
	word-break: break-word;
	max-height: 300px;
	overflow: auto;
}
</style>
