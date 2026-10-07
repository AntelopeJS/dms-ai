<script setup lang="ts">
import { computed, onMounted } from "vue";
import { useAiRequest } from "../views/composables/useAiRequest";
import { AI_ROUTES } from "../views/constants";
import type {
	SkillConflict,
	SkillConflictsPayload,
	SkillOrigin,
} from "../views/types";

const { t, locale } = useI18n();
const { $authFetch } = useAuthFetch();
const request = useAiRequest<SkillConflictsPayload>();

onMounted(() => {
	void request.run(() =>
		$authFetch<SkillConflictsPayload>(AI_ROUTES.skillConflicts),
	);
});

const conflicts = computed(() => request.data.value?.conflicts ?? []);

function describeOrigin(origin: SkillOrigin): string {
	return origin.source === "local"
		? t("dms_ai.views.conflicts.local_copy", { origin: origin.origin })
		: t("dms_ai.views.conflicts.module_copy", { origin: origin.origin });
}

function joinOrigins(origins: SkillOrigin[]): string {
	return new Intl.ListFormat(locale.value, {
		style: "long",
		type: "conjunction",
	}).format(origins.map(describeOrigin));
}

function titleOf(conflict: SkillConflict): string {
	const count = conflict.ignored.length + 1;
	return t(
		"dms_ai.views.conflicts.title",
		{ count, name: conflict.name },
		count,
	);
}

function descriptionOf(conflict: SkillConflict): string {
	const count = conflict.ignored.length;
	return t(
		"dms_ai.views.conflicts.description",
		{
			winner: describeOrigin(conflict.winner),
			ignored: joinOrigins(conflict.ignored),
		},
		count,
	);
}
</script>

<template>
	<div v-if="conflicts.length > 0" class="flex flex-col gap-2.5">
		<DmsBanner
			v-for="conflict in conflicts"
			:key="conflict.name"
			tone="warning"
			icon="i-ph-warning"
			:title="titleOf(conflict)"
			:description="descriptionOf(conflict)"
		/>
	</div>
</template>
