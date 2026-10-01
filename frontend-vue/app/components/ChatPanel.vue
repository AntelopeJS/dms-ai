<script setup lang="ts">
import { computed, inject, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import ChatView from '../chat/components/ChatView.vue'
import { ASSISTANT_SESSION_KEY } from '../runtime/assistant-session'
import {
	DMS_OVERLAYS_DOM_ID,
	OVERLAY_DOM_ID,
	PANEL_LABEL,
	OVERLAY_Z_INDEX,
	PLACEHOLDER_CONNECTING_TEXT,
	PLACEHOLDER_REVIVING_TEXT,
	PLACEHOLDER_UNAVAILABLE_TEXT,
	PLACEHOLDER_UNAVAILABLE_TITLE,
	SIDECAR_STATUS_CONNECTED,
	SIDECAR_STATUS_CONNECTING,
	SIDECAR_STATUS_REVIVING,
	SIDECAR_STATUS_UNAVAILABLE,
} from '../runtime/constants'

interface StatusScreen {
	title: string
	text: string
	isBusy: boolean
}

interface ResizeStart {
	x: number
	width: number
}

const CLOSE_ICON = 'i-ph-x-light'
const CLOSE_LABEL = 'Close'

const STATUS_SCREENS: Record<string, StatusScreen> = {
	[SIDECAR_STATUS_CONNECTING]: {
		title: '',
		text: PLACEHOLDER_CONNECTING_TEXT,
		isBusy: true,
	},
	[SIDECAR_STATUS_REVIVING]: {
		title: '',
		text: PLACEHOLDER_REVIVING_TEXT,
		isBusy: true,
	},
	[SIDECAR_STATUS_UNAVAILABLE]: {
		title: PLACEHOLDER_UNAVAILABLE_TITLE,
		text: PLACEHOLDER_UNAVAILABLE_TEXT,
		isBusy: false,
	},
}

const session = inject(ASSISTANT_SESSION_KEY, null)
const panelEl = ref<HTMLElement | null>(null)
const isOpen = computed(() => session?.panel.isOpen.value === true)
const hasOpened = ref(isOpen.value)
const isResizing = ref(false)
let resizeStart: ResizeStart | null = null

const statusScreen = computed<StatusScreen | null>(() => {
	const status = session?.status.value ?? SIDECAR_STATUS_CONNECTING
	if (status === SIDECAR_STATUS_CONNECTED) return null
	return STATUS_SCREENS[status] ?? null
})

const panelStyle = computed(() => ({
	width: `${session?.panel.width.value ?? 0}px`,
	zIndex: OVERLAY_Z_INDEX,
}))

watch(isOpen, (open) => {
	if (open) hasOpened.value = true
})

function onResizeMove(event: PointerEvent): void {
	if (resizeStart === null) return
	session?.panel.resize(resizeStart.width + (resizeStart.x - event.clientX))
}

function stopResizing(): void {
	resizeStart = null
	isResizing.value = false
	globalThis.removeEventListener('pointermove', onResizeMove)
	globalThis.removeEventListener('pointerup', onResizeEnd)
}

function onResizeEnd(): void {
	stopResizing()
	session?.panel.commitWidth()
}

function startResize(event: PointerEvent): void {
	if (session === null) return
	event.preventDefault()
	resizeStart = { x: event.clientX, width: session.panel.width.value }
	isResizing.value = true
	globalThis.addEventListener('pointermove', onResizeMove)
	globalThis.addEventListener('pointerup', onResizeEnd)
}

function isInside(event: Event, element: HTMLElement | null): boolean {
	return element !== null && event.composedPath().includes(element)
}

function isInsidePanelOrDmsOverlays(event: Event): boolean {
	return (
		isInside(event, panelEl.value) ||
		isInside(event, document.getElementById(DMS_OVERLAYS_DOM_ID))
	)
}

function onDocumentPointerDown(event: PointerEvent): void {
	if (!isOpen.value || panelEl.value === null) return
	if (isInsidePanelOrDmsOverlays(event)) return
	session?.panel.closeFromOutside(event.timeStamp)
}

function close(): void {
	session?.panel.close()
}

function navigate(path: string): void {
	session?.navigate(path)
}

onMounted(() => {
	document.addEventListener('pointerdown', onDocumentPointerDown, {
		capture: true,
	})
})

onBeforeUnmount(() => {
	document.removeEventListener('pointerdown', onDocumentPointerDown, {
		capture: true,
	})
	stopResizing()
})
</script>

<template>
	<aside
		v-if="session"
		:id="OVERLAY_DOM_ID"
		ref="panelEl"
		class="dms-ai-panel"
		:data-open="isOpen"
		:data-resizing="isResizing"
		:style="panelStyle"
		:inert="!isOpen"
		:aria-label="PANEL_LABEL"
	>
		<div class="dms-ai-panel-resize" @pointerdown="startResize" />
		<ChatView
			v-if="hasOpened"
			class="dms-ai-panel-chat"
			:transport="session.chat"
			@close="close"
			@navigate="navigate"
		/>
		<div v-if="statusScreen" class="dms-ai-panel-status" role="status">
			<button
				type="button"
				class="dms-ai-panel-close"
				:aria-label="CLOSE_LABEL"
				:title="CLOSE_LABEL"
				@click="close"
			>
				<UIcon :name="CLOSE_ICON" class="size-[18px]" />
			</button>
			<span v-if="statusScreen.isBusy" class="dms-ai-panel-spinner" />
			<b v-if="statusScreen.title" class="dms-ai-panel-status-title">{{
				statusScreen.title
			}}</b>
			<span class="dms-ai-panel-status-text">{{ statusScreen.text }}</span>
		</div>
	</aside>
</template>

<style scoped>
.dms-ai-panel {
	position: fixed;
	top: 0;
	right: 0;
	bottom: 0;
	display: flex;
	overflow: hidden;
	background: var(--ui-bg);
	color: var(--ui-text);
	border-left: 1px solid var(--ui-border);
	box-shadow: 0 8px 24px rgb(0 0 0 / 0.18);
	transform: translateX(100%);
	transition: transform 220ms cubic-bezier(0.16, 1, 0.3, 1);
}

.dms-ai-panel[data-open='true'] {
	transform: none;
}

.dms-ai-panel[data-resizing='true'] {
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
	background: var(--ui-bg);
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
	top: 14px;
	right: 14px;
	display: grid;
	place-items: center;
	width: 30px;
	height: 30px;
	border-radius: 7px;
	color: var(--ui-text-dimmed);
	cursor: pointer;
}

.dms-ai-panel-close:hover {
	background: var(--ui-bg-muted);
	color: var(--ui-text);
}

.dms-ai-panel-spinner {
	width: 22px;
	height: 22px;
	border: 2.5px solid color-mix(in oklab, currentColor 20%, transparent);
	border-top-color: currentColor;
	border-radius: 50%;
	animation: dms-ai-spin 0.7s linear infinite;
}

@keyframes dms-ai-spin {
	to {
		transform: rotate(360deg);
	}
}
</style>
