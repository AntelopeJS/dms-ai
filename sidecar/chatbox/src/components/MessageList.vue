<script setup lang="ts">
import { computed } from "vue";
import { ATTACH_FILE_ICON } from "../constants/attachments";
import {
	MESSAGE_ROLES,
	ROLE_LABELS,
	THINKING_LABEL,
} from "../constants/conversation";
import type {
	AssistantMessage,
	ConversationMessage,
	MessageAttachment,
	ToolCallMessage,
	UserMessage,
} from "../types/conversation";
import { formatBytes, isInlineImage } from "../utils/attachments";
import { isTodoWrite } from "../utils/todos";
import MarkdownContent from "./MarkdownContent.vue";
import ToolCallEntry from "./ToolCallEntry.vue";
import ToolCluster from "./ToolCluster.vue";

interface Props {
	messages: ConversationMessage[];
	isRunning: boolean;
}

const props = defineProps<Props>();

const ROLE_LABEL_BY_ROLE: Record<string, string> = {
	[MESSAGE_ROLES.USER]: ROLE_LABELS.USER,
	[MESSAGE_ROLES.ASSISTANT]: ROLE_LABELS.ASSISTANT,
	[MESSAGE_ROLES.TOOL]: ROLE_LABELS.TOOL,
};

type RenderItem =
	| { kind: "message"; key: string; message: UserMessage | AssistantMessage }
	| { kind: "tools"; key: string; tools: ToolCallMessage[] };

// Fold each run of adjacent tool calls into a single cluster so a busy turn
// reads as one collapsible line instead of a wall of cards. A lone tool call
// renders bare — a "Used 1 tools" wrapper would be noise. TodoWrite calls are
// dropped here; the plan renders in the docked panel above the scroll area.
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

// The trailing tool cluster of a running turn is the agent's "active workspace":
// it stays expanded through any text that follows and only settles once a newer
// cluster supersedes it or the run ends. That key drives ToolCluster's `live`.
const lastToolKey = computed<string | null>(() => {
	for (let i = renderItems.value.length - 1; i >= 0; i--) {
		const item = renderItems.value[i];
		if (item.kind === "tools") return item.key;
	}
	return null;
});

const showThinking = computed<boolean>(() => {
	if (!props.isRunning) return false;
	const last = props.messages.at(-1);
	return last === undefined || last.role !== MESSAGE_ROLES.ASSISTANT;
});

function roleLabel(role: string): string {
	return ROLE_LABEL_BY_ROLE[role] ?? role;
}

function userAttachments(
	message: UserMessage | AssistantMessage,
): MessageAttachment[] {
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

				<MarkdownContent
					v-else
					class="message-bubble message-bubble-assistant"
					:content="item.message.content"
				/>
			</li>
		</template>

		<li v-if="showThinking" class="message-item" data-role="assistant">
			<div class="thinking" aria-live="polite">
				<span class="thinking-label">{{ THINKING_LABEL }}</span>
				<span class="thinking-dots"><i></i><i></i><i></i></span>
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
