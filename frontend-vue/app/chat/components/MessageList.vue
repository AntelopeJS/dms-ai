<script setup lang="ts">
import { computed } from "vue";
import {
	MESSAGE_ROLES,
	RETRY_LABEL,
	ROLE_LABELS,
} from "../constants/conversation";
import {
	ACTIVITY_KINDS,
	QUIET_LABEL,
	RECONNECT_LABEL,
	STALLED_LABEL,
	STOP_LABEL,
} from "../constants/run-status";
import type {
	AssistantMessage,
	ConversationMessage,
	ErrorMessage,
	MessageAttachment,
	RunProgress,
	ToolCallMessage,
	UserMessage,
} from "../types/conversation";
import { formatBytes, isInlineImage } from "../utils/attachments";
import {
	agentQuietMs,
	describeActivity,
	formatClock,
	isAgentQuiet,
	runElapsedMs,
} from "../utils/run-status";
import { isTodoWrite } from "../utils/todos";
import MarkdownContent from "./MarkdownContent.vue";
import ToolCallEntry from "./ToolCallEntry.vue";
import ToolCluster from "./ToolCluster.vue";

interface Props {
	messages: ConversationMessage[];
	isRunning: boolean;
	progress: RunProgress | null;
	nowMs: number;
	isStalled: boolean;
	stalledForMs: number;
}

interface Emits {
	retry: [];
	reconnect: [];
	stop: [];
}

type TextMessage = UserMessage | AssistantMessage | ErrorMessage;

interface MessageRenderItem {
	kind: "message";
	key: string;
	message: TextMessage;
}

interface ToolsRenderItem {
	kind: "tools";
	key: string;
	tools: ToolCallMessage[];
}

type RenderItem = MessageRenderItem | ToolsRenderItem;

const props = defineProps<Props>();
const emit = defineEmits<Emits>();

/** Named in this file so the renderer's icon scan bundles it. */
const ATTACH_FILE_ICON = "i-ph-file";

const ROLE_LABEL_BY_ROLE: Record<string, string> = {
	[MESSAGE_ROLES.USER]: ROLE_LABELS.USER,
	[MESSAGE_ROLES.ERROR]: ROLE_LABELS.ERROR,
	[MESSAGE_ROLES.ASSISTANT]: ROLE_LABELS.ASSISTANT,
	[MESSAGE_ROLES.TOOL]: ROLE_LABELS.TOOL,
};

/**
 * Each run of adjacent tool calls folds into a single cluster, so a busy turn
 * reads as one collapsible line instead of a wall of cards. A lone tool call
 * renders bare: a "Used 1 tools" wrapper would be noise. TodoWrite calls are
 * dropped here; the plan renders in the docked panel above the scroll area.
 */
const renderItems = computed<RenderItem[]>(() => {
	const out: RenderItem[] = [];
	let run: ToolCallMessage[] = [];

	const flush = (): void => {
		if (run.length === 0) return;
		out.push({ kind: "tools", key: `tools-${run[0].id}`, tools: run });
		run = [];
	};

	for (const message of props.messages) {
		if (isTodoWrite(message)) {
			flush();
			continue;
		}
		if (message.role === MESSAGE_ROLES.TOOL) {
			run = [...run, message];
			continue;
		}
		flush();
		out.push({ kind: "message", key: message.id, message });
	}
	flush();
	return out;
});

/**
 * The trailing tool cluster of a running turn is the agent's "active workspace":
 * it stays expanded through any text that follows and only settles once a newer
 * cluster supersedes it or the run ends. That key drives ToolCluster's `live`.
 */
const lastToolKey = computed<string | null>(() => {
	for (let i = renderItems.value.length - 1; i >= 0; i--) {
		const item = renderItems.value[i];
		if (item.kind === "tools") return item.key;
	}
	return null;
});

const showActivity = computed<boolean>(() => {
	if (!props.isRunning) return false;
	if (props.progress?.activity !== ACTIVITY_KINDS.RESPONDING) return true;
	const last = props.messages.at(-1);
	return last === undefined || last.role !== MESSAGE_ROLES.ASSISTANT;
});

const activityLabel = computed<string>(() => describeActivity(props.progress));

const elapsedLabel = computed<string>(() =>
	formatClock(runElapsedMs(props.progress, props.nowMs)),
);

const quietLabel = computed<string>(() => {
	if (!isAgentQuiet(props.progress, props.nowMs)) return "";
	return `${QUIET_LABEL} ${formatClock(agentQuietMs(props.progress, props.nowMs))}`;
});

/** The answer still arriving, rendered incrementally until the run ends. */
const streamingMessageId = computed<string | null>(() => {
	if (!props.isRunning) return null;
	const last = props.messages.at(-1);
	return last?.role === MESSAGE_ROLES.ASSISTANT ? last.id : null;
});

const lastErrorId = computed<string | null>(() => {
	const last = props.messages.at(-1);
	return last?.role === MESSAGE_ROLES.ERROR ? last.id : null;
});

function roleLabel(role: string): string {
	return ROLE_LABEL_BY_ROLE[role] ?? role;
}

function userAttachments(message: TextMessage): MessageAttachment[] {
	if (message.role !== MESSAGE_ROLES.USER) return [];
	return message.attachments ?? [];
}

function formatTime(ms: number): string {
	return new Date(ms).toLocaleTimeString();
}
</script>

<template>
	<ol class="message-list">
		<template v-for="item in renderItems" :key="item.key">
			<li
				v-if="item.kind === 'tools'"
				class="message-item"
				data-role="tool"
			>
				<ToolCluster
					v-if="item.tools.length > 1"
					:tools="item.tools"
					:live="isRunning && item.key === lastToolKey"
				/>
				<ToolCallEntry v-else :message="item.tools[0]" />
			</li>

			<li
				v-else
				class="message-item"
				:data-role="item.message.role"
			>
				<header class="message-meta">
					<span class="message-role">{{ roleLabel(item.message.role) }}</span>
					<span class="message-time">{{ formatTime(item.message.timestampMs) }}</span>
				</header>

				<template v-if="item.message.role === MESSAGE_ROLES.USER">
					<p
						v-if="item.message.content"
						class="message-bubble message-bubble-user"
					>{{ item.message.content }}</p>

					<ul
						v-if="userAttachments(item.message).length > 0"
						class="msg-attachments"
					>
						<li
							v-for="(att, i) in userAttachments(item.message)"
							:key="i"
							class="msg-att"
						>
							<img
								v-if="isInlineImage(att.mimeType) && att.dataUrl"
								:src="att.dataUrl"
								:alt="att.name"
								class="msg-att-thumb"
							/>
							<template v-else>
								<UIcon :name="ATTACH_FILE_ICON" class="size-[15px]" />
								<span class="msg-att-name">{{ att.name }}</span>
								<span class="msg-att-size">{{ formatBytes(att.size) }}</span>
							</template>
						</li>
					</ul>
				</template>

				<div
					v-else-if="item.message.role === MESSAGE_ROLES.ERROR"
					class="message-bubble message-bubble-error"
					role="alert"
				>
					<p class="error-text">{{ item.message.content }}</p>
					<button
						v-if="
							!isRunning &&
							item.message.isRetryable &&
							item.message.id === lastErrorId
						"
						type="button"
						class="run-action"
						@click="emit('retry')"
					>
						{{ RETRY_LABEL }}
					</button>
				</div>

				<MarkdownContent
					v-else
					class="message-bubble message-bubble-assistant"
					:content="item.message.content"
					:is-streaming="item.message.id === streamingMessageId"
				/>
			</li>
		</template>

		<li v-if="isStalled" class="message-item" data-role="assistant">
			<div class="run-stalled" role="alert">
				<span>{{ STALLED_LABEL }} {{ formatClock(stalledForMs) }}.</span>
				<button type="button" class="run-action" @click="emit('reconnect')">
					{{ RECONNECT_LABEL }}
				</button>
				<button type="button" class="run-action" @click="emit('stop')">
					{{ STOP_LABEL }}
				</button>
			</div>
		</li>
		<li v-else-if="showActivity" class="message-item" data-role="assistant">
			<div class="thinking" aria-live="polite">
				<span class="thinking-label">{{ activityLabel }}</span>
				<span class="thinking-dots"><i></i><i></i><i></i></span>
				<span class="thinking-clock">{{ elapsedLabel }}</span>
				<span v-if="quietLabel" class="thinking-quiet">{{ quietLabel }}</span>
			</div>
		</li>
	</ol>
</template>

<style scoped>
.message-list {
	list-style: none;
	margin: 0;
	padding: 12px;
	display: flex;
	flex-direction: column;
	gap: 12px;
}

.message-item {
	display: flex;
	flex-direction: column;
	gap: 4px;
	max-width: 85%;
}

.message-item[data-role="user"] {
	align-self: flex-end;
	align-items: flex-end;
}

.message-item[data-role="assistant"] {
	align-self: flex-start;
	align-items: flex-start;
}

.message-item[data-role="tool"] {
	align-self: stretch;
	max-width: 100%;
}

.message-meta {
	display: flex;
	gap: 8px;
	font-family: var(--font-mono);
	font-size: 10px;
	color: var(--fg-tertiary);
}

.message-item[data-role="assistant"] .message-role,
.message-item[data-role="user"] .message-role {
	display: none;
}

.message-role {
	font-weight: 600;
}

.message-bubble {
	margin: 0;
	white-space: pre-wrap;
	word-break: break-word;
	font-size: 13.5px;
	line-height: 1.55;
}

.message-bubble-user {
	padding: 11px 14px;
	border-radius: 14px 14px 4px 14px;
	background: var(--accent);
	color: var(--accent-fg);
	font-weight: 500;
}

.message-bubble-assistant {
	white-space: normal;
	color: var(--fg-secondary);
}

.msg-attachments {
	list-style: none;
	margin: 6px 0 0;
	padding: 0;
	display: flex;
	flex-wrap: wrap;
	justify-content: flex-end;
	gap: 6px;
}

.msg-att {
	display: inline-flex;
	align-items: center;
	gap: 6px;
	max-width: 220px;
	padding: 5px 9px;
	background: var(--surface-inset);
	border: 1px solid var(--hair);
	border-radius: var(--radius-md);
	color: var(--fg-secondary);
	font-size: 12px;
}

.msg-att-thumb {
	max-width: 180px;
	max-height: 180px;
	padding: 0;
	border-radius: var(--radius-md);
	object-fit: contain;
}

.msg-att:has(.msg-att-thumb) {
	padding: 0;
	overflow: hidden;
}

.msg-att-name {
	white-space: nowrap;
	overflow: hidden;
	text-overflow: ellipsis;
	font-weight: 500;
	color: var(--fg);
}

.msg-att-size {
	flex: 0 0 auto;
	color: var(--fg-tertiary);
	font-size: 10px;
}

.thinking {
	display: inline-flex;
	align-items: center;
	gap: 8px;
	color: var(--fg-tertiary);
	font-size: 13px;
}

.thinking-dots {
	display: inline-flex;
	gap: 3px;
}

.thinking-clock,
.thinking-quiet {
	font-family: var(--font-mono);
	font-size: 11px;
}

.thinking-quiet {
	color: var(--fg-secondary);
}

.message-item[data-role="error"] {
	align-self: stretch;
	max-width: 100%;
}

.message-bubble-error,
.run-stalled {
	display: flex;
	flex-wrap: wrap;
	align-items: center;
	gap: 8px;
	padding: 9px 12px;
	border: 1px solid var(--danger-400);
	border-radius: var(--radius-md);
	background: var(--danger-bg);
	color: var(--fg);
	white-space: normal;
}

.error-text {
	flex: 1 1 200px;
	margin: 0;
}

.run-action {
	padding: 4px 10px;
	border: 1px solid var(--hair);
	border-radius: var(--radius-md);
	background: var(--surface-card);
	color: var(--fg);
	font-size: 12px;
	font-weight: 600;
	cursor: pointer;
}

.run-action:hover {
	border-color: var(--accent);
}

.thinking-dots i {
	width: 5px;
	height: 5px;
	border-radius: 50%;
	background: #9ca3af;
	animation: thinking-bounce 1.2s infinite ease-in-out both;
}

.thinking-dots i:nth-child(2) {
	animation-delay: 0.16s;
}

.thinking-dots i:nth-child(3) {
	animation-delay: 0.32s;
}

@keyframes thinking-bounce {
	0%,
	80%,
	100% {
		transform: scale(0.6);
		opacity: 0.4;
	}
	40% {
		transform: scale(1);
		opacity: 1;
	}
}
</style>
