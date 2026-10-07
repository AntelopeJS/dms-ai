<script setup lang="ts">
import { computed } from "vue";
import type { SkillRow } from "../views/types";
import { skillLook } from "../views/utils/skills";

interface Props {
	row: SkillRow;
	selected?: boolean;
	open?: () => void;
	actions?: object;
}

const props = withDefaults(defineProps<Props>(), {
	selected: false,
	open: undefined,
	actions: undefined,
});

const { t } = useI18n();

const look = computed(() => skillLook(props.row));
const badge = computed(() =>
	props.row.isShadowed
		? { label: t("dms_ai.views.skills.shadowed"), tone: "warning" as const }
		: {
				label: t(`dms_ai.views.skills.source.${props.row.source}`),
				tone: look.value.badgeTone,
			},
);
const uses = computed(() =>
	props.row.uses30d > 0
		? t(
				"dms_ai.views.skills.uses",
				{ count: props.row.uses30d },
				props.row.uses30d,
			)
		: t("dms_ai.views.skills.never_used"),
);
</script>

<template>
	<DmsRecordCard
		:icon="look.icon"
		:tone="look.tone"
		:title="props.row.name"
		:subtitle="props.row.origin"
		:badge="badge"
		:description="props.row.description"
		:tags="props.row.tags"
		:meta="uses"
		:selected="props.selected"
		:muted="props.row.isShadowed"
		interactive
		@open="props.open?.()"
	/>
</template>
