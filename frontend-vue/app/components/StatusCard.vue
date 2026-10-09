<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from "vue";
import { useAiRequest } from "../views/composables/useAiRequest";
import { useAssistant } from "../views/composables/useAssistant";
import { useStatusFacts } from "../views/composables/useStatusFacts";
import { useViewFormat } from "../views/composables/useViewFormat";
import {
	AI_PAGES,
	AI_ROUTES,
	STATUS_POLL_INTERVAL_MS,
} from "../views/constants";
import type { AssistantStatus } from "../views/types";

const { t } = useI18n();
const { $authFetch } = useAuthFetch();
const assistant = useAssistant();
const { serverMessage } = useViewFormat();
const request = useAiRequest<AssistantStatus>();
const isRestarting = ref(false);

let timer: ReturnType<typeof setInterval> | undefined;

function load(): Promise<AssistantStatus | null> {
	return request.run(() => $authFetch<AssistantStatus>(AI_ROUTES.status));
}

function poll(): void {
	if (document.visibilityState === "hidden") return;
	void load();
}

onMounted(() => {
	void load();
	timer = setInterval(poll, STATUS_POLL_INTERVAL_MS);
});
onBeforeUnmount(() => clearInterval(timer));

async function restart(): Promise<void> {
	isRestarting.value = true;
	try {
		await request.run(() =>
			$authFetch<AssistantStatus>(AI_ROUTES.restart, { method: "POST" }),
		);
	} finally {
		isRestarting.value = false;
	}
}

const status = computed(() => request.data.value);
const isOffline = computed(() => request.failure.value !== null);
const isFirstLoad = computed(() => !status.value && !isOffline.value);
const { title, facts } = useStatusFacts(status);

const pendingApprovals = computed(() => status.value?.pendingApprovals ?? 0);
const offlineDescription = computed(() =>
	request.failure.value === "unavailable"
		? t("dms_ai.views.status.offline_description")
		: serverMessage(request.message.value),
);
</script>

<template>
	<section
		class="dms-card border-(--dms-assistant-line) bg-linear-100 from-(--dms-assistant-tint) grid grid-cols-[auto_minmax(0,1fr)] items-center gap-4 to-transparent to-55% px-5 py-[18px] md:grid-cols-[auto_minmax(0,1fr)_auto]"
		:aria-busy="isFirstLoad || request.isLoading.value"
		data-ai-status-card
	>
		<span
			class="grid size-11 place-items-center rounded-xl text-[22px] ring-1 ring-inset"
			:class="
				isOffline
					? 'bg-error/10 text-error ring-error/30'
					: 'text-secondary bg-(--dms-assistant-tint) ring-(--dms-assistant-line) shadow-[0_0_24px_-4px_var(--ui-secondary)]'
			"
			aria-hidden="true"
		>
			<UIcon v-if="isOffline" name="i-ph-plugs" class="size-6" />
			<template v-else>✦</template>
		</span>

		<div v-if="isFirstLoad" class="flex flex-col gap-2">
			<USkeleton class="h-5 w-72" />
			<USkeleton class="h-3 w-96 max-w-full" />
		</div>
		<div v-else-if="isOffline" class="min-w-0">
			<p
				class="text-highlighted text-lg font-[650] leading-tight tracking-[-0.02em]"
			>
				{{ t("dms_ai.views.status.offline") }}
			</p>
			<p class="text-muted mt-1.5 text-[13px]">{{ offlineDescription }}</p>
		</div>
		<div v-else-if="status" class="min-w-0">
			<p
				class="text-highlighted text-lg font-[650] leading-tight tracking-[-0.02em]"
				role="status"
			>
				{{ title }}
			</p>
			<ul
				class="text-muted mt-1.5 flex flex-wrap gap-x-4 gap-y-1.5 font-mono text-[11.5px] font-medium"
			>
				<li
					v-for="fact in facts"
					:key="fact.id"
					class="inline-flex items-center gap-[5px]"
				>
					<UIcon
						:name="fact.icon"
						class="size-3.5 shrink-0"
						:class="fact.iconClass"
						:aria-hidden="true"
					/>
					{{ fact.label }}
					<b class="text-toned font-semibold">{{ fact.value }}</b>
				</li>
			</ul>
			<p v-if="status.lastError" class="text-error mt-1.5 text-xs">
				{{ t("dms_ai.views.status.last_error", { error: status.lastError }) }}
			</p>
		</div>

		<div class="col-span-2 flex flex-wrap gap-2 md:col-span-1 md:justify-end">
			<UButton
				v-if="isOffline"
				icon="i-ph-arrows-clockwise"
				color="secondary"
				:loading="isRestarting"
				:label="t('dms_ai.views.status.restart')"
				@click="restart"
			/>
			<template v-else-if="assistant.isAvailable">
				<UButton
					v-if="pendingApprovals > 0"
					icon="i-ph-hand-palm"
					color="neutral"
					variant="outline"
					:label="
						t(
							'dms_ai.views.status.review_approvals',
							{ count: pendingApprovals },
							pendingApprovals,
						)
					"
					:ui="{ leadingIcon: 'text-warning' }"
					@click="assistant.openPanel()"
				/>
				<UButton
					icon="i-ph-sparkle"
					color="secondary"
					:label="t('dms_ai.views.common.open_assistant')"
					@click="assistant.openPanel()"
				/>
			</template>
			<UButton
				icon="i-ph-gear-six"
				color="neutral"
				variant="ghost"
				:label="t('dms_ai.views.status.settings')"
				@click="assistant.goTo(AI_PAGES.settings)"
			/>
		</div>
	</section>
</template>
