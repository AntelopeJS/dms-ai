<script setup lang="ts">
import { onMounted, ref } from "vue";

interface ActivityItem {
	id: string;
	timestampMs: number;
	toolName: string;
	status: "success" | "error" | "pending";
	conversationId: string;
	conversationTitle: string;
	summary: string;
}

const { $authFetch } = useAuthFetch();

const items = ref<ActivityItem[]>([]);
const loading = ref(false);
const error = ref<string | null>(null);

async function load(): Promise<void> {
	loading.value = true;
	error.value = null;
	try {
		const activity = await $authFetch<{ items: ActivityItem[] }>(
			"/ai/activity?limit=50",
		);
		items.value = activity.items ?? [];
	} catch (e) {
		error.value = e instanceof Error ? e.message : String(e);
	} finally {
		loading.value = false;
	}
}

onMounted(load);

const STATUS_COLOR: Record<ActivityItem["status"], string> = {
	success: "success",
	error: "error",
	pending: "warning",
};

function formatTime(ms: number): string {
	return new Date(ms).toLocaleString();
}
</script>

<template>
	<div class="flex w-full flex-col gap-4 pb-10">
		<div
			v-if="error"
			class="border-error bg-error/10 text-error rounded border p-4 text-sm"
		>
			{{ error }}
		</div>

		<div v-else class="border-default rounded border">
			<div v-if="loading" class="text-dimmed p-4 text-sm">
				Loading activity…
			</div>
			<div
				v-else-if="items.length === 0"
				class="text-dimmed p-6 text-center text-sm"
			>
				No AI actions recorded yet.
			</div>
			<ul v-else class="divide-default divide-y">
				<li
					v-for="item in items"
					:key="item.id"
					class="flex items-start gap-3 p-3"
				>
					<UIcon name="i-ph-wrench" class="text-dimmed mt-1" />
					<div class="min-w-0 flex-1">
						<div class="flex items-center gap-2">
							<span class="font-medium">{{ item.toolName }}</span>
							<UBadge
								:color="STATUS_COLOR[item.status]"
								variant="subtle"
								size="sm"
							>
								{{ item.status }}
							</UBadge>
						</div>
						<p class="text-muted truncate text-sm">{{ item.summary }}</p>
						<p class="text-dimmed text-xs">
							{{ item.conversationTitle }} · {{ formatTime(item.timestampMs) }}
						</p>
					</div>
				</li>
			</ul>
		</div>
	</div>
</template>
