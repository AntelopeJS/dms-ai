<script setup lang="ts">
import { computed, ref } from "vue";
import { useViewFormat } from "./composables/useViewFormat";
import type { ChangeSetSummary, UndoPreview } from "./types";
import { splitPath } from "./utils/diff";
import {
	conflictingFiles,
	defaultUndoChoice,
	formatSetNumbers,
	hasConflicts,
	planUndo,
	type UndoChoice,
	type UndoPlan,
} from "./utils/undo";

interface Props {
	changeSet: ChangeSetSummary;
	preview: UndoPreview;
	/** Sends the undo; a rejection keeps the dialog open with its message. */
	undo: (plan: UndoPlan) => Promise<void>;
}

const props = defineProps<Props>();
const emit = defineEmits<{ close: [confirmed: boolean] }>();

const { t, locale } = useI18n();
const { moment } = useViewFormat();

const choice = ref<UndoChoice>(defaultUndoChoice(props.preview));
const plan = computed(() =>
	planUndo(props.preview, props.changeSet.number, choice.value),
);
const isConflicting = computed(() => hasConflicts(props.preview));

const laterNumbers = computed(() =>
	formatSetNumbers(
		props.preview.conflicts.map((conflict) => conflict.number),
		locale.value,
	),
);
const allNumbers = computed(() =>
	formatSetNumbers(
		[
			props.changeSet.number,
			...props.preview.conflicts.map((conflict) => conflict.number),
		],
		locale.value,
	),
);
const sharedFiles = computed(() =>
	conflictingFiles(props.preview)
		.map((path) => splitPath(path).name)
		.join(", "),
);

const choices = computed(() => [
	{
		value: "together",
		label: t("dms_ai.views.undo.together", { sets: allNumbers.value }),
		description: t("dms_ai.views.undo.together_hint"),
	},
	{
		value: "only",
		label: t("dms_ai.views.undo.only", {
			number: props.changeSet.number,
			later: laterNumbers.value,
		}),
		description: t("dms_ai.views.undo.only_hint"),
	},
]);

const confirmLabel = computed(() =>
	plan.value.count > 1
		? t("dms_ai.views.undo.confirm_many", { count: plan.value.count })
		: t("dms_ai.views.undo.confirm_one"),
);

const description = computed(() =>
	t(
		"dms_ai.views.undo.description",
		{
			count: props.preview.files.length,
			when: moment(props.changeSet.createdAtMs),
		},
		props.preview.files.length,
	),
);

async function confirm(): Promise<void> {
	await props.undo(plan.value);
}
</script>

<template>
	<DmsConfirmModal
		:title="t('dms_ai.views.undo.title', { number: props.changeSet.number })"
		:description="description"
		color="secondary"
		icon="i-ph-arrow-counter-clockwise"
		confirm-icon="i-ph-arrow-counter-clockwise"
		:confirm-label="confirmLabel"
		:cancel-label="t('dms_ai.views.common.cancel')"
		initial-focus="confirm"
		:on-confirm="confirm"
		@close="(confirmed: boolean) => emit('close', confirmed)"
	>
		<template #body>
			<div v-if="isConflicting" class="flex flex-col gap-3">
				<UAlert
					color="warning"
					variant="subtle"
					icon="i-ph-warning"
					:title="
						t(
							'dms_ai.views.undo.conflict_title',
							{ count: props.preview.conflicts.length },
							props.preview.conflicts.length,
						)
					"
					:description="
						t('dms_ai.views.undo.conflict_description', {
							sets: laterNumbers,
							files: sharedFiles,
						})
					"
				/>
				<URadioGroup
					v-model="choice"
					:items="choices"
					color="secondary"
					:aria-label="t('dms_ai.views.undo.choice_label')"
				/>
			</div>
			<p v-else class="text-muted text-[13px]">
				{{ t("dms_ai.views.undo.no_conflict") }}
			</p>
		</template>
	</DmsConfirmModal>
</template>
