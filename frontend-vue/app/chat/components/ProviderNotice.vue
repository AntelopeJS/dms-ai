<script setup lang="ts">
import { useChatI18n } from "../composables/useChatI18n";

interface Props {
	agentName: string;
	/** Why the provider cannot run, as the sidecar reported it. */
	reason: string;
}

interface Emits {
	openSettings: [];
}

defineProps<Props>();
const emit = defineEmits<Emits>();
const { t } = useChatI18n();
</script>

<template>
	<div class="chat-view-provider">
		<div class="cb-provider" role="alert">
			<UIcon name="i-ph-key" class="cb-provider__icon" />
			<div>
				<b>
					{{ t("dms_ai.panel.errors.agent_cant_run", { agent: agentName }) }}
				</b>
				{{ reason }}
				{{ t("dms_ai.panel.errors.agent_no_fallback") }}
				<div class="cb-provider__row">
					<UButton
						size="xs"
						color="neutral"
						variant="outline"
						icon="i-ph-gear-six"
						:label="t('dms_ai.panel.errors.open_settings')"
						@click="emit('openSettings')"
					/>
				</div>
			</div>
		</div>
	</div>
</template>

<style scoped>
.chat-view-provider {
	padding: 0 14px 16px;
}

.cb-provider {
	display: flex;
	gap: 10px;
	padding: 10px 12px;
	border: 1px solid var(--dms-error-line);
	border-radius: var(--ai-radius-md);
	background: var(--dms-error-tint);
	font-size: 12.5px;
	line-height: 1.5;
	color: var(--ui-text-toned);
}

.cb-provider__icon {
	width: 16px;
	height: 16px;
	flex: none;
	margin-top: 1px;
	color: var(--ui-error);
}

.cb-provider b {
	font-weight: 600;
	color: var(--ui-text-highlighted);
}

.cb-provider__row {
	margin-top: 8px;
}
</style>
