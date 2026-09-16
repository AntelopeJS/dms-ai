<script setup lang="ts">
import { computed, nextTick, onMounted, ref, watch } from "vue";
import { TODO_PANEL_TITLE, TODO_STATUS } from "../constants/conversation";
import type { TodoItem } from "../utils/todos";

interface Props {
	todos: TodoItem[];
}

const props = defineProps<Props>();

const TODO_ITEM_GAP_PX = 2;

const expanded = ref(true);
const itemsEl = ref<HTMLElement | null>(null);

const activeIndex = computed<number>(() =>
	props.todos.findIndex((t) => t.status === TODO_STATUS.IN_PROGRESS),
);

async function scrollActiveIntoView(): Promise<void> {
	if (!expanded.value || activeIndex.value < 0) return;
	await nextTick();
	const el = itemsEl.value;
	if (el === null) return;
	const child = el.children[activeIndex.value];
	if (child === undefined) return;
	const list = el.getBoundingClientRect();
	const item = child.getBoundingClientRect();
	const margin = item.height + TODO_ITEM_GAP_PX;
	if (item.top < list.top + margin) {
		el.scrollTop += item.top - list.top - margin;
	} else if (item.bottom > list.bottom - margin) {
		el.scrollTop += item.bottom - list.bottom + margin;
	}
}

watch(
	() => [props.todos, expanded.value],
	() => {
		void scrollActiveIntoView();
	},
);

onMounted(() => {
	void scrollActiveIntoView();
});

const completedCount = computed<number>(
	() => props.todos.filter((t) => t.status === TODO_STATUS.COMPLETED).length,
);

const allDone = computed<boolean>(
	() => props.todos.length > 0 && completedCount.value === props.todos.length,
);

const progressPercent = computed<number>(() => {
	if (props.todos.length === 0) return 0;
	return Math.round((completedCount.value / props.todos.length) * 100);
});

const activeLabel = computed<string>(() => {
	const active = props.todos.find((t) => t.status === TODO_STATUS.IN_PROGRESS);
	if (active !== undefined) return active.activeForm;
	if (allDone.value) return "";
	const next = props.todos.find((t) => t.status === TODO_STATUS.PENDING);
	return next?.content ?? "";
});

function toggle(): void {
	expanded.value = !expanded.value;
}

function todoText(todo: TodoItem): string {
	return todo.status === TODO_STATUS.IN_PROGRESS ? todo.activeForm : todo.content;
}
</script>

<template>
	<section class="todo-dock" :data-complete="allDone">
		<button
			type="button"
			class="todo-head"
			:aria-expanded="expanded"
			@click="toggle"
		>
			<span class="todo-toggle">{{ expanded ? "▾" : "▸" }}</span>
			<span class="todo-title">{{ TODO_PANEL_TITLE }}</span>
			<span
				v-if="!expanded && activeLabel.length > 0"
				class="todo-active"
			>{{ activeLabel }}</span>
			<span class="todo-count">{{ completedCount }}/{{ todos.length }}</span>
		</button>
		<div class="todo-track" aria-hidden="true">
			<div class="todo-fill" :style="{ width: `${progressPercent}%` }"></div>
		</div>
		<ul v-if="expanded" ref="itemsEl" class="todo-items">
			<li
				v-for="(todo, i) in todos"
				:key="i"
				class="todo-item"
				:data-status="todo.status"
			>
				<span class="todo-glyph" :data-status="todo.status" aria-hidden="true">
					<svg v-if="todo.status === 'completed'" viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg>
					<svg v-else-if="todo.status === 'in_progress'" class="todo-spin" viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><path d="M21 12a9 9 0 1 1-6.2-8.6"/></svg>
					<svg v-else viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="8"/></svg>
				</span>
				<span class="todo-text">{{ todoText(todo) }}</span>
			</li>
		</ul>
	</section>
</template>

<style scoped>
.todo-dock {
	flex: 0 0 auto;
	background: var(--surface-side);
	border-top: 1px solid var(--hair);
}

.todo-head {
	display: flex;
	align-items: center;
	gap: 8px;
	width: 100%;
	padding: 8px 14px;
	background: transparent;
	border: none;
	cursor: pointer;
	font: inherit;
	text-align: left;
	color: var(--fg);
}

.todo-head:hover {
	background: var(--surface-inset);
}

.todo-toggle {
	color: var(--fg-tertiary);
	font-size: 11px;
	flex: 0 0 auto;
}

.todo-title {
	font-weight: 600;
	font-size: 12.5px;
	flex: 0 0 auto;
}

.todo-active {
	flex: 1;
	min-width: 0;
	font-size: 11.5px;
	color: var(--fg-tertiary);
	white-space: nowrap;
	overflow: hidden;
	text-overflow: ellipsis;
}

.todo-count {
	margin-left: auto;
	font-family: var(--font-mono);
	font-size: 10px;
	font-weight: 700;
	letter-spacing: 0.04em;
	color: var(--fg-tertiary);
	flex: 0 0 auto;
}

.todo-dock[data-complete="true"] .todo-count {
	color: var(--success-400);
}

.todo-track {
	height: 2px;
	background: var(--surface-inset);
}

.todo-fill {
	height: 100%;
	background: var(--accent);
	transition: width 0.25s ease;
}

.todo-dock[data-complete="true"] .todo-fill {
	background: var(--success-400);
}

.todo-items {
	list-style: none;
	margin: 0;
	padding: 6px 8px 8px;
	display: flex;
	flex-direction: column;
	gap: 2px;
	max-height: 150px;
	overflow-y: auto;
}

.todo-item {
	display: flex;
	align-items: flex-start;
	gap: 8px;
	padding: 3px 4px;
	font-size: 12.5px;
	line-height: 1.45;
}

.todo-glyph {
	width: 16px;
	height: 16px;
	flex: 0 0 auto;
	display: grid;
	place-items: center;
	margin-top: 1px;
	color: var(--fg-tertiary);
}

.todo-glyph[data-status="completed"] {
	color: var(--success-400);
}

.todo-glyph[data-status="in_progress"] {
	color: var(--accent);
}

.todo-spin {
	animation: todo-spin 0.9s linear infinite;
}

@keyframes todo-spin {
	to {
		transform: rotate(360deg);
	}
}

.todo-text {
	min-width: 0;
	word-break: break-word;
	color: var(--fg-secondary);
}

.todo-item[data-status="completed"] .todo-text {
	color: var(--fg-tertiary);
	text-decoration: line-through;
}

.todo-item[data-status="in_progress"] .todo-text {
	color: var(--fg);
	font-weight: 500;
}
</style>
