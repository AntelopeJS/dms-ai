export type ChatboxMode = "normal" | "acceptEdits" | "plan" | "auto";
export type ThinkingLevel = "off" | "low" | "medium" | "high";
export type GenerationMode = "safe" | "vibe";

export interface AppSettings {
	mode: ChatboxMode;
	thinking: ThinkingLevel;
	generationMode: GenerationMode;
	allowLocalSkills: boolean;
	// Read-only capability pushed by the sidecar: whether the Builder is present.
	builderAvailable: boolean;
}
