<script setup lang="ts">
import type { PendingUndo } from "../composables/useChangeSetActions";
import { useChatI18n } from "../composables/useChatI18n";

interface Props {
	/** The undo waiting on the user; the modal is open while there is one. */
	pending: PendingUndo | null;
}

interface Emits {
	confirm: [includeLater: boolean];
	cancel: [];
}

defineProps<Props>();
const emit = defineEmits<Emits>();
const { t } = useChatI18n();

function onOpenChange(isOpen: boolean): void {
	if (!isOpen) emit("cancel");
}
</script>

<template>
	<UModal
		:open="pending !== null"
		:title="t('dms_ai.panel.change.conflict_title')"
		@update:open="onOpenChange"
	>
		<template #body>
			<p class="chat-view-conflict">
				{{
					t("dms_ai.panel.change.conflict_text", {
						number: pending?.number ?? 0,
					})
				}}
			</p>
			<ul class="chat-view-conflicts">
				<li
					v-for="conflict in pending?.conflicts ?? []"
					:key="conflict.changeSetId"
				>
					<b>#{{ conflict.number }}</b>
					{{ conflict.title }}
					<span>{{ conflict.files.join(", ") }}</span>
				</li>
			</ul>
		</template>
		<template #footer>
			<div class="chat-view-conflict-foot">
				<UButton
					color="neutral"
					variant="ghost"
					:label="t('dms_ai.panel.change.undo_only')"
					@click="emit('confirm', false)"
				/>
				<UButton
					color="secondary"
					:label="t('dms_ai.panel.change.undo_together')"
					@click="emit('confirm', true)"
				/>
			</div>
		</template>
	</UModal>
</template>

<style scoped>
.chat-view-conflict {
	margin: 0 0 10px;
	font-size: 13px;
	line-height: 1.5;
	color: var(--ui-text-muted);
}

.chat-view-conflicts {
	display: grid;
	gap: 6px;
	margin: 0;
	padding: 0;
	list-style: none;
	font-size: 12.5px;
}

.chat-view-conflicts span {
	display: block;
	font-family: var(--ai-font-mono, ui-monospace, monospace);
	font-size: 11px;
	color: var(--ui-text-muted);
	overflow-wrap: anywhere;
}

.chat-view-conflict-foot {
	display: flex;
	justify-content: flex-end;
	gap: 8px;
	width: 100%;
}
</style>
