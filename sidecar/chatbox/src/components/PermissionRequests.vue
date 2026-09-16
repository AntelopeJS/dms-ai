<script setup lang="ts">
import { computed, ref } from "vue";
import {
	PERMISSION_BUTTONS,
	PERMISSION_DECISIONS,
	PERMISSION_INLINE_LABELS,
	PERMISSION_LABELS,
	type PermissionDecision,
} from "../constants/permissions";
import type { PermissionRequestData } from "../types/permission";
import { stringifyValue } from "../utils/format";

interface Props {
	requests: PermissionRequestData[];
}

const props = defineProps<Props>();
const emit = defineEmits<{
	decide: [requestId: string, decision: PermissionDecision];
	decideAll: [decision: PermissionDecision];
}>();

const expanded = ref<Set<string>>(new Set());

const heading = computed<string>(() =>
	props.requests.length > 1
		? PERMISSION_INLINE_LABELS.HEADING_MANY
		: PERMISSION_INLINE_LABELS.HEADING_ONE,
);
const showBulk = computed<boolean>(() => props.requests.length > 1);

// Pretty-print each request's args once per render, keyed by id, so the template
// can both gate on and display it without recomputing per use.
const argsTextById = computed<Record<string, string>>(() => {
	const out: Record<string, string> = {};
	for (const req of props.requests) {
		out[req.requestId] = stringifyValue(req.args);
	}
	return out;
});

function isExpanded(id: string): boolean {
	return expanded.value.has(id);
}

function toggleArgs(id: string): void {
	const next = new Set(expanded.value);
	if (next.has(id)) next.delete(id);
	else next.add(id);
	expanded.value = next;
}

function decide(id: string, decision: PermissionDecision): void {
	emit("decide", id, decision);
}

function allowAll(): void {
	emit("decideAll", PERMISSION_DECISIONS.ALLOW_ONCE);
}

function denyAll(): void {
	emit("decideAll", PERMISSION_DECISIONS.DENY);
}
</script>

<template>
	<section class="perm-tray" role="group" :aria-label="heading">
		<header class="perm-tray-head">
			<span class="perm-tray-title">{{ heading }}</span>
			<div v-if="showBulk" class="perm-bulk">
				<button type="button" class="perm-bulk-btn deny" @click="denyAll">
					{{ PERMISSION_INLINE_LABELS.DENY_ALL }}
				</button>
				<button type="button" class="perm-bulk-btn allow" @click="allowAll">
					{{ PERMISSION_INLINE_LABELS.APPLY_ALL }}
				</button>
			</div>
		</header>

		<article
			v-for="req in requests"
			:key="req.requestId"
			class="perm-card"
		>
			<div class="perm-card-top">
				<span class="perm-icon" aria-hidden="true">
					<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14.7 6.3a4 4 0 0 0-5.6 5.6l-6 6a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l6-6a4 4 0 0 0 5.6-5.6l-2.5 2.5-2-2 2.5-2.5z"/></svg>
				</span>
				<div class="perm-card-text">
					<span class="perm-tool">{{ req.toolName }}</span>
					<span class="perm-summary">{{ req.summary }}</span>
				</div>
			</div>

			<button
				v-if="argsTextById[req.requestId].length > 0"
				type="button"
				class="perm-args-toggle"
				:aria-expanded="isExpanded(req.requestId)"
				@click="toggleArgs(req.requestId)"
			>
				{{
					isExpanded(req.requestId)
						? PERMISSION_LABELS.ARGS_TOGGLE_HIDE
						: PERMISSION_LABELS.ARGS_TOGGLE_SHOW
				}}
			</button>
			<pre v-if="isExpanded(req.requestId)" class="perm-args-pre">{{ argsTextById[req.requestId] }}</pre>

			<footer class="perm-actions">
				<button
					v-for="button in PERMISSION_BUTTONS"
					:key="button.decision"
					type="button"
					class="perm-button"
					:data-variant="button.variant"
					@click="decide(req.requestId, button.decision)"
				>
					{{ button.label }}
				</button>
			</footer>
		</article>
	</section>
</template>

<style scoped>
.perm-tray {
	display: flex;
	flex-direction: column;
	gap: 8px;
	padding: 10px 12px;
	border-top: 1px solid var(--hair-strong);
	background: var(--surface-inset);
	max-height: 46vh;
	overflow-y: auto;
}

.perm-tray-head {
	display: flex;
	align-items: center;
	gap: 10px;
}

.perm-tray-title {
	flex: 1;
	font-size: 11px;
	font-weight: 700;
	letter-spacing: 0.04em;
	text-transform: uppercase;
	color: var(--fg-tertiary);
}

.perm-bulk {
	display: flex;
	gap: 6px;
	flex: 0 0 auto;
}

.perm-bulk-btn {
	padding: 5px 11px;
	border-radius: var(--radius-md);
	border: 1px solid transparent;
	font: inherit;
	font-size: 12px;
	font-weight: 600;
	cursor: pointer;
}

.perm-bulk-btn.allow {
	background: var(--accent);
	color: var(--accent-fg);
}

.perm-bulk-btn.allow:hover {
	background: var(--accent-strong);
}

.perm-bulk-btn.deny {
	background: transparent;
	color: var(--danger-400);
	border-color: color-mix(in srgb, var(--danger-400) 35%, transparent);
}

.perm-bulk-btn.deny:hover {
	background: color-mix(in srgb, var(--danger-400) 18%, transparent);
}

.perm-card {
	display: flex;
	flex-direction: column;
	gap: 8px;
	padding: 11px 12px;
	border: 1px solid var(--hair);
	border-radius: var(--radius-md);
	background: var(--surface-card);
}

.perm-card-top {
	display: flex;
	align-items: center;
	gap: 10px;
}

.perm-icon {
	width: 28px;
	height: 28px;
	flex: 0 0 auto;
	display: grid;
	place-items: center;
	border-radius: 7px;
	background: var(--surface-inset);
	border: 1px solid var(--hair);
	color: var(--fg-secondary);
}

.perm-card-text {
	flex: 1;
	min-width: 0;
	display: flex;
	flex-direction: column;
	gap: 2px;
}

.perm-tool {
	font-family: var(--font-mono);
	font-size: 12.5px;
	font-weight: 600;
	color: var(--accent);
}

.perm-summary {
	font-size: 12.5px;
	line-height: 1.4;
	color: var(--fg-secondary);
	word-break: break-word;
}

.perm-args-toggle {
	align-self: flex-start;
	background: none;
	border: none;
	color: var(--accent);
	font: inherit;
	font-size: 12px;
	padding: 0;
	cursor: pointer;
}

.perm-args-toggle:hover {
	text-decoration: underline;
}

.perm-args-pre {
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
	max-height: 200px;
	overflow: auto;
}

.perm-actions {
	display: flex;
	gap: 8px;
	flex-wrap: wrap;
}

.perm-button {
	padding: 6px 12px;
	border-radius: var(--radius-md);
	border: 1px solid transparent;
	font: inherit;
	font-size: 12px;
	font-weight: 600;
	cursor: pointer;
}

.perm-button[data-variant="primary"] {
	background: var(--accent);
	color: var(--accent-fg);
}

.perm-button[data-variant="primary"]:hover {
	background: var(--accent-strong);
}

.perm-button[data-variant="secondary"] {
	background: var(--surface-inset);
	color: var(--fg);
	border-color: var(--hair);
}

.perm-button[data-variant="secondary"]:hover {
	background: var(--surface-card-2);
}

.perm-button[data-variant="danger"] {
	background: var(--danger-bg);
	color: var(--danger-400);
	border-color: color-mix(in srgb, var(--danger-400) 35%, transparent);
}

.perm-button[data-variant="danger"]:hover {
	background: color-mix(in srgb, var(--danger-400) 20%, transparent);
}
</style>
