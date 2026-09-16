<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'

type Mode = 'normal' | 'acceptEdits' | 'plan' | 'auto'
type Thinking = 'off' | 'low' | 'medium' | 'high'
type GenerationMode = 'safe' | 'vibe'

interface AiSettings {
	mode: Mode
	thinking: Thinking
	generationMode: GenerationMode
	allowLocalSkills: boolean
	builderAvailable: boolean
}

const { $authFetch } = useAuthFetch()

const settings = ref<AiSettings>({
	mode: 'normal',
	thinking: 'medium',
	generationMode: 'safe',
	allowLocalSkills: false,
	builderAvailable: false,
})
const loading = ref(false)
const saving = ref(false)
const error = ref<string | null>(null)

const MODE_OPTIONS: Array<{ value: Mode; label: string; hint: string }> = [
	{ value: 'normal', label: 'Normal', hint: 'Ask before each tool action' },
	{
		value: 'acceptEdits',
		label: 'Accept edits',
		hint: 'Auto-accept file edits, ask for the rest',
	},
	{ value: 'plan', label: 'Plan', hint: 'Plan only — propose without changes' },
	{ value: 'auto', label: 'Auto', hint: 'Auto-approve every tool action' },
]

const THINKING_OPTIONS: Array<{ value: Thinking; label: string }> = [
	{ value: 'off', label: 'Off' },
	{ value: 'low', label: 'Low' },
	{ value: 'medium', label: 'Medium' },
	{ value: 'high', label: 'High' },
]

async function load(): Promise<void> {
	loading.value = true
	error.value = null
	try {
		settings.value = await $authFetch<AiSettings>('/ai/settings')
	} catch (e) {
		error.value = e instanceof Error ? e.message : String(e)
	} finally {
		loading.value = false
	}
}

async function persist(): Promise<void> {
	saving.value = true
	error.value = null
	try {
		settings.value = await $authFetch<AiSettings>('/ai/settings', {
			method: 'PUT',
			body: settings.value,
		})
	} catch (e) {
		error.value = e instanceof Error ? e.message : String(e)
	} finally {
		saving.value = false
	}
}

function onMode(event: Event): void {
	settings.value.mode = (event.target as HTMLSelectElement).value as Mode
	void persist()
}

function onThinking(event: Event): void {
	settings.value.thinking = (event.target as HTMLSelectElement).value as Thinking
	void persist()
}

function onAllowLocalSkills(event: Event): void {
	settings.value.allowLocalSkills = (event.target as HTMLInputElement).checked
	void persist()
}

const activeMode = computed<GenerationMode>(() =>
	settings.value.generationMode === 'safe' && settings.value.builderAvailable
		? 'safe'
		: 'vibe',
)

function onGenerationMode(mode: GenerationMode): void {
	if (mode === 'safe' && !settings.value.builderAvailable) return
	if (mode === settings.value.generationMode) return
	settings.value.generationMode = mode
	void persist()
}

onMounted(load)

const SELECT_CLASS =
	'w-full rounded-md border border-default bg-elevated px-3 py-2 text-sm'
</script>

<template>
	<div class="flex w-full flex-col gap-5 pb-10">
		<div
			v-if="error"
			class="rounded-lg border border-error bg-error/10 p-4 text-sm text-error"
		>
			{{ error }}
		</div>

		<!-- Row 1: Model (left) · Default behavior (right) -->
		<div class="grid gap-5 lg:grid-cols-2">
			<section class="rounded-xl border border-default bg-elevated/30">
				<header class="border-b border-default px-5 py-4">
					<h2 class="text-sm font-semibold text-highlighted">Model</h2>
				</header>
				<div class="flex flex-col gap-4 p-5">
					<div>
						<label class="mb-1.5 block text-xs font-medium text-toned">Provider</label>
						<select :class="SELECT_CLASS" disabled>
							<option>Anthropic (Claude)</option>
						</select>
					</div>
					<div>
						<label class="mb-1.5 block text-xs font-medium text-toned">Model</label>
						<select :class="SELECT_CLASS" disabled>
							<option>Claude Opus 4.x</option>
						</select>
					</div>
				</div>
			</section>

			<section class="rounded-xl border border-default bg-elevated/30">
				<header class="border-b border-default px-5 py-4">
					<h2 class="text-sm font-semibold text-highlighted">Default behavior</h2>
				</header>
				<div class="flex flex-col gap-4 p-5">
					<div>
						<label class="mb-1.5 block text-xs font-medium text-toned">
							Operating mode
						</label>
						<select
							:class="SELECT_CLASS"
							:value="settings.mode"
							:disabled="loading || saving"
							@change="onMode"
						>
							<option
								v-for="option in MODE_OPTIONS"
								:key="option.value"
								:value="option.value"
							>
								{{ option.label }}
							</option>
						</select>
						<p class="mt-1.5 text-xs text-dimmed">
							{{ MODE_OPTIONS.find((o) => o.value === settings.mode)?.hint }}
						</p>
					</div>
					<div>
						<label class="mb-1.5 block text-xs font-medium text-toned">
							Thinking
						</label>
						<select
							:class="SELECT_CLASS"
							:value="settings.thinking"
							:disabled="loading || saving"
							@change="onThinking"
						>
							<option
								v-for="option in THINKING_OPTIONS"
								:key="option.value"
								:value="option.value"
							>
								{{ option.label }}
							</option>
						</select>
					</div>
					<div>
						<label class="flex items-start gap-3">
							<input
								type="checkbox"
								class="mt-0.5 size-4 rounded border-default"
								:checked="settings.allowLocalSkills"
								:disabled="loading || saving"
								@change="onAllowLocalSkills"
							>
							<span>
								<span class="block text-xs font-medium text-toned">
									Use machine-local skills (~/.claude/skills)
								</span>
								<span class="mt-0.5 block text-xs text-dimmed">
									Adds the skills from your machine
									(<code>~/.claude/skills</code>) on top of the ones bundled by
									modules. Machine-local, so not shared with other environments.
									Off by default.
								</span>
							</span>
						</label>
					</div>
				</div>
			</section>
		</div>

		<!-- Row 2: Generation mode (full width) -->
		<section class="rounded-xl border border-default bg-elevated/30">
			<header class="border-b border-default px-5 py-4">
				<h2 class="text-sm font-semibold text-highlighted">Generation mode</h2>
				<p class="mt-0.5 text-xs text-dimmed">Default mode applied to new prompts</p>
			</header>
			<div class="grid gap-4 p-5 sm:grid-cols-2">
				<button
					type="button"
					:disabled="!settings.builderAvailable || loading || saving"
					class="rounded-lg border p-4 text-left transition"
					:class="[
						activeMode === 'safe'
							? 'border-primary bg-primary/10'
							: 'border-default',
						settings.builderAvailable
							? 'cursor-pointer hover:border-primary/60'
							: 'cursor-not-allowed opacity-60',
					]"
					@click="onGenerationMode('safe')"
				>
					<div class="mb-2 flex items-center gap-2">
						<UIcon
							name="i-ph-shield"
							:class="activeMode === 'safe' ? 'text-primary' : 'text-muted'"
						/>
						<b class="text-highlighted">Safe code</b>
						<UBadge
							v-if="activeMode === 'safe'"
							class="ml-auto"
							color="primary"
							variant="subtle"
							size="sm"
						>
							Active
						</UBadge>
						<UBadge
							v-else-if="!settings.builderAvailable"
							class="ml-auto"
							color="neutral"
							variant="subtle"
							size="sm"
						>
							Unavailable
						</UBadge>
					</div>
					<p class="text-xs leading-relaxed text-dimmed">
						Acts only through the Builder (MCP) — emits accepted configurations,
						never raw code.
						<template v-if="!settings.builderAvailable">
							Available once the Builder module is loaded.
						</template>
					</p>
				</button>
				<button
					type="button"
					:disabled="loading || saving"
					class="rounded-lg border p-4 text-left transition"
					:class="
						activeMode === 'vibe'
							? 'border-primary bg-primary/10'
							: 'cursor-pointer border-default hover:border-primary/60'
					"
					@click="onGenerationMode('vibe')"
				>
					<div class="mb-2 flex items-center gap-2">
						<UIcon
							name="i-ph-magic-wand"
							:class="activeMode === 'vibe' ? 'text-primary' : 'text-muted'"
						/>
						<b class="text-highlighted">Vibe code</b>
						<UBadge
							v-if="activeMode === 'vibe'"
							class="ml-auto"
							color="primary"
							variant="subtle"
							size="sm"
						>
							Active
						</UBadge>
					</div>
					<p class="text-xs leading-relaxed text-dimmed">
						Free to write custom code and bespoke pages beyond the Builder
						blocks — full creative range.
					</p>
				</button>
			</div>
		</section>
	</div>
</template>
