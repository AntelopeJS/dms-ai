<script setup lang="ts">
import { computed } from "vue";
import {
	BANNER_LABELS,
	RECONNECT_BUTTON_LABEL,
} from "../constants/connection-banner";
import {
	CONNECTION_STATUSES,
	type ConnectionStatus,
} from "../constants/ws";

interface Props {
	status: ConnectionStatus;
}

const props = defineProps<Props>();
const emit = defineEmits<{ reconnect: [] }>();

const LABEL_BY_STATUS: Record<
	Exclude<ConnectionStatus, typeof CONNECTION_STATUSES.CONNECTED>,
	string
> = {
	[CONNECTION_STATUSES.CONNECTING]: BANNER_LABELS.connecting,
	[CONNECTION_STATUSES.RECONNECTING]: BANNER_LABELS.reconnecting,
	[CONNECTION_STATUSES.DISCONNECTED]: BANNER_LABELS.disconnected,
};

const isVisible = computed<boolean>(
	() => props.status !== CONNECTION_STATUSES.CONNECTED,
);

const label = computed<string>(() => {
	if (props.status === CONNECTION_STATUSES.CONNECTED) return "";
	return LABEL_BY_STATUS[props.status];
});

function onReconnect(): void {
	emit("reconnect");
}
</script>

<template>
	<div
		v-if="isVisible"
		class="connection-banner"
		:data-status="props.status"
		role="status"
		aria-live="polite"
	>
		<span class="connection-banner-label">{{ label }}</span>
		<button
			type="button"
			class="connection-banner-button"
			@click="onReconnect"
		>
			{{ RECONNECT_BUTTON_LABEL }}
		</button>
	</div>
</template>

<style scoped>
.connection-banner {
	display: flex;
	align-items: center;
	justify-content: space-between;
	gap: 8px;
	padding: 6px 12px;
	font-size: 12px;
	border-bottom: 1px solid transparent;
}

.connection-banner[data-status="connecting"],
.connection-banner[data-status="reconnecting"] {
	color: var(--warning-400);
	background: var(--warning-bg);
	border-bottom-color: color-mix(in srgb, var(--warning-400) 25%, transparent);
}

.connection-banner[data-status="disconnected"] {
	color: var(--danger-400);
	background: var(--danger-bg);
	border-bottom-color: color-mix(in srgb, var(--danger-400) 25%, transparent);
}

.connection-banner-label {
	flex: 1;
	text-align: left;
}

.connection-banner-button {
	background: transparent;
	border: 1px solid currentColor;
	color: inherit;
	border-radius: var(--radius-sm);
	padding: 2px 8px;
	font: inherit;
	font-size: 11px;
	font-weight: 600;
	cursor: pointer;
}

.connection-banner-button:hover {
	background: rgba(255, 255, 255, 0.08);
}
</style>
