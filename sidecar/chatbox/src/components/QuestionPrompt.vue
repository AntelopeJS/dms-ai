<script setup lang="ts">
import { computed, reactive } from "vue";
import type { QuestionRequestData } from "../types/question";

interface Props {
	requests: QuestionRequestData[];
}

const props = defineProps<Props>();
const emit = defineEmits<{
	answer: [requestId: string, answers: string[]];
}>();

interface Selection {
	mode: "option" | "other";
	option: string;
	other: string;
}

// Per-(request, question) selection, keyed so multiple queued requests stay
// independent. New keys are added reactively on first interaction.
const state = reactive<Record<string, Selection>>({});

function keyOf(requestId: string, qIndex: number): string {
	return `${requestId}#${qIndex}`;
}

function entryOf(requestId: string, qIndex: number): Selection {
	const key = keyOf(requestId, qIndex);
	const existing = state[key];
	if (existing !== undefined) return existing;
	const fresh: Selection = { mode: "option", option: "", other: "" };
	state[key] = fresh;
	return fresh;
}

function answerFor(requestId: string, qIndex: number): string {
	const entry = state[keyOf(requestId, qIndex)];
	if (entry === undefined) return "";
	return entry.mode === "other" ? entry.other.trim() : entry.option;
}

function isOptionSelected(
	requestId: string,
	qIndex: number,
	label: string,
): boolean {
	const entry = state[keyOf(requestId, qIndex)];
	return entry?.mode === "option" && entry.option === label;
}

function isOtherActive(requestId: string, qIndex: number): boolean {
	return state[keyOf(requestId, qIndex)]?.mode === "other";
}

function pickOption(requestId: string, qIndex: number, label: string): void {
	const entry = entryOf(requestId, qIndex);
	entry.mode = "option";
	entry.option = label;
}

function pickOther(requestId: string, qIndex: number): void {
	entryOf(requestId, qIndex).mode = "other";
}

function onOtherInput(
	requestId: string,
	qIndex: number,
	event: Event,
): void {
	entryOf(requestId, qIndex).other = (event.target as HTMLInputElement).value;
}

const answerableById = computed<Record<string, boolean>>(() => {
	const out: Record<string, boolean> = {};
	for (const req of props.requests) {
		out[req.requestId] = req.questions.every(
			(_q, qi) => answerFor(req.requestId, qi).length > 0,
		);
	}
	return out;
});

function submit(req: QuestionRequestData): void {
	if (!answerableById.value[req.requestId]) return;
	const answers = req.questions.map((_q, qi) => answerFor(req.requestId, qi));
	emit("answer", req.requestId, answers);
}
</script>

<template>
	<section class="q-tray" role="group" aria-label="Question from the assistant">
		<article v-for="req in requests" :key="req.requestId" class="q-card">
			<div
				v-for="(question, qi) in req.questions"
				:key="qi"
				class="q-block"
			>
				<span class="q-header">{{ question.header }}</span>
				<p class="q-question">{{ question.question }}</p>

				<div class="q-options">
					<button
						v-for="option in question.options"
						:key="option.label"
						type="button"
						class="q-option"
						:data-selected="isOptionSelected(req.requestId, qi, option.label)"
						:title="option.description"
						@click="pickOption(req.requestId, qi, option.label)"
					>
						<span class="q-option-label">{{ option.label }}</span>
						<span class="q-option-desc">{{ option.description }}</span>
					</button>

					<div class="q-other">
						<button
							type="button"
							class="q-option q-other-toggle"
							:data-selected="isOtherActive(req.requestId, qi)"
							@click="pickOther(req.requestId, qi)"
						>
							<span class="q-option-label">Other…</span>
						</button>
						<input
							v-if="isOtherActive(req.requestId, qi)"
							type="text"
							class="q-other-input"
							placeholder="Type a custom answer"
							@input="onOtherInput(req.requestId, qi, $event)"
							@keydown.enter.prevent="submit(req)"
						/>
					</div>
				</div>
			</div>

			<footer class="q-actions">
				<button
					type="button"
					class="q-send"
					:disabled="!answerableById[req.requestId]"
					@click="submit(req)"
				>
					Send answer
				</button>
			</footer>
		</article>
	</section>
</template>

<style scoped>
.q-tray {
	display: flex;
	flex-direction: column;
	gap: 8px;
	padding: 10px 12px;
	border-top: 1px solid var(--hair-strong);
	background: var(--surface-inset);
	max-height: 52vh;
	overflow-y: auto;
}

.q-card {
	display: flex;
	flex-direction: column;
	gap: 12px;
	padding: 12px;
	border: 1px solid var(--hair);
	border-radius: var(--radius-md);
	background: var(--surface-card);
}

.q-block {
	display: flex;
	flex-direction: column;
	gap: 6px;
}

.q-header {
	font-size: 11px;
	font-weight: 700;
	letter-spacing: 0.04em;
	text-transform: uppercase;
	color: var(--fg-tertiary);
}

.q-question {
	margin: 0;
	font-size: 13px;
	line-height: 1.4;
	color: var(--fg);
	word-break: break-word;
}

.q-options {
	display: flex;
	flex-direction: column;
	gap: 6px;
}

.q-option {
	display: flex;
	flex-direction: column;
	gap: 2px;
	text-align: left;
	padding: 8px 10px;
	border-radius: var(--radius-md);
	border: 1px solid var(--hair);
	background: var(--surface-inset);
	color: var(--fg);
	font: inherit;
	cursor: pointer;
}

.q-option:hover {
	background: var(--surface-card-2);
}

.q-option[data-selected="true"] {
	border-color: var(--accent);
	background: var(--accent-bg);
}

.q-option-label {
	font-size: 12.5px;
	font-weight: 600;
	color: var(--fg);
}

.q-option-desc {
	font-size: 11.5px;
	line-height: 1.35;
	color: var(--fg-secondary);
	word-break: break-word;
}

.q-other {
	display: flex;
	flex-direction: column;
	gap: 6px;
}

.q-other-input {
	padding: 7px 10px;
	border-radius: var(--radius-md);
	border: 1px solid var(--hair);
	background: var(--surface-inset);
	color: var(--fg);
	font: inherit;
	font-size: 12.5px;
}

.q-other-input:focus {
	outline: none;
	border-color: var(--accent);
}

.q-actions {
	display: flex;
	justify-content: flex-end;
}

.q-send {
	padding: 6px 14px;
	border-radius: var(--radius-md);
	border: 1px solid transparent;
	background: var(--accent);
	color: var(--accent-fg);
	font: inherit;
	font-size: 12px;
	font-weight: 600;
	cursor: pointer;
}

.q-send:hover:not(:disabled) {
	background: var(--accent-strong);
}

.q-send:disabled {
	opacity: 0.5;
	cursor: not-allowed;
}
</style>
