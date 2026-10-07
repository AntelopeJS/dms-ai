<script setup lang="ts">
import { computed, inject, onBeforeUnmount, onMounted, ref, watch } from "vue";
import ChatView from "../chat/components/ChatView.vue";
import { useChatI18n } from "../chat/composables/useChatI18n";
import { SETTINGS_PAGE_PATH } from "../chat/constants/protocol";
import { ASSISTANT_SESSION_KEY } from "../runtime/assistant-session";
import {
	DMS_OVERLAYS_DOM_ID,
	OVERLAY_DOM_ID,
	OVERLAY_Z_INDEX,
	SIDECAR_STATUS_CONNECTING,
	SIDECAR_STATUS_REVIVING,
	SIDECAR_STATUS_UNAVAILABLE,
} from "../runtime/constants";

interface ResizeStart {
	x: number;
	width: number;
}

const session = inject(ASSISTANT_SESSION_KEY, null);
const { t } = useChatI18n();
const panelEl = ref<HTMLElement | null>(null);
const isOpen = computed(() => session?.panel.isOpen.value === true);
const hasOpened = ref(isOpen.value);
const isResizing = ref(false);
const isRestarting = ref(false);
// Drawn once mounted, inside a host element rendered on the server and the
// client alike, so hydration always finds the same node.
const isMounted = ref(false);
let resizeStart: ResizeStart | null = null;

const status = computed(
	() => session?.status.value ?? SIDECAR_STATUS_CONNECTING,
);
const isUnavailable = computed(
	() => status.value === SIDECAR_STATUS_UNAVAILABLE,
);
const isFirstConnect = computed(
	() => status.value === SIDECAR_STATUS_CONNECTING,
);
const lastError = computed(() => session?.lastError.value ?? null);

const panelStyle = computed(() => ({
	width: `${session?.panel.width.value ?? 0}px`,
	zIndex: OVERLAY_Z_INDEX,
}));

watch(isOpen, (open) => {
	if (open) hasOpened.value = true;
});

function onResizeMove(event: PointerEvent): void {
	if (resizeStart === null) return;
	session?.panel.resize(resizeStart.width + (resizeStart.x - event.clientX));
}

function stopResizing(): void {
	resizeStart = null;
	isResizing.value = false;
	globalThis.removeEventListener("pointermove", onResizeMove);
	globalThis.removeEventListener("pointerup", onResizeEnd);
}

function onResizeEnd(): void {
	stopResizing();
	session?.panel.commitWidth();
}

function startResize(event: PointerEvent): void {
	if (session === null) return;
	event.preventDefault();
	resizeStart = { x: event.clientX, width: session.panel.width.value };
	isResizing.value = true;
	globalThis.addEventListener("pointermove", onResizeMove);
	globalThis.addEventListener("pointerup", onResizeEnd);
}

function isInside(event: Event, element: HTMLElement | null): boolean {
	return element !== null && event.composedPath().includes(element);
}

function isInsidePanelOrDmsOverlays(event: Event): boolean {
	return (
		isInside(event, panelEl.value) ||
		isInside(event, document.getElementById(DMS_OVERLAYS_DOM_ID))
	);
}

function onDocumentPointerDown(event: PointerEvent): void {
	if (!isOpen.value || panelEl.value === null) return;
	if (isInsidePanelOrDmsOverlays(event)) return;
	session?.panel.closeFromOutside(event.timeStamp);
}

function close(): void {
	session?.panel.close();
}

function navigate(path: string): void {
	session?.navigate(path);
}

async function restart(): Promise<void> {
	if (session === null || isRestarting.value) return;
	isRestarting.value = true;
	try {
		await session.restart();
	} finally {
		isRestarting.value = false;
	}
}

onMounted(() => {
	isMounted.value = true;
	document.addEventListener("pointerdown", onDocumentPointerDown, {
		capture: true,
	});
});

onBeforeUnmount(() => {
	document.removeEventListener("pointerdown", onDocumentPointerDown, {
		capture: true,
	});
	stopResizing();
});
</script>

<template>
	<div class="dms-ai-panel-host">
		<aside
			v-if="session && isMounted"
			:id="OVERLAY_DOM_ID"
			ref="panelEl"
			class="dms-ai-panel"
			:data-open="isOpen"
			:data-resizing="isResizing"
			:style="panelStyle"
			:inert="!isOpen"
			:aria-label="t('dms_ai.panel.launcher')"
		>
			<div class="dms-ai-panel-resize" @pointerdown="startResize" />
			<ChatView
				v-if="hasOpened"
				class="dms-ai-panel-chat"
				:transport="session.chat"
				:intents="session.intents"
				:is-open="isOpen"
				:page="session.currentPage.value"
				:is-reviving="status === SIDECAR_STATUS_REVIVING"
				:api="session.api"
				@close="close"
				@navigate="navigate"
			/>
			<div
				v-if="isUnavailable || isFirstConnect"
				class="dms-ai-panel-status"
				role="status"
			>
				<UButton
					size="sm"
					color="neutral"
					variant="ghost"
					square
					icon="i-ph-x"
					class="dms-ai-panel-close"
					:aria-label="t('dms_ai.panel.header.close')"
					@click="close"
				/>
				<template v-if="isUnavailable">
					<DmsIconWell icon="i-ph-plugs" tone="error" size="lg" />
					<b class="dms-ai-panel-status-title">
						{{ t("dms_ai.panel.unavailable.title") }}
					</b>
					<span class="dms-ai-panel-status-text">
						{{
							lastError
								? t("dms_ai.panel.unavailable.text_error")
								: t("dms_ai.panel.unavailable.text")
						}}
					</span>
					<code v-if="lastError" class="dms-ai-panel-error">
						{{ lastError }}
					</code>
					<div class="dms-ai-panel-actions">
						<UButton
							size="sm"
							color="secondary"
							icon="i-ph-arrows-clockwise"
							:loading="isRestarting"
							:label="t('dms_ai.panel.unavailable.restart')"
							@click="restart"
						/>
						<UButton
							size="sm"
							color="neutral"
							variant="outline"
							icon="i-ph-gear-six"
							:label="t('dms_ai.panel.header.settings')"
							@click="navigate(SETTINGS_PAGE_PATH)"
						/>
					</div>
					<span class="dms-ai-panel-note">
						{{ t("dms_ai.panel.unavailable.kept") }}
					</span>
				</template>
				<template v-else>
					<span class="dms-ai-panel-spinner" />
					<b class="dms-ai-panel-status-title">
						{{ t("dms_ai.panel.connection.first_connect") }}
					</b>
				</template>
			</div>
		</aside>
	</div>
</template>

<style scoped>
.dms-ai-panel-host {
	display: contents;
}

.dms-ai-panel {
	position: fixed;
	top: 0;
	right: 0;
	bottom: 0;
	display: flex;
	overflow: hidden;
	background: var(--dms-bg-sidebar, var(--ui-bg));
	color: var(--ui-text);
	border-left: 1px solid var(--ui-border-accented);
	box-shadow: var(--dms-shadow-pop, 0 8px 24px rgb(0 0 0 / 0.18));
	transform: translateX(100%);
	transition: transform 220ms cubic-bezier(0.16, 1, 0.3, 1);
}

.dms-ai-panel[data-open="true"] {
	transform: none;
}

.dms-ai-panel[data-resizing="true"] {
	user-select: none;
}

.dms-ai-panel-chat {
	flex: 1 1 auto;
	min-width: 0;
}

.dms-ai-panel-resize {
	position: absolute;
	top: 0;
	left: 0;
	z-index: 3;
	width: 6px;
	height: 100%;
	cursor: ew-resize;
	touch-action: none;
}

.dms-ai-panel-status {
	position: absolute;
	inset: 0;
	z-index: 2;
	display: flex;
	flex-direction: column;
	align-items: center;
	justify-content: center;
	gap: 14px;
	padding: 24px;
	text-align: center;
	font-size: 13px;
	font-weight: 500;
	line-height: 1.5;
	background: var(--dms-bg-sidebar, var(--ui-bg));
}

.dms-ai-panel-status-title {
	font-size: 15px;
	font-weight: 600;
}

.dms-ai-panel-status-text {
	color: var(--ui-text-muted);
}

.dms-ai-panel-close {
	position: absolute;
	top: 11px;
	right: 8px;
}

.dms-ai-panel-error {
	display: block;
	max-width: 320px;
	padding: 8px 10px;
	border-radius: 8px;
	background: var(--ui-bg-accented);
	color: var(--ui-text-highlighted);
	font: 500 12px var(--font-mono, ui-monospace, monospace);
	text-align: left;
	white-space: pre-wrap;
	overflow-wrap: anywhere;
}

.dms-ai-panel-actions {
	display: flex;
	flex-wrap: wrap;
	justify-content: center;
	gap: 6px;
}

.dms-ai-panel-note {
	font-size: 12px;
	color: var(--ui-text-muted);
}

.dms-ai-panel-spinner {
	width: 22px;
	height: 22px;
	border: 2px solid color-mix(in oklab, var(--ui-secondary) 25%, transparent);
	border-top-color: var(--ui-secondary);
	border-radius: 50%;
	animation: dms-ai-spin 0.7s linear infinite;
}

@keyframes dms-ai-spin {
	to {
		transform: rotate(360deg);
	}
}
</style>
