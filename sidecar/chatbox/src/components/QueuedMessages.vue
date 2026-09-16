<script setup lang="ts">
import { ATTACH_REMOVE_ICON } from "../constants/attachments";
import type { QueuedMessage } from "../types/conversation";

interface Props {
	queue: QueuedMessage[];
}

defineProps<Props>();
defineEmits<{ cancel: [id: string] }>();

function attachmentLabel(message: QueuedMessage): string {
	const count = message.attachments.length;
	if (count === 0) return "";
	return count === 1 ? "1 file" : `${count} files`;
}
</script>

<template>
	<ul class="queued" aria-label="Queued messages">
		<li v-for="message in queue" :key="message.id" class="queued-item">
			<span class="queued-tag" aria-hidden="true">Queued</span>
			<span class="queued-text">{{ message.content }}</span>
			<span v-if="attachmentLabel(message).length > 0" class="queued-att">
				{{ attachmentLabel(message) }}
			</span>
			<button
				type="button"
				class="queued-cancel"
				:aria-label="`Cancel queued message`"
				title="Cancel"
				@click="$emit('cancel', message.id)"
			>
				<UIcon :name="ATTACH_REMOVE_ICON" class="size-[13px]" />
			</button>
		</li>
	</ul>
</template>

<style scoped>
.queued {
	list-style: none;
	margin: 0;
	padding: 8px 14px 0;
	display: flex;
	flex-direction: column;
	gap: 4px;
	background: var(--surface-side);
}

.queued-item {
	display: flex;
	align-items: center;
	gap: 8px;
	padding: 5px 8px;
	background: var(--surface-inset);
	border: 1px dashed var(--hair-strong);
	border-radius: var(--radius-md);
	font-size: 12.5px;
}

.queued-tag {
	flex: 0 0 auto;
	font-family: var(--font-mono);
	font-size: 9px;
	font-weight: 700;
	letter-spacing: 0.04em;
	text-transform: uppercase;
	color: var(--fg-tertiary);
}

.queued-text {
	flex: 1;
	min-width: 0;
	white-space: nowrap;
	overflow: hidden;
	text-overflow: ellipsis;
	color: var(--fg-secondary);
}

.queued-att {
	flex: 0 0 auto;
	font-size: 10px;
	color: var(--fg-tertiary);
}

.queued-cancel {
	flex: 0 0 auto;
	display: grid;
	place-items: center;
	width: 20px;
	height: 20px;
	border: none;
	background: transparent;
	border-radius: 5px;
	color: var(--fg-tertiary);
	cursor: pointer;
}

.queued-cancel:hover {
	background: var(--danger-bg);
	color: var(--danger-400);
}
</style>
