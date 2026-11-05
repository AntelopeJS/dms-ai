import type { ApprovalMode, ProviderName, Scope } from "./protocol";

export type ThinkingLevel = "off" | "low" | "medium" | "high";
export type { ProviderName };

/** The unavailability reasons the panel words itself (sidecar `PROVIDER_UNAVAILABLE_CODES`). */
export type ProviderUnavailableCode = "codex_not_signed_in";

export interface ProviderAvailability {
	available: boolean;
	/** Why the provider cannot be picked, in English; absent when it is available. */
	reason?: string;
	/** Names the reason when the panel has its own wording for it. */
	code?: ProviderUnavailableCode;
}

export interface AppSettings {
	provider: ProviderName;
	/** The default approval mode of new chats. */
	defaultModes: Record<ProviderName, ApprovalMode>;
	thinking: ThinkingLevel;
	/** The default scope of new chats. */
	generationMode: Scope;
	allowLocalSkills: boolean;
	notifyRequests: boolean;
	requestTimeoutMinutes: number;
	/**
	 * Read-only capability pushed by the sidecar: whether the Builder is present.
	 */
	builderAvailable: boolean;
	/**
	 * Read-only capability pushed by the sidecar: which backends this install can
	 * actually drive.
	 */
	providers: Record<ProviderName, ProviderAvailability>;
}
