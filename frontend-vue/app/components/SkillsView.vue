<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'

interface SkillItem {
	id: string
	name: string
	description: string
	icon?: string
	category?: string
	tags: string[]
	provenance: string
	body: string
}

const LOCAL_PROVENANCE = 'local'

const { $authFetch } = useAuthFetch()

const items = ref<SkillItem[]>([])
const loading = ref(false)
const error = ref<string | null>(null)
const search = ref('')
const selected = ref<SkillItem | null>(null)

async function load(): Promise<void> {
	loading.value = true
	error.value = null
	try {
		const res = await $authFetch<{ items: SkillItem[] }>('/ai/skills')
		items.value = res.items
	} catch (e) {
		error.value = e instanceof Error ? e.message : String(e)
	} finally {
		loading.value = false
	}
}

onMounted(load)

// Flat list, sorted by provenance then name so skills from the same package
// stay adjacent without a grouping layer.
const filtered = computed(() => {
	const q = search.value.trim().toLowerCase()
	return items.value
		.filter((s) => {
			if (q.length === 0) return true
			const haystack = [s.name, s.description, s.category ?? '', ...s.tags]
				.join(' ')
				.toLowerCase()
			return haystack.includes(q)
		})
		.sort(
			(a, b) =>
				a.provenance.localeCompare(b.provenance) ||
				a.name.localeCompare(b.name),
		)
})

function isLocal(provenance: string): boolean {
	return provenance === LOCAL_PROVENANCE
}

function open(skill: SkillItem): void {
	selected.value = skill
}

function close(): void {
	selected.value = null
}

const CARD_CLASS =
	'flex flex-col gap-2 rounded-xl border border-default bg-elevated/30 p-4 text-left transition-colors hover:border-primary'
</script>

<template>
	<div class="flex w-full flex-col gap-5 pb-10">
		<div
			v-if="error"
			class="rounded-lg border border-error bg-error/10 p-4 text-sm text-error"
		>
			{{ error }}
		</div>

		<!-- Stat row -->
		<div class="grid gap-4 sm:grid-cols-2">
			<div class="rounded-xl border border-default bg-elevated/30 p-4">
				<p class="text-xs font-medium text-toned">Total skills</p>
				<p class="mt-1 text-2xl font-semibold text-highlighted">
					{{ items.length }}
				</p>
			</div>
		</div>

		<!-- Controls -->
		<div class="flex flex-wrap items-center gap-3">
			<input
				v-model="search"
				type="search"
				placeholder="Search skills…"
				class="w-full max-w-xs rounded-md border border-default bg-elevated px-3 py-2 text-sm"
			>
		</div>

		<p
			v-if="!loading && items.length === 0"
			class="rounded-lg border border-default bg-elevated/30 p-6 text-center text-sm text-dimmed"
		>
			No skills are loaded. Module-contributed skills appear here, plus
			machine-local skills when enabled in Settings.
		</p>

		<!-- Skill cards -->
		<div class="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
			<button
				v-for="skill in filtered"
				:key="skill.id"
				type="button"
				:class="CARD_CLASS"
				@click="open(skill)"
			>
				<div class="flex items-start gap-2">
					<UIcon
						:name="skill.icon || 'i-ph-sparkle'"
						class="mt-0.5 shrink-0 text-primary"
					/>
					<div class="min-w-0">
						<p class="truncate text-sm font-semibold text-highlighted">
							{{ skill.name }}
						</p>
						<p class="truncate text-xs text-dimmed">
							{{ skill.provenance }}
						</p>
					</div>
					<UBadge
						v-if="isLocal(skill.provenance)"
						class="ml-auto shrink-0"
						color="warning"
						variant="subtle"
						size="sm"
					>
						Local
					</UBadge>
				</div>
				<p class="line-clamp-3 text-xs leading-relaxed text-toned">
					{{ skill.description }}
				</p>
				<div v-if="skill.tags.length" class="mt-auto flex flex-wrap gap-1">
					<UBadge
						v-for="tag in skill.tags"
						:key="tag"
						color="neutral"
						variant="soft"
						size="sm"
					>
						{{ tag }}
					</UBadge>
				</div>
			</button>
		</div>

		<!-- Detail drawer -->
		<div
			v-if="selected"
			class="fixed inset-0 z-50 flex justify-end bg-black/40"
			@click.self="close"
		>
			<div
				class="flex h-full w-full max-w-lg flex-col overflow-y-auto border-l border-default bg-default p-6 shadow-xl"
			>
				<div class="mb-4 flex items-start gap-3">
					<UIcon
						:name="selected.icon || 'i-ph-sparkle'"
						class="mt-1 shrink-0 text-xl text-primary"
					/>
					<div class="min-w-0 flex-1">
						<h2 class="text-lg font-semibold text-highlighted">
							{{ selected.name }}
						</h2>
						<p class="text-xs text-dimmed">{{ selected.id }}</p>
					</div>
					<UButton
						icon="i-ph-x"
						color="neutral"
						variant="ghost"
						size="sm"
						square
						@click="close"
					/>
				</div>

				<div class="mb-4 flex flex-wrap items-center gap-2">
					<UBadge color="primary" variant="subtle" size="sm">
						{{ selected.provenance }}
					</UBadge>
					<UBadge
						v-if="isLocal(selected.provenance)"
						color="warning"
						variant="subtle"
						size="sm"
					>
						Local — this machine
					</UBadge>
					<UBadge
						v-for="tag in selected.tags"
						:key="tag"
						color="neutral"
						variant="soft"
						size="sm"
					>
						{{ tag }}
					</UBadge>
				</div>

				<p class="mb-4 text-sm leading-relaxed text-toned">
					{{ selected.description }}
				</p>

				<h3 class="mb-2 text-xs font-semibold uppercase tracking-wide text-dimmed">
					Instructions (SKILL.md)
				</h3>
				<pre
					class="whitespace-pre-wrap rounded-lg border border-default bg-elevated/40 p-4 text-xs leading-relaxed text-toned"
					>{{ selected.body }}</pre
				>
			</div>
		</div>
	</div>
</template>
