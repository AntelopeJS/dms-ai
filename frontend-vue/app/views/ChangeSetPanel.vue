<script setup lang="ts">
import { computed, ref, watch } from "vue";
import DiffView from "./DiffView.vue";
import UndoDialog from "./UndoDialog.vue";
import UnavailableState from "./UnavailableState.vue";
import { useAiRequest } from "./composables/useAiRequest";
import { useAssistant } from "./composables/useAssistant";
import { useChangeSetActions } from "./composables/useChangeSetActions";
import { useViewFormat } from "./composables/useViewFormat";
import { AI_ROUTES } from "./constants";
import type { Tone } from "#dms-ui/app/types/tone";
import type {
	ChangeSetDetail,
	ChangeSetSummary,
	Fact,
	TypecheckOutcome,
	UndoPreview,
} from "./types";

interface Props {
	changeSetId: string;
}

const props = defineProps<Props>();
const emit = defineEmits<{ changed: [] }>();

const { t } = useI18n();
const { $authFetch } = useAuthFetch();
const { moment } = useViewFormat();
const assistant = useAssistant();
const detail = useAiRequest<ChangeSetDetail>();
const actions = useChangeSetActions(() => {
	void load();
	emit("changed");
});

const preview = ref<UndoPreview | null>(null);

function load(): Promise<ChangeSetDetail | null> {
	return detail.run(() =>
		$authFetch<ChangeSetDetail>(
			`${AI_ROUTES.changes}/${encodeURIComponent(props.changeSetId)}`,
		),
	);
}

watch(() => props.changeSetId, load, { immediate: true });

const changeSet = computed<ChangeSetSummary | null>(
	() => detail.data.value?.changeSet ?? null,
);
const isUndone = computed(() => changeSet.value?.state === "undone");

const FACT_COLUMNS = 2;
const TYPECHECK_FACT_TONES: Record<TypecheckOutcome, Tone | undefined> = {
	passed: "success",
	failed: "error",
	skipped: undefined,
};

function factsOf(set: ChangeSetSummary): Fact[] {
	return [
		{
			id: "asked",
			label: t("dms_ai.views.changes.asked_by"),
			value: set.askedBy ?? t("dms_ai.views.common.unknown"),
		},
		{
			id: "agent",
			label: t("dms_ai.views.changes.agent_scope"),
			value: `${t(`dms_ai.views.agent.${set.agent}`)} · ${t(`dms_ai.views.scope.${set.scope}`)}`,
		},
		{
			id: "approvals",
			label: t("dms_ai.views.changes.approvals"),
			value: t("dms_ai.views.changes.approvals_value", {
				needed: set.approvalsNeeded,
				ops: set.builderOps,
			}),
		},
		{
			id: "checks",
			label: t("dms_ai.views.changes.checks"),
			value: t(`dms_ai.views.typecheck.${set.typecheck}`),
			tone: TYPECHECK_FACT_TONES[set.typecheck],
		},
	];
}

const facts = computed(() => (changeSet.value ? factsOf(changeSet.value) : []));

const undoneNote = computed(() => {
	const set = changeSet.value;
	if (!set?.stateChangedAtMs) return t("dms_ai.views.changes.undone");
	const params = { time: moment(set.stateChangedAtMs), by: set.stateChangedBy };
	return set.stateChangedBy
		? t("dms_ai.views.changes.undone_at_by", params)
		: t("dms_ai.views.changes.undone_at", params);
});

const footNote = computed(() => {
	const set = changeSet.value;
	if (!set) return "";
	const count = set.files.length;
	return isUndone.value
		? t("dms_ai.views.changes.redo_note", { count }, count)
		: t("dms_ai.views.changes.undo_note", { count }, count);
});

async function startUndo(): Promise<void> {
	preview.value = await actions.preview(props.changeSetId);
}

function openPage(): void {
	const path = detail.data.value?.pagePath;
	if (path) assistant.goTo(path);
}
</script>

<template>
	<div v-if="detail.failure.value && !changeSet" class="p-4">
		<UnavailableState
			:failure="detail.failure.value"
			:message="detail.message.value"
			@retry="load"
		/>
	</div>
	<div
		v-else-if="!changeSet"
		class="flex flex-col gap-3 p-5"
		:aria-busy="true"
		:aria-label="t('dms_ai.views.common.loading')"
	>
		<USkeleton class="h-3 w-48" />
		<USkeleton class="h-5 w-72" />
		<USkeleton class="mt-4 h-24 w-full" />
		<USkeleton class="h-40 w-full" />
	</div>
	<article v-else :aria-busy="detail.isLoading.value">
		<header class="flex min-h-16 flex-wrap items-start gap-3 px-5 py-3.5">
			<div class="min-w-0 flex-1">
				<p
					class="text-secondary font-mono text-[10.5px] font-semibold uppercase tracking-[0.12em]"
				>
					✦
					{{
						t("dms_ai.views.changes.eyebrow", {
							number: changeSet.number,
							time: moment(changeSet.createdAtMs),
						})
					}}
				</p>
				<h2
					class="text-highlighted mt-1 text-[15px] font-[650]"
					:class="isUndone && 'text-muted line-through'"
				>
					{{ changeSet.title }}
				</h2>
			</div>
			<div class="flex flex-wrap items-center gap-1.5">
				<UButton
					v-if="assistant.isAvailable"
					icon="i-ph-chats-circle"
					color="neutral"
					variant="ghost"
					size="sm"
					:label="t('dms_ai.views.changes.conversation')"
					@click="assistant.openConversation(changeSet.conversationId)"
				/>
				<UButton
					v-if="detail.data.value?.pagePath"
					icon="i-ph-arrow-square-out"
					color="neutral"
					variant="outline"
					size="sm"
					:label="t('dms_ai.views.changes.open_page')"
					@click="openPage"
				/>
				<UButton
					v-if="isUndone"
					icon="i-ph-arrow-clockwise"
					color="neutral"
					variant="outline"
					size="sm"
					:loading="actions.isBusy.value"
					:label="t('dms_ai.views.changes.redo')"
					@click="actions.redo(changeSet)"
				/>
				<UButton
					v-else
					icon="i-ph-arrow-counter-clockwise"
					color="neutral"
					variant="outline"
					size="sm"
					:loading="actions.isBusy.value"
					:label="t('dms_ai.views.changes.undo')"
					@click="startUndo"
				/>
			</div>
		</header>
		<div
			v-if="isUndone || changeSet.overlapped"
			class="flex flex-col gap-2 px-5 pb-3"
		>
			<DmsBanner
				v-if="isUndone"
				size="sm"
				tone="info"
				icon="i-ph-arrow-counter-clockwise"
				:title="undoneNote"
			/>
			<DmsBanner
				v-if="changeSet.overlapped"
				size="sm"
				tone="warning"
				:title="t('dms_ai.views.changes.overlapped')"
			/>
		</div>
		<div class="border-default border-t px-5">
			<DmsKeyValueList :items="facts" :columns="FACT_COLUMNS" dense />
		</div>
		<DiffView :files="detail.data.value?.files ?? []" variant="flush" />
		<footer
			class="border-default text-muted bg-(--dms-bg-muted) flex items-center gap-2 border-t px-5 py-3 text-[12.5px]"
		>
			<UIcon name="i-ph-info" class="size-4 shrink-0" :aria-hidden="true" />
			{{ footNote }}
		</footer>
		<UndoDialog
			v-if="preview"
			:change-set="changeSet"
			:preview="preview"
			:undo="(plan) => actions.undo(changeSet!, plan)"
			@close="preview = null"
		/>
	</article>
</template>
