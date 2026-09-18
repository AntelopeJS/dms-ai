export type ChatboxMode = "normal" | "acceptEdits" | "plan" | "auto";
export type ThinkingLevel = "off" | "low" | "medium" | "high";
export type GenerationMode = "safe" | "vibe";
export type ProviderName = "claude" | "codex";

export interface ProviderAvailability {
	available: boolean;
	// Why the provider cannot be picked; absent when it is available.
	reason?: string;
}

export interface AppSettings {
	provider: ProviderName;
	mode: ChatboxMode;
	thinking: ThinkingLevel;
	generationMode: GenerationMode;
	allowLocalSkills: boolean;
	// Read-only capability pushed by the sidecar: whether the Builder is present.
	builderAvailable: boolean;
	// Read-only capability pushed by the sidecar: which backends this install
	// can actually drive.
	providers: Record<ProviderName, ProviderAvailability>;
}
