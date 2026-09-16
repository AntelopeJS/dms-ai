<script setup lang="ts">
import {
	CLOSE_DRAWER_LABEL,
	DAYS_BEFORE_DATE,
	DELETE_BUTTON_GLYPH,
	DELETE_BUTTON_LABEL,
	DRAWER_TITLE,
	EMPTY_LIST_LABEL,
	HOURS_PER_DAY,
	MINUTES_PER_HOUR,
	NEW_CONVERSATION_LABEL,
	RELATIVE_TIME_NOW,
	SECONDS_PER_MINUTE,
} from "../constants/conversation-drawer";
import type { ConversationSummary } from "../types/conversation";

interface Props {
	open: boolean;
	conversations: ConversationSummary[];
	activeId: string;
	nowMs: number;
}

const props = defineProps<Props>();
const emit = defineEmits<{
	select: [id: string];
	delete: [id: string];
	new: [];
	close: [];
}>();

const MS_PER_SECOND = 1000;
const SECONDS_PER_HOUR = SECONDS_PER_MINUTE * MINUTES_PER_HOUR;
const SECONDS_PER_DAY = SECONDS_PER_HOUR * HOURS_PER_DAY;

function formatRelativeTime(timestampMs: number): string {
	const deltaSeconds = Math.max(
		0,
		Math.floor((props.nowMs - timestampMs) / MS_PER_SECOND),
	);
	if (deltaSeconds < SECONDS_PER_MINUTE) return RELATIVE_TIME_NOW;
	if (deltaSeconds < SECONDS_PER_HOUR) {
		return `${Math.floor(deltaSeconds / SECONDS_PER_MINUTE)}m ago`;
	}
	if (deltaSeconds < SECONDS_PER_DAY) {
		return `${Math.floor(deltaSeconds / SECONDS_PER_HOUR)}h ago`;
	}
	if (deltaSeconds < SECONDS_PER_DAY * DAYS_BEFORE_DATE) {
		return `${Math.floor(deltaSeconds / SECONDS_PER_DAY)}d ago`;
	}
	return new Date(timestampMs).toLocaleDateString();
}

function onSelect(id: string): void {
	emit("select", id);
}

function onDelete(id: string): void {
	emit("delete", id);
}

function onNew(): void {
	emit("new");
}

function onClose(): void {
	emit("close");
}
</script>

<template>
	<div v-if="props.open" class="drawer-root">
		<div class="drawer-backdrop" @click="onClose" />
		<aside class="drawer-panel" aria-label="Conversations">
			<header class="drawer-header">
				<span class="drawer-title">{{ DRAWER_TITLE }}</span>
				<button type="button" class="drawer-new" @click="onNew">
					{{ NEW_CONVERSATION_LABEL }}
				</button>
				<button
					type="button"
					class="drawer-close"
					:aria-label="CLOSE_DRAWER_LABEL"
					@click="onClose"
				>
					×
				</button>
			</header>

			<ul v-if="props.conversations.length > 0" class="drawer-list">
				<li
					v-for="item in props.conversations"
					:key="item.id"
					class="drawer-item"
					:data-active="item.id === props.activeId"
				>
					<button
						type="button"
						class="drawer-item-main"
						@click="onSelect(item.id)"
					>
						<span class="drawer-item-title">{{ item.title }}</span>
						<span class="drawer-item-time">
							{{ formatRelativeTime(item.updatedAtMs) }}
						</span>
					</button>
					<button
						type="button"
						class="drawer-item-delete"
						:aria-label="DELETE_BUTTON_LABEL"
						:title="DELETE_BUTTON_LABEL"
						@click="onDelete(item.id)"
					>
						{{ DELETE_BUTTON_GLYPH }}
					</button>
				</li>
			</ul>
			<p v-else class="drawer-empty">{{ EMPTY_LIST_LABEL }}</p>
		</aside>
	</div>
</template>

<style scoped>
.drawer-root {
	position: absolute;
	inset: 0;
	z-index: 20;
}

.drawer-backdrop {
	position: absolute;
	inset: 0;
	background: rgba(0, 0, 0, 0.35);
}

.drawer-panel {
	position: absolute;
	top: 0;
	left: 0;
	bottom: 0;
	width: 80%;
	max-width: 320px;
	display: flex;
	flex-direction: column;
	background: var(--surface-card);
	border-right: 1px solid var(--hair-strong);
	box-shadow: 12px 0 40px rgba(0, 0, 0, 0.5);
}

.drawer-header {
	display: flex;
	align-items: center;
	gap: 8px;
	padding: 12px 14px;
	border-bottom: 1px solid var(--hair);
	color: var(--fg);
}

.drawer-title {
	flex: 1;
	font-weight: 600;
}

.drawer-new {
	background: var(--accent);
	border: none;
	color: var(--accent-fg);
	border-radius: var(--radius-md);
	padding: 3px 9px;
	font: inherit;
	font-size: 11px;
	font-weight: 600;
	cursor: pointer;
}

.drawer-new:hover {
	background: var(--accent-strong);
}

.drawer-close {
	background: transparent;
	border: none;
	color: var(--fg-tertiary);
	font-size: 18px;
	line-height: 1;
	cursor: pointer;
	padding: 0 4px;
}

.drawer-close:hover {
	color: var(--fg);
}

.drawer-list {
	flex: 1;
	overflow-y: auto;
	list-style: none;
	margin: 0;
	padding: 0;
}

.drawer-item {
	display: flex;
	align-items: stretch;
	border-bottom: 1px solid var(--hair);
}

.drawer-item[data-active="true"] {
	background: var(--accent-bg);
}

.drawer-item-main {
	flex: 1;
	display: flex;
	flex-direction: column;
	align-items: flex-start;
	gap: 2px;
	background: transparent;
	border: none;
	padding: 9px 14px;
	font: inherit;
	text-align: left;
	cursor: pointer;
	min-width: 0;
}

.drawer-item-main:hover {
	background: var(--surface-card-2);
}

.drawer-item-title {
	font-weight: 500;
	color: var(--fg);
	white-space: nowrap;
	overflow: hidden;
	text-overflow: ellipsis;
	max-width: 100%;
}

.drawer-item-time {
	font-family: var(--font-mono);
	font-size: 10px;
	color: var(--fg-tertiary);
}

.drawer-item-delete {
	background: transparent;
	border: none;
	color: var(--fg-tertiary);
	padding: 0 12px;
	font-size: 13px;
	cursor: pointer;
}

.drawer-item-delete:hover {
	color: var(--danger-400);
}

.drawer-empty {
	padding: 16px 14px;
	color: var(--fg-tertiary);
	font-size: 12px;
}
</style>
