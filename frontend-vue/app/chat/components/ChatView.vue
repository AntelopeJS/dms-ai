<script setup lang="ts">
import { computed, nextTick, onMounted, ref, watch } from "vue";
import type { ChatTransport } from "../../runtime/chat-transport";
import { useChatChannel } from "../composables/useChatChannel";
import { useConversation } from "../composables/useConversation";
import {
	newConversationId,
	persistConversationId,
	resolveConversationId,
} from "../composables/useConversationId";
import { useConversationList } from "../composables/useConversationList";
import { usePermissionQueue } from "../composables/usePermissionQueue";
import { useQuestionQueue } from "../composables/useQuestionQueue";
import { useRunClock } from "../composables/useRunClock";
import { useSettings } from "../composables/useSettings";
import { TOGGLE_DRAWER_LABEL } from "../constants/conversation-drawer";
import {
	type ConnectionStatus,
	SERVER_EVENT_TYPES,
	SETTINGS_PAGE_PATH,
} from "../constants/protocol";
import {
	MODE_HINTS,
	MODE_OPTIONS,
	MODE_SECTION_LABEL,
	OPEN_SETTINGS_LABEL,
	PROVIDER_BUSY_HINT,
	PROVIDER_OPTIONS,
	PROVIDER_SECTION_LABEL,
	PROVIDER_SWITCH_CONFIRM,
	PROVIDER_SWITCH_WARNING,
	PROVIDER_UNAVAILABLE_PREFIX,
	SAFE_MODE_MODE_NOTE,
} from "../constants/settings";
import type { ChatboxMode, ProviderName } from "../types/settings";
import type { PendingAttachment } from "../utils/attachments";
import { isRunStalled } from "../utils/run-status";
import { latestTodos } from "../utils/todos";
import ComposerInput from "./ComposerInput.vue";
import ConnectionBanner from "./ConnectionBanner.vue";
import ConversationDrawer from "./ConversationDrawer.vue";
import MessageList from "./MessageList.vue";
import PermissionRequests from "./PermissionRequests.vue";
import QuestionPrompt from "./QuestionPrompt.vue";
import QueuedMessages from "./QueuedMessages.vue";
import TodoList from "./TodoList.vue";

interface Props {
	/** The chat's side of the tab's stream, which the dashboard owns. */
	transport: ChatTransport;
}

const props = defineProps<Props>();
const emit = defineEmits<{ close: []; navigate: [path: string] }>();

/**
 * Phosphor icons, the host DMS icon set, named in this file so the renderer's
 * icon scan bundles them. The assistant's icon is the header launcher's too.
 */
const ASSISTANT_ICON = "i-ph-robot";
const TOGGLE_DRAWER_ICON = "i-ph-list-light";
const OPEN_SETTINGS_ICON = "i-ph-gear-six-light";
const CLOSE_PANEL_ICON = "i-ph-x-light";

/** The menus of the mode bar are as wide as their longest option, not their trigger. */
const MODE_BAR_SELECT_UI = { content: "min-w-fit" };

function isObject(value: unknown): value is Record<string, unknown> {
	return value !== null && typeof value === "object";
}

const STATUS_LABEL_BY_STATE: Record<ConnectionStatus, string> = {
	connecting: "connecting…",
	connected: "connected",
	reconnecting: "reconnecting…",
	disconnected: "disconnected",
};

const activeId = ref(resolveConversationId());
const channel = useChatChannel({
	transport: props.transport,
	getConversationId: () => activeId.value,
});
const permissionQueue = usePermissionQueue({ send: channel.send });
const questionQueue = useQuestionQueue({ send: channel.send });
const conversation = useConversation({
	activeId,
	send: channel.send,
	onMessage: channel.onMessage,
	onPermissionRequest: permissionQueue.enqueue,
	onQuestionRequest: questionQueue.enqueue,
});
const conversationList = useConversationList({
	send: channel.send,
	onMessage: channel.onMessage,
});
const settings = useSettings({ send: channel.send, onMessage: channel.onMessage });

const drawerOpen = ref(false);
const nowMs = ref(Date.now());
const runClockMs = useRunClock(conversation.isRunning);

const isRunStalledNow = computed<boolean>(
	() =>
		conversation.isTurnInFlight.value &&
		channel.isConnected.value &&
		isRunStalled(conversation.lastEventAtMs.value, runClockMs.value),
);

const stalledForMs = computed<number>(
	() => runClockMs.value - conversation.lastEventAtMs.value,
);

/** The cogwheel opens the AI settings page of the dashboard. */
function openSettingsPage(): void {
	emit("navigate", SETTINGS_PAGE_PATH);
}

const modeHint = computed(() => {
	const { mode, generationMode, builderAvailable } = settings.settings.value;
	const isSafeModeActive = generationMode === "safe" && builderAvailable;
	return isSafeModeActive
		? `${MODE_HINTS[mode]}. ${SAFE_MODE_MODE_NOTE}`
		: MODE_HINTS[mode];
});

const modeModel = computed<ChatboxMode>({
	get: () => settings.settings.value.mode,
	set: (value) => {
		if (value !== settings.settings.value.mode) settings.update({ mode: value });
	},
});

/**
 * A provider the sidecar cannot drive stays listed but disabled, with the
 * reason on the option: a silently missing choice is harder to act on.
 */
const providerItems = computed(() =>
	PROVIDER_OPTIONS.map((option) => ({
		...option,
		disabled: !isProviderAvailable(option.value) || conversation.isRunning.value,
	})),
);

function isProviderAvailable(name: ProviderName): boolean {
	return settings.settings.value.providers[name]?.available !== false;
}

const providerHint = computed(() => {
	const active = settings.settings.value.provider;
	const reason = settings.settings.value.providers[active]?.reason;
	if (reason !== undefined) return `${PROVIDER_UNAVAILABLE_PREFIX}${reason}`;
	if (conversation.isRunning.value) return PROVIDER_BUSY_HINT;
	return PROVIDER_SWITCH_WARNING;
});

/**
 * The switch is confirmed rather than merely announced once a conversation has
 * something to lose: the session it tears down is the one on screen.
 */
function mayLeaveCurrentSession(): boolean {
	if (conversation.messages.value.length === 0) return true;
	return window.confirm(PROVIDER_SWITCH_CONFIRM);
}

const providerModel = computed<ProviderName>({
	get: () => settings.settings.value.provider,
	set: (value) => {
		if (value === settings.settings.value.provider) return;
		if (!isProviderAvailable(value)) return;
		if (conversation.isRunning.value) return;
		if (!mayLeaveCurrentSession()) return;
		settings.update({ provider: value });
	},
});

/** The header launcher and Ctrl+Shift+K bring the panel back. */
function dismissPanel(): void {
	emit("close");
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
	channel.reidentify();
}

function newConversation(): void {
	switchConversation(newConversationId());
}

function deleteConversation(id: string): void {
	const wasActive = id === activeId.value;
	conversationList.remove(id);
	if (wasActive) newConversation();
}

/**
 * Refreshes the open drawer once a turn completes, so new conversations and
 * updated titles surface in it.
 */
function refreshListAfterTurn(msg: unknown): void {
	if (!drawerOpen.value) return;
	if (!isObject(msg) || msg.type !== SERVER_EVENT_TYPES.RUN_DONE) return;
	refreshList();
}

channel.onMessage(refreshListAfterTurn);

const statusLabel = computed<string>(
	() => STATUS_LABEL_BY_STATE[channel.connectionStatus.value],
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

/**
 * Stop interrupts the live turn server-side and clears the local trays, so no
 * card the run was paused on lingers: the sidecar denies them too.
 */
function onComposerStop(): void {
	conversation.interrupt();
	permissionQueue.clear();
	questionQueue.clear();
}

function manualReconnect(): void {
	channel.reconnect();
}

function retryLastMessage(): void {
	conversation.retry();
}
</script>

<template>
	<main class="chatbox">
		<header class="chatbox-header">
			<span class="chatbox-logo" aria-hidden="true">
				<UIcon :name="ASSISTANT_ICON" class="size-[19px]" />
			</span>
			<div class="chatbox-titlewrap">
				<b class="chatbox-title">AntelopeJS Assistant</b>
				<span
					class="chatbox-status"
					:data-connected="channel.isConnected.value"
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
				:portal="false"
				:ui="MODE_BAR_SELECT_UI"
				variant="ghost"
				size="sm"
				:title="modeHint"
				class="font-semibold text-primary"
			/>
			<span class="modebar-label">{{ PROVIDER_SECTION_LABEL }}</span>
			<USelect
				v-model="providerModel"
				:items="providerItems"
				:portal="false"
				:ui="MODE_BAR_SELECT_UI"
				variant="ghost"
				size="sm"
				:title="providerHint"
				class="font-semibold text-primary"
			/>
		</div>

		<ConnectionBanner
			:status="channel.connectionStatus.value"
			@reconnect="manualReconnect"
		/>

		<section ref="scrollContainer" class="chatbox-body">
			<MessageList
				:messages="conversation.messages.value"
				:is-running="conversation.isRunning.value"
				:progress="conversation.progress.value"
				:now-ms="runClockMs"
				:is-stalled="isRunStalledNow"
				:stalled-for-ms="stalledForMs"
				@retry="retryLastMessage"
				@reconnect="manualReconnect"
				@stop="onComposerStop"
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

		<TodoList
			v-if="todos.length > 0"
			:todos="todos"
			:is-running="conversation.isRunning.value"
		/>

		<QueuedMessages
			v-if="conversation.queued.value.length > 0"
			:queue="conversation.queued.value"
			@cancel="conversation.cancelQueued"
		/>

		<ComposerInput
			:is-disabled="!channel.isConnected.value"
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
/*
 * The chat's design tokens, aliases of the dashboard's Nuxt UI tokens scoped to
 * the chat: it follows the dashboard's theme and light/dark mode as they are.
 */
.chatbox {
	--accent: var(--ui-primary);
	--accent-strong: var(--ui-color-primary-700);
	--accent-fg: var(--ui-bg);
	--accent-bg: color-mix(in oklab, var(--ui-primary) 10%, transparent);
	--accent-bg-strong: color-mix(in oklab, var(--ui-primary) 18%, transparent);
	--surface-side: var(--ui-bg);
	--surface-card: var(--ui-bg-elevated);
	--surface-card-2: var(--ui-bg-elevated);
	--surface-inset: var(--ui-bg-muted);
	--fg: var(--ui-text-highlighted);
	--fg-secondary: var(--ui-text-toned);
	--fg-tertiary: var(--ui-text-dimmed);
	--hair: var(--ui-border);
	--hair-strong: var(--ui-border-accented);
	--success-400: var(--ui-color-success-400);
	--success-500: var(--ui-color-success-500);
	--success-bg: color-mix(in oklab, var(--ui-color-success-500) 10%, transparent);
	--warning-400: var(--ui-color-warning-400);
	--warning-bg: color-mix(in oklab, var(--ui-color-warning-500) 10%, transparent);
	--danger-400: var(--ui-color-error-400);
	--danger-bg: color-mix(in oklab, var(--ui-color-error-500) 12%, transparent);
	--dur-fast: 150ms;

	position: relative;
	display: flex;
	flex-direction: column;
	height: 100%;
	font-size: 13px;
	background: var(--surface-side);
	color: var(--fg);
}

.chatbox,
.chatbox :deep(*) {
	scrollbar-width: thin;
	scrollbar-color: var(--hair) transparent;
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
