<script setup lang="ts">
import { computed, onMounted, ref } from "vue";

type Mode = "normal" | "acceptEdits" | "plan" | "auto";
type Thinking = "off" | "low" | "medium" | "high";
type GenerationMode = "safe" | "vibe";
type ProviderName = "claude" | "codex";

interface ProviderAvailability {
	available: boolean;
	reason?: string;
}

interface AiSettings {
	provider: ProviderName;
	mode: Mode;
	thinking: Thinking;
	generationMode: GenerationMode;
	allowLocalSkills: boolean;
	builderAvailable: boolean;
	providers: Record<ProviderName, ProviderAvailability>;
}

const { $authFetch } = useAuthFetch();

const settings = ref<AiSettings>({
	provider: "claude",
	mode: "normal",
	thinking: "medium",
	generationMode: "safe",
	allowLocalSkills: false,
	builderAvailable: false,
	providers: { claude: { available: true }, codex: { available: false } },
});
const loading = ref(false);
const saving = ref(false);
const error = ref<string | null>(null);

const MODE_OPTIONS: Array<{ value: Mode; label: string; hint: string }> = [
	{ value: "normal", label: "Normal", hint: "Ask before each tool action" },
	{
		value: "acceptEdits",
		label: "Accept edits",
		hint: "Auto-accept file edits, ask for the rest",
	},
	{ value: "plan", label: "Plan", hint: "Plan only — propose without changes" },
	{ value: "auto", label: "Auto", hint: "Auto-approve every tool action" },
];

// Safe mode refuses raw edits whatever the mode, and Auto stops short of
// approving everything there, so the mode hint says so while it is active.
const SAFE_MODE_MODE_NOTE =
	"Safe mode: raw edits and shell commands stay blocked, and Auto still asks before other actions.";

interface ProviderOption {
	value: ProviderName;
	label: string;
}

const PROVIDER_OPTIONS: ProviderOption[] = [
	{ value: "claude", label: "Anthropic (Claude)" },
	{ value: "codex", label: "OpenAI (Codex)" },
];

// One control, two meanings: a token budget on Claude, a reasoning effort level
// on Codex, which has no "off" and maps it to its lowest level.
const THINKING_HINTS: Record<ProviderName, string> = {
	claude: "Thinking budget handed to the model.",
	codex:
		'Reasoning effort handed to the model. Codex has no "off": it maps to the lowest level.',
};

const THINKING_OPTIONS: Array<{ value: Thinking; label: string }> = [
	{ value: "off", label: "Off" },
	{ value: "low", label: "Low" },
	{ value: "medium", label: "Medium" },
	{ value: "high", label: "High" },
];

async function load(): Promise<void> {
	loading.value = true;
	error.value = null;
	try {
		settings.value = await $authFetch<AiSettings>("/ai/settings");
	} catch (e) {
		error.value = e instanceof Error ? e.message : String(e);
	} finally {
		loading.value = false;
	}
}

async function persist(): Promise<void> {
	saving.value = true;
	error.value = null;
	try {
		settings.value = await $authFetch<AiSettings>("/ai/settings", {
			method: "PUT",
			body: settings.value,
		});
	} catch (e) {
		error.value = e instanceof Error ? e.message : String(e);
	} finally {
		saving.value = false;
	}
}

function availabilityOf(name: ProviderName): ProviderAvailability {
	return settings.value.providers?.[name] ?? { available: false };
}

function providerLabel(option: ProviderOption): string {
	return availabilityOf(option.value).available
		? option.label
		: `${option.label} — unavailable`;
}

const activeProvider = computed(() => settings.value.provider);

const providerReason = computed(
	() => availabilityOf(settings.value.provider).reason ?? null,
);

function onProvider(event: Event): void {
	const next = (event.target as HTMLSelectElement).value as ProviderName;
	if (!availabilityOf(next).available) {
		// The option is disabled, so this only fires on a stale DOM; snap back.
		(event.target as HTMLSelectElement).value = settings.value.provider;
		return;
	}
	settings.value.provider = next;
	void persist();
}

function onMode(event: Event): void {
	settings.value.mode = (event.target as HTMLSelectElement).value as Mode;
	void persist();
}

function onThinking(event: Event): void {
	settings.value.thinking = (event.target as HTMLSelectElement)
		.value as Thinking;
	void persist();
}

function onAllowLocalSkills(event: Event): void {
	settings.value.allowLocalSkills = (event.target as HTMLInputElement).checked;
	void persist();
}

const activeMode = computed<GenerationMode>(() =>
	settings.value.generationMode === "safe" && settings.value.builderAvailable
		? "safe"
		: "vibe",
);

function onGenerationMode(mode: GenerationMode): void {
	if (mode === "safe" && !settings.value.builderAvailable) return;
	if (mode === settings.value.generationMode) return;
	settings.value.generationMode = mode;
	void persist();
}

onMounted(load);

const SELECT_CLASS =
	"w-full rounded-md border border-default bg-elevated px-3 py-2 text-sm";
</script>

<template>
	<div class="flex w-full flex-col gap-5 pb-10">
		<div
			v-if="error"
			class="border-error bg-error/10 text-error rounded-lg border p-4 text-sm"
		>
			{{ error }}
		</div>

		<!-- Row 1: Provider (left) · Default behavior (right) -->
		<div class="grid gap-5 lg:grid-cols-2">
			<section class="border-default bg-elevated/30 rounded-xl border">
				<header class="border-default border-b px-5 py-4">
					<h2 class="text-highlighted text-sm font-semibold">Provider</h2>
				</header>
				<div class="flex flex-col gap-4 p-5">
					<div>
						<label class="text-toned mb-1.5 block text-xs font-medium">
							Provider
						</label>
						<select
							:class="SELECT_CLASS"
							:value="activeProvider"
							:disabled="loading || saving"
							@change="onProvider"
						>
							<option
								v-for="option in PROVIDER_OPTIONS"
								:key="option.value"
								:value="option.value"
								:disabled="!availabilityOf(option.value).available"
							>
								{{ providerLabel(option) }}
							</option>
						</select>
						<p v-if="providerReason" class="text-error mt-1.5 text-xs">
							{{ providerReason }}
						</p>
						<p class="text-dimmed mt-1.5 text-xs">
							The provider runs its own default model. Switching provider ends
							the live context of open conversations; their transcripts are
							kept.
						</p>
					</div>
				</div>
			</section>

			<section class="border-default bg-elevated/30 rounded-xl border">
				<header class="border-default border-b px-5 py-4">
					<h2 class="text-highlighted text-sm font-semibold">
						Default behavior
					</h2>
				</header>
				<div class="flex flex-col gap-4 p-5">
					<div>
						<label class="text-toned mb-1.5 block text-xs font-medium">
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
						<p class="text-dimmed mt-1.5 text-xs">
							{{ MODE_OPTIONS.find((o) => o.value === settings.mode)?.hint }}
						</p>
						<p v-if="activeMode === 'safe'" class="text-dimmed mt-1 text-xs">
							{{ SAFE_MODE_MODE_NOTE }}
						</p>
					</div>
					<div>
						<label class="text-toned mb-1.5 block text-xs font-medium">
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
						<p class="text-dimmed mt-1.5 text-xs">
							{{ THINKING_HINTS[settings.provider] }}
						</p>
					</div>
					<div>
						<label class="flex items-start gap-3">
							<input
								type="checkbox"
								class="border-default mt-0.5 size-4 rounded"
								:checked="settings.allowLocalSkills"
								:disabled="loading || saving"
								@change="onAllowLocalSkills"
							/>
							<span>
								<span class="text-toned block text-xs font-medium">
									Use machine-local skills (~/.claude/skills)
								</span>
								<span class="text-dimmed mt-0.5 block text-xs">
									Adds the skills from your machine (
									<code>~/.claude/skills</code>
									) on top of the ones bundled by modules. Machine-local, so not
									shared with other environments. Off by default.
								</span>
							</span>
						</label>
					</div>
				</div>
			</section>
		</div>

		<!-- Row 2: Generation mode (full width) -->
		<section class="border-default bg-elevated/30 rounded-xl border">
			<header class="border-default border-b px-5 py-4">
				<h2 class="text-highlighted text-sm font-semibold">Generation mode</h2>
				<p class="text-dimmed mt-0.5 text-xs">
					Default mode applied to new prompts
				</p>
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
							? 'hover:border-primary/60 cursor-pointer'
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
					<p class="text-dimmed text-xs leading-relaxed">
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
							: 'border-default hover:border-primary/60 cursor-pointer'
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
					<p class="text-dimmed text-xs leading-relaxed">
						Free to write custom code and bespoke pages beyond the Builder
						blocks — full creative range.
					</p>
				</button>
			</div>
		</section>
	</div>
</template>
