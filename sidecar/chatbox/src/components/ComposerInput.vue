<script setup lang="ts">
import { computed, nextTick, ref } from "vue";
import {
	ATTACH_FILE_ICON,
	ATTACH_ICON,
	ATTACH_LABEL,
	ATTACH_REMOVE_ICON,
	MAX_ATTACHMENTS,
} from "../constants/attachments";
import {
	NEWLINE_HOTKEY_MODIFIER,
	SEND_HOTKEY,
} from "../constants/conversation";
import {
	exceedsSizeLimit,
	formatBytes,
	isInlineImage,
	type PendingAttachment,
	readFileAsAttachment,
} from "../utils/attachments";

import type { GenerationMode } from "../types/settings";

interface Props {
	isDisabled: boolean;
	isRunning: boolean;
	generationMode: GenerationMode;
	builderAvailable: boolean;
}

const props = defineProps<Props>();
const emit = defineEmits<{
	submit: [content: string, attachments: PendingAttachment[]];
	stop: [];
	"update:generationMode": [mode: GenerationMode];
}>();

const activeMode = computed<GenerationMode>(() =>
	props.generationMode === "safe" && props.builderAvailable ? "safe" : "vibe",
);

function selectGeneration(mode: GenerationMode): void {
	if (mode === "safe" && !props.builderAvailable) return;
	if (mode !== props.generationMode) emit("update:generationMode", mode);
}

const draft = ref("");
const textareaRef = ref<HTMLTextAreaElement | null>(null);
const fileInputRef = ref<HTMLInputElement | null>(null);
const attachments = ref<PendingAttachment[]>([]);
const errorMsg = ref("");
// dragenter/dragleave fire per child element; a depth counter keeps the overlay
// stable while the pointer moves across the composer's inner nodes.
const dragDepth = ref(0);
const isDragging = ref(false);

// Only a dropped connection blocks the input. During a run the field stays live
// so follow-ups can be typed and queued (they send as the current turn ends).
const isInputDisabled = computed<boolean>(() => props.isDisabled);

// Grow the textarea with its content up to a cap, then scroll within it.
const MAX_HEIGHT_PX = 160;

function autoGrow(): void {
	const el = textareaRef.value;
	if (el === null) return;
	el.style.height = "auto";
	el.style.height = `${Math.min(el.scrollHeight, MAX_HEIGHT_PX)}px`;
}

const isSendDisabled = computed<boolean>(() => {
	if (isInputDisabled.value) return true;
	return draft.value.trim().length === 0 && attachments.value.length === 0;
});

async function addFiles(files: FileList | File[]): Promise<void> {
	errorMsg.value = "";
	const incoming = Array.from(files);
	if (incoming.length === 0) return;

	const room = MAX_ATTACHMENTS - attachments.value.length;
	if (room <= 0) {
		errorMsg.value = `Up to ${MAX_ATTACHMENTS} files per message.`;
		return;
	}

	const accepted = incoming.slice(0, room);
	if (accepted.length < incoming.length) {
		errorMsg.value = `Up to ${MAX_ATTACHMENTS} files per message.`;
	}

	for (const file of accepted) {
		if (exceedsSizeLimit(file)) {
			errorMsg.value = `"${file.name}" is too large (max 25 MB).`;
			continue;
		}
		try {
			attachments.value = [...attachments.value, await readFileAsAttachment(file)];
		} catch {
			errorMsg.value = `Could not read "${file.name}".`;
		}
	}
}

function removeAttachment(id: string): void {
	attachments.value = attachments.value.filter((a) => a.id !== id);
}

function openFilePicker(): void {
	if (isInputDisabled.value) return;
	fileInputRef.value?.click();
}

function onFileChange(event: Event): void {
	const input = event.target as HTMLInputElement;
	if (input.files !== null) void addFiles(input.files);
	// Reset so selecting the same file again re-triggers change.
	input.value = "";
}

function onPaste(event: ClipboardEvent): void {
	const files = event.clipboardData?.files;
	if (files === undefined || files.length === 0) return;
	event.preventDefault();
	void addFiles(files);
}

function hasFiles(event: DragEvent): boolean {
	return event.dataTransfer?.types.includes("Files") ?? false;
}

function onDragEnter(event: DragEvent): void {
	if (isInputDisabled.value || !hasFiles(event)) return;
	dragDepth.value += 1;
	isDragging.value = true;
}

function onDragOver(event: DragEvent): void {
	if (isInputDisabled.value || !hasFiles(event)) return;
	event.preventDefault();
}

function onDragLeave(): void {
	if (dragDepth.value === 0) return;
	dragDepth.value -= 1;
	if (dragDepth.value === 0) isDragging.value = false;
}

function onDrop(event: DragEvent): void {
	dragDepth.value = 0;
	isDragging.value = false;
	if (isInputDisabled.value) return;
	const files = event.dataTransfer?.files;
	if (files === undefined || files.length === 0) return;
	event.preventDefault();
	void addFiles(files);
}

function submitDraft(): void {
	if (isSendDisabled.value) return;
	const content = draft.value;
	emit("submit", content, attachments.value);
	draft.value = "";
	attachments.value = [];
	errorMsg.value = "";
	void nextTick(autoGrow);
}

function onStop(): void {
	emit("stop");
}

function shouldSubmitOnKey(event: KeyboardEvent): boolean {
	if (event.key !== SEND_HOTKEY) return false;
	if (event[NEWLINE_HOTKEY_MODIFIER]) return false;
	return true;
}

function onKeydown(event: KeyboardEvent): void {
	if (!shouldSubmitOnKey(event)) return;
	event.preventDefault();
	submitDraft();
}
</script>

<template>
	<form
		class="composer"
		:class="{ 'composer-dragging': isDragging }"
		@submit.prevent="submitDraft"
		@dragenter="onDragEnter"
		@dragover="onDragOver"
		@dragleave="onDragLeave"
		@drop="onDrop"
	>
		<div v-if="isDragging" class="composer-dropzone">
			<UIcon :name="ATTACH_ICON" class="size-[18px]" />
			Drop files to attach
		</div>

		<ul v-if="attachments.length > 0" class="composer-chips">
			<li v-for="att in attachments" :key="att.id" class="chip">
				<img
					v-if="isInlineImage(att.mimeType) && att.dataUrl"
					:src="att.dataUrl"
					:alt="att.name"
					class="chip-thumb"
				/>
				<UIcon v-else :name="ATTACH_FILE_ICON" class="chip-ic size-[16px]" />
				<span class="chip-meta">
					<span class="chip-name">{{ att.name }}</span>
					<span class="chip-size">{{ formatBytes(att.size) }}</span>
				</span>
				<button
					type="button"
					class="chip-remove"
					:aria-label="`Remove ${att.name}`"
					title="Remove"
					@click="removeAttachment(att.id)"
				>
					<UIcon :name="ATTACH_REMOVE_ICON" class="size-[13px]" />
				</button>
			</li>
		</ul>

		<p v-if="errorMsg" class="composer-error" role="alert">{{ errorMsg }}</p>

		<div class="composer-field">
			<textarea
				ref="textareaRef"
				v-model="draft"
				class="composer-input"
				:placeholder="isRunning ? 'Queue a follow-up message…' : 'Ask AntelopeJS to modify this page'"
				rows="1"
				aria-label="message input"
				:disabled="isInputDisabled"
				@keydown="onKeydown"
				@input="autoGrow"
				@paste="onPaste"
			/>
			<button
				type="button"
				class="composer-attach"
				:aria-label="ATTACH_LABEL"
				:title="ATTACH_LABEL"
				:disabled="isInputDisabled"
				@click="openFilePicker"
			>
				<UIcon :name="ATTACH_ICON" class="size-[17px]" />
			</button>
		</div>

		<input
			ref="fileInputRef"
			type="file"
			multiple
			class="composer-fileinput"
			aria-hidden="true"
			tabindex="-1"
			@change="onFileChange"
		/>

		<div class="composer-sendrow">
			<div class="composer-mode">
				<div class="composer-toggle" role="group" aria-label="Generation mode">
					<div class="mode-opt">
						<button
							type="button"
							class="seg"
							:class="{ 'seg-active': activeMode === 'safe', 'seg-disabled': !builderAvailable }"
							aria-describedby="composer-tip-safe"
							:aria-disabled="!builderAvailable"
							@click="selectGeneration('safe')"
						>
							<svg class="seg-ic" viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z"/></svg>
							Safe code
						</button>
						<div id="composer-tip-safe" class="composer-tip" role="tooltip">
							<b>Safe code</b>
							<p>Acts only through the Builder (MCP) — emits configurations it accepts, never raw code. Predictable diffs, safer deploys.</p>
							<p v-if="!builderAvailable" class="tip-note">Safe code unlocks once the Builder module is loaded.</p>
						</div>
					</div>
					<div class="mode-opt">
						<button
							type="button"
							class="seg"
							:class="{ 'seg-active': activeMode === 'vibe' }"
							aria-describedby="composer-tip-vibe"
							@click="selectGeneration('vibe')"
						>
							<svg class="seg-ic" viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m21.64 3.64-1.28-1.28a1.21 1.21 0 0 0-1.72 0L2.36 18.64a1.21 1.21 0 0 0 0 1.72l1.28 1.28a1.2 1.2 0 0 0 1.72 0L21.64 5.36a1.2 1.2 0 0 0 0-1.72Z"/><path d="m14 7 3 3"/><path d="M5 6v4"/><path d="M19 14v4"/><path d="M10 2v2"/><path d="M7 8H3"/><path d="M21 16h-4"/><path d="M11 3H9"/></svg>
							Vibe code
						</button>
						<div id="composer-tip-vibe" class="composer-tip" role="tooltip">
							<b>Vibe code</b>
							<p>Free to write custom code and bespoke pages beyond the Builder's blocks — full creative range.</p>
						</div>
					</div>
				</div>
			</div>
			<div class="composer-actions">
				<button
					v-if="isRunning"
					type="button"
					class="composer-stop"
					title="Stop"
					aria-label="Stop"
					:disabled="isDisabled"
					@click="onStop"
				>
					<svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor" stroke="none"><rect x="6" y="6" width="12" height="12" rx="2"/></svg>
				</button>
				<button
					type="submit"
					class="composer-send"
					:disabled="isSendDisabled"
					:title="isRunning ? 'Queue to send after the current turn' : 'Send'"
					aria-label="Send"
				>
					<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>
				</button>
			</div>
		</div>
	</form>
</template>

<style scoped>
.composer {
	position: relative;
	border-top: 1px solid var(--hair);
	padding: 12px 14px 14px;
	background: var(--surface-side);
}

.composer-dragging {
	outline: 2px dashed var(--accent-bg-strong);
	outline-offset: -6px;
}

.composer-dropzone {
	position: absolute;
	inset: 4px;
	z-index: 20;
	display: flex;
	align-items: center;
	justify-content: center;
	gap: 8px;
	border-radius: var(--radius-lg);
	background: color-mix(in oklab, var(--surface-side) 88%, transparent);
	color: var(--accent);
	font-size: 13px;
	font-weight: 600;
	pointer-events: none;
}

.composer-fileinput {
	display: none;
}

.composer-chips {
	list-style: none;
	margin: 0 0 8px;
	padding: 0;
	display: flex;
	flex-wrap: wrap;
	gap: 6px;
}

.chip {
	display: inline-flex;
	align-items: center;
	gap: 7px;
	max-width: 220px;
	padding: 4px 6px 4px 5px;
	background: var(--surface-inset);
	border: 1px solid var(--hair);
	border-radius: var(--radius-md);
}

.chip-thumb {
	width: 28px;
	height: 28px;
	flex: 0 0 auto;
	object-fit: cover;
	border-radius: 5px;
}

.chip-ic {
	flex: 0 0 auto;
	color: var(--fg-tertiary);
	margin-left: 3px;
}

.chip-meta {
	display: flex;
	flex-direction: column;
	min-width: 0;
	line-height: 1.25;
}

.chip-name {
	font-size: 12px;
	font-weight: 500;
	color: var(--fg);
	white-space: nowrap;
	overflow: hidden;
	text-overflow: ellipsis;
}

.chip-size {
	font-size: 10px;
	color: var(--fg-tertiary);
}

.chip-remove {
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

.chip-remove:hover {
	background: var(--danger-bg);
	color: var(--danger-400);
}

.composer-error {
	margin: 0 0 8px;
	font-size: 11.5px;
	color: var(--danger-400);
}

/* Sits inside the input field, bottom-right of the textarea. */
.composer-attach {
	width: 26px;
	height: 26px;
	flex: 0 0 auto;
	align-self: flex-end;
	display: grid;
	place-items: center;
	border: none;
	background: transparent;
	border-radius: var(--radius-sm);
	color: var(--fg-tertiary);
	cursor: pointer;
	transition:
		background var(--dur-fast),
		color var(--dur-fast);
}

.composer-attach:hover:not(:disabled) {
	background: var(--surface-card-2);
	color: var(--fg);
}

.composer-attach:disabled {
	opacity: 0.4;
	cursor: not-allowed;
}

.composer-field {
	display: flex;
	align-items: flex-end;
	gap: 6px;
	background: var(--surface-inset);
	border: 1px solid var(--hair);
	border-radius: var(--radius-lg);
	padding: 8px 10px;
}

.composer-field:focus-within {
	border-color: var(--accent-bg-strong);
}

.composer-input {
	flex: 1;
	resize: none;
	background: transparent;
	border: none;
	outline: none;
	color: var(--fg);
	font: inherit;
	font-size: 13.5px;
	line-height: 1.4;
	min-height: 22px;
	max-height: 160px;
	overflow-y: auto;
}

.composer-input::placeholder {
	color: var(--fg-tertiary);
}

.composer-sendrow {
	display: flex;
	align-items: center;
	gap: 10px;
	margin-top: 10px;
}

.composer-mode {
	position: relative;
}

.composer-toggle {
	display: inline-flex;
	gap: 2px;
	padding: 3px;
	background: var(--surface-inset);
	border: 1px solid var(--hair);
	border-radius: var(--radius-md);
}

.mode-opt {
	display: inline-flex;
}

.seg {
	display: inline-flex;
	align-items: center;
	gap: 6px;
	height: 30px;
	padding: 0 12px;
	border: none;
	background: transparent;
	border-radius: var(--radius-sm);
	font: inherit;
	font-size: 12px;
	font-weight: 600;
	color: var(--fg-tertiary);
	cursor: pointer;
	transition: background var(--dur-fast), color var(--dur-fast);
}

.seg-ic {
	flex: 0 0 auto;
}

.seg-active {
	background: var(--accent);
	color: var(--accent-fg);
}

.seg-disabled {
	opacity: 0.45;
	cursor: not-allowed;
}

.composer-tip {
	position: absolute;
	bottom: calc(100% + 10px);
	left: 0;
	z-index: 10;
	width: 268px;
	max-width: 78vw;
	padding: 13px 14px;
	background: var(--surface-card);
	border: 1px solid var(--hair-strong);
	border-radius: var(--radius-lg);
	box-shadow: 0 10px 30px -8px rgba(0, 0, 0, 0.35);
	opacity: 0;
	visibility: hidden;
	transform: translateY(4px);
	transition:
		opacity var(--dur-fast),
		transform var(--dur-fast),
		visibility var(--dur-fast);
	pointer-events: none;
}

.mode-opt:hover .composer-tip,
.mode-opt:focus-within .composer-tip {
	opacity: 1;
	visibility: visible;
	transform: none;
}

.composer-tip b {
	display: block;
	margin-bottom: 5px;
	font-size: 12.5px;
	color: var(--fg);
}

.composer-tip p {
	margin: 0 0 8px;
	font-size: 12px;
	line-height: 1.5;
	color: var(--fg-tertiary);
}

.composer-tip p:last-child {
	margin-bottom: 0;
}

.composer-tip .tip-note {
	padding: 7px 9px;
	border: 1px solid color-mix(in oklab, var(--warning-400) 30%, transparent);
	border-radius: 7px;
	background: var(--warning-bg);
	font-size: 11px;
	line-height: 1.45;
	color: var(--warning-400);
}

.composer-actions {
	margin-left: auto;
	display: flex;
	align-items: center;
	gap: 8px;
}

.composer-send {
	width: 40px;
	height: 40px;
	flex: 0 0 auto;
	display: grid;
	place-items: center;
	border: none;
	border-radius: var(--radius-md);
	background: var(--accent);
	color: var(--accent-fg);
	cursor: pointer;
}

.composer-send:hover:not(:disabled) {
	background: var(--accent-strong);
}

.composer-send:disabled {
	opacity: 0.4;
	cursor: not-allowed;
}

.composer-stop {
	width: 40px;
	height: 40px;
	flex: 0 0 auto;
	display: grid;
	place-items: center;
	border: 1px solid var(--hair);
	border-radius: var(--radius-md);
	background: var(--surface-card-2);
	color: var(--fg);
	cursor: pointer;
}

.composer-stop:hover:not(:disabled) {
	background: var(--danger-bg);
	border-color: color-mix(in srgb, var(--danger-400) 35%, transparent);
	color: var(--danger-400);
}

.composer-stop:disabled {
	opacity: 0.4;
	cursor: not-allowed;
}
</style>
