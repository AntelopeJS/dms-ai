<script setup lang="ts">
import { computed } from "vue";
import { useChatI18n } from "../composables/useChatI18n";
import type { ProviderUnavailableCode } from "../types/settings";

interface Props {
	agentName: string;
	/** Why the provider cannot run, as the sidecar reported it, in English. */
	reason: string;
	/** Set when the panel words the reason itself. */
	code?: ProviderUnavailableCode;
}

const REASON_KEYS: Record<ProviderUnavailableCode, string> = {
	codex_not_signed_in: "dms_ai.panel.errors.codex_not_signed_in",
};

interface Emits {
	openSettings: [];
}

const props = defineProps<Props>();
const emit = defineEmits<Emits>();
const { t } = useChatI18n();
const reasonText = computed(() =>
	props.code === undefined ? props.reason : t(REASON_KEYS[props.code]),
);
</script>

<template>
	<div class="chat-view-provider">
		<div class="cb-provider" role="alert">
			<UIcon name="i-ph-key" class="cb-provider__icon" />
			<div>
				<b>
					{{ t("dms_ai.panel.errors.agent_cant_run", { agent: agentName }) }}
				</b>
				{{ reasonText }}
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
