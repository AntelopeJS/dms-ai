<script setup lang="ts">
import { computed, nextTick, onMounted, ref, watch } from "vue";
import ComposerInput from "./components/ComposerInput.vue";
import ConnectionBanner from "./components/ConnectionBanner.vue";
import ConversationDrawer from "./components/ConversationDrawer.vue";
import MessageList from "./components/MessageList.vue";
import PermissionRequests from "./components/PermissionRequests.vue";
import QuestionPrompt from "./components/QuestionPrompt.vue";
import QueuedMessages from "./components/QueuedMessages.vue";
import TodoList from "./components/TodoList.vue";
import { useConversation } from "./composables/useConversation";
import { useConversationList } from "./composables/useConversationList";
import { useHostTheme } from "./composables/useHostTheme";
import {
	newConversationId,
	persistConversationId,
	resolveConversationId,
} from "./composables/useConversationId";
import { usePermissionQueue } from "./composables/usePermissionQueue";
import { useQuestionQueue } from "./composables/useQuestionQueue";
import { useSettings } from "./composables/useSettings";
import { useWs } from "./composables/useWs";
import {
	TOGGLE_DRAWER_ICON,
	TOGGLE_DRAWER_LABEL,
} from "./constants/conversation-drawer";
import {
	CLOSE_PANEL_ICON,
	MODE_HINTS,
	MODE_OPTIONS,
	MODE_SECTION_LABEL,
	OPEN_SETTINGS_ICON,
	OPEN_SETTINGS_LABEL,
} from "./constants/settings";
import {
	CLIENT_MESSAGE_TYPES,
	type ConnectionStatus,
	SERVER_EVENT_TYPES,
	SETTINGS_PAGE_PATH,
	WS_IFRAME_PATH,
} from "./constants/ws";
import type { ChatboxMode } from "./types/settings";
import type { PendingAttachment } from "./utils/attachments";
import { latestTodos } from "./utils/todos";

const STATUS_LABEL_BY_STATE: Record<ConnectionStatus, string> = {
	connecting: "connecting…",
	connected: "connected",
	reconnecting: "reconnecting…",
	disconnected: "disconnected",
};

useHostTheme();

const activeId = ref(resolveConversationId());
const ws = useWs({
	path: WS_IFRAME_PATH,
	getConversationId: () => activeId.value,
});
const permissionQueue = usePermissionQueue({ send: ws.send });
const questionQueue = useQuestionQueue({ send: ws.send });
const conversation = useConversation({
	activeId,
	send: ws.send,
	onMessage: ws.onMessage,
	onPermissionRequest: permissionQueue.enqueue,
	onQuestionRequest: questionQueue.enqueue,
});
const conversationList = useConversationList({
	send: ws.send,
	onMessage: ws.onMessage,
});
const settings = useSettings({ send: ws.send, onMessage: ws.onMessage });

const drawerOpen = ref(false);
const nowMs = ref(Date.now());

// The cogwheel opens the full AI Settings admin page in the host DMS rather
// than an in-iframe modal. We bridge a navigate request through the sidecar to
// the host (see REQUEST_HOST_NAVIGATE).
function openSettingsPage(): void {
	ws.send({
		type: CLIENT_MESSAGE_TYPES.REQUEST_HOST_NAVIGATE,
		path: SETTINGS_PAGE_PATH,
	});
}

const modeModel = computed<ChatboxMode>({
	get: () => settings.settings.value.mode,
	set: (value) => {
		if (value !== settings.settings.value.mode) settings.update({ mode: value });
	},
});

// Close asks the host overlay (parent window) to slide the panel away. The
// header robot launcher / Ctrl+Shift+K shortcut bring it back.
function dismissPanel(): void {
	globalThis.parent?.postMessage({ type: "dms-ai:close" }, "*");
}

function refreshList(): void {
	nowMs.value = Date.now();
	conversationList.refresh();
}

function openDrawer(): void {
	refreshList();
	drawerOpen.value = true;
}

function closeDrawer(): void {
	drawerOpen.value = false;
}

function switchConversation(id: string): void {
	closeDrawer();
	if (id === activeId.value) return;
	activeId.value = id;
	persistConversationId(id);
	conversation.reset();
	permissionQueue.clear();
	questionQueue.clear();
	ws.reidentify();
}

function newConversation(): void {
	switchConversation(newConversationId());
}

function deleteConversation(id: string): void {
	const wasActive = id === activeId.value;
	conversationList.remove(id);
	if (wasActive) newConversation();
}

// Refresh the list once a turn completes so new conversations and updated
// titles surface in the drawer.
ws.onMessage((msg: unknown): void => {
	if (
		typeof msg === "object" &&
		msg !== null &&
		(msg as { type?: unknown }).type === SERVER_EVENT_TYPES.RUN_DONE &&
		drawerOpen.value
	) {
		refreshList();
	}
});

const statusLabel = computed<string>(
	() => STATUS_LABEL_BY_STATE[ws.connectionStatus.value],
);

const todos = computed(() => latestTodos(conversation.messages.value));

const SCROLL_STICKY_THRESHOLD_PX = 80;
const scrollContainer = ref<HTMLElement | null>(null);

function isNearBottom(el: HTMLElement): boolean {
	const distance = el.scrollHeight - el.scrollTop - el.clientHeight;
	return distance <= SCROLL_STICKY_THRESHOLD_PX;
}

function scrollToBottom(): void {
	const el = scrollContainer.value;
	if (el === null) return;
	el.scrollTop = el.scrollHeight;
}

watch(
	() => [conversation.messages.value, conversation.isRunning.value],
	() => {
		const el = scrollContainer.value;
		const sticky = el === null || isNearBottom(el);
		if (!sticky) return;
		void nextTick(scrollToBottom);
	},
);

onMounted(() => {
	void nextTick(scrollToBottom);
});

function onComposerSubmit(
	content: string,
	attachments: PendingAttachment[],
): void {
	conversation.sendUserMessage(content, attachments);
}

// Stop interrupts the live turn server-side; clear the local permission tray so
// any cards the run was paused on don't linger (the sidecar denies them too).
function onComposerStop(): void {
	conversation.interrupt();
	permissionQueue.clear();
	questionQueue.clear();
}

function manualReconnect(): void {
	ws.reconnect();
}
</script>

<template>
	<main class="chatbox">
		<header class="chatbox-header">
			<span class="chatbox-logo" aria-hidden="true">✦</span>
			<div class="chatbox-titlewrap">
				<b class="chatbox-title">AntelopeJS Assistant</b>
				<span
					class="chatbox-status"
					:data-connected="ws.isConnected.value"
					aria-live="polite"
				>
					<i class="chatbox-status-dot" />{{ statusLabel }}
				</span>
			</div>
			<button
				type="button"
				class="chatbox-ibtn"
				:aria-label="TOGGLE_DRAWER_LABEL"
				:title="TOGGLE_DRAWER_LABEL"
				@click="openDrawer"
			>
				<UIcon :name="TOGGLE_DRAWER_ICON" class="size-[18px]" />
			</button>
			<button
				type="button"
				class="chatbox-ibtn"
				:aria-label="OPEN_SETTINGS_LABEL"
				:title="OPEN_SETTINGS_LABEL"
				@click="openSettingsPage"
			>
				<UIcon :name="OPEN_SETTINGS_ICON" class="size-[18px]" />
			</button>
			<button
				type="button"
				class="chatbox-ibtn"
				aria-label="Close"
				title="Close"
				@click="dismissPanel"
			>
				<UIcon :name="CLOSE_PANEL_ICON" class="size-[18px]" />
			</button>
		</header>

		<div class="chatbox-modebar">
			<span class="modebar-label">{{ MODE_SECTION_LABEL }}</span>
			<USelect
				v-model="modeModel"
				:items="MODE_OPTIONS"
				variant="ghost"
				size="sm"
				:title="MODE_HINTS[settings.settings.value.mode]"
				class="font-semibold text-primary"
			/>
		</div>

		<ConnectionBanner
			:status="ws.connectionStatus.value"
			@reconnect="manualReconnect"
		/>

		<section ref="scrollContainer" class="chatbox-body">
			<MessageList
				:messages="conversation.messages.value"
				:is-running="conversation.isRunning.value"
			/>
		</section>

		<PermissionRequests
			v-if="permissionQueue.queue.value.length > 0"
			:requests="permissionQueue.queue.value"
			@decide="permissionQueue.respond"
			@decide-all="permissionQueue.respondAll"
		/>

		<QuestionPrompt
			v-if="questionQueue.queue.value.length > 0"
			:requests="questionQueue.queue.value"
			@answer="questionQueue.respond"
		/>

		<TodoList v-if="todos.length > 0" :todos="todos" />

		<QueuedMessages
			v-if="conversation.queued.value.length > 0"
			:queue="conversation.queued.value"
			@cancel="conversation.cancelQueued"
		/>

		<ComposerInput
			:is-disabled="!ws.isConnected.value"
			:is-running="conversation.isRunning.value"
			:generation-mode="settings.settings.value.generationMode"
			:builder-available="settings.settings.value.builderAvailable"
			@submit="onComposerSubmit"
			@stop="onComposerStop"
			@update:generation-mode="(m) => settings.update({ generationMode: m })"
		/>

		<ConversationDrawer
			:open="drawerOpen"
			:conversations="conversationList.conversations.value"
			:active-id="activeId"
			:now-ms="nowMs"
			@select="switchConversation"
			@delete="deleteConversation"
			@new="newConversation"
			@close="closeDrawer"
		/>
	</main>
</template>

<style scoped>
.chatbox {
	position: relative;
	display: flex;
	flex-direction: column;
	height: 100vh;
	font-family: var(--font-body);
	font-size: 13px;
	background: var(--surface-side);
	color: var(--fg);
}

.chatbox-header {
	display: flex;
	align-items: center;
	gap: 11px;
	padding: 14px 14px 12px;
	border-bottom: 1px solid var(--hair);
}

.chatbox-logo {
	width: 34px;
	height: 34px;
	flex: 0 0 auto;
	display: grid;
	place-items: center;
	border-radius: var(--radius-md);
	background: var(--accent-bg);
	border: 1px solid var(--accent-bg-strong);
	color: var(--accent);
	font-size: 17px;
}

.chatbox-titlewrap {
	flex: 1;
	min-width: 0;
}

.chatbox-title {
	display: block;
	font-size: 15px;
	font-weight: 600;
	color: var(--fg);
}

.chatbox-status {
	display: flex;
	align-items: center;
	gap: 6px;
	font-size: 11.5px;
	margin-top: 2px;
	color: var(--fg-tertiary);
}

.chatbox-status-dot {
	width: 6px;
	height: 6px;
	border-radius: 50%;
	background: var(--fg-tertiary);
}

.chatbox-status[data-connected="true"] {
	color: var(--success-400);
}

.chatbox-status[data-connected="true"] .chatbox-status-dot {
	background: var(--success-500);
}

.chatbox-status[data-connected="false"] {
	color: var(--danger-400);
}

.chatbox-status[data-connected="false"] .chatbox-status-dot {
	background: var(--danger-400);
}

.chatbox-ibtn {
	width: 30px;
	height: 30px;
	flex: 0 0 auto;
	display: grid;
	place-items: center;
	border: none;
	background: transparent;
	border-radius: 7px;
	color: var(--fg-tertiary);
	line-height: 1;
	cursor: pointer;
}

.chatbox-ibtn:hover {
	background: var(--surface-inset);
	color: var(--fg);
}

.chatbox-modebar {
	display: flex;
	align-items: center;
	gap: 8px;
	padding: 9px 14px;
	background: var(--surface-inset);
	border-bottom: 1px solid var(--hair);
}

.modebar-label {
	font-size: 11.5px;
	color: var(--fg-tertiary);
}

.chatbox-body {
	flex: 1;
	min-height: 0;
	overflow-y: auto;
}
</style>
