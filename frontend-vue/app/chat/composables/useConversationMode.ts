import { computed, type ComputedRef, type Ref } from "vue";
import { modeFor } from "../constants/modes";
import { CLIENT_MESSAGE_TYPES } from "../constants/protocol";
import type {
	ApprovalMode,
	ConversationModeState,
	Scope,
} from "../types/protocol";
import type { AppSettings } from "../types/settings";

export interface UseConversationModeOptions {
	activeId: Ref<string>;
	/** What the sidecar last said of this chat's mode; null before it did. */
	mode: Ref<ConversationModeState | null>;
	settings: Ref<AppSettings>;
	send: (msg: object) => boolean;
}

export interface UseConversationModeResult {
	/** The chat's mode and its scope, defaults until the sidecar says. */
	current: ComputedRef<ConversationModeState>;
	setMode: (mode: ApprovalMode) => void;
	setScope: (scope: Scope) => void;
}

function effectiveScope(scope: Scope, builderAvailable: boolean): Scope {
	return builderAvailable ? scope : "vibe";
}

/**
 * The active chat's approval mode and scope: what the sidecar says,
 * or the current provider's default from the settings until it has. A mode the
 * provider does not have reads as Ask first. Changes apply at once here and
 * are sent for the sidecar to confirm.
 */
export function useConversationMode(
	options: UseConversationModeOptions,
): UseConversationModeResult {
	const current = computed<ConversationModeState>(() => {
		const { settings, mode } = options;
		const base: ConversationModeState = mode.value ?? {
			mode: settings.value.defaultModes[settings.value.provider],
			generationMode: settings.value.generationMode,
		};
		return {
			...base,
			mode: modeFor(settings.value.provider, base.mode),
			generationMode: effectiveScope(
				base.generationMode,
				settings.value.builderAvailable,
			),
		};
	});

	const change = (patch: Partial<ConversationModeState>): void => {
		const isSent = options.send({
			type: CLIENT_MESSAGE_TYPES.SET_CONVERSATION_MODE,
			conversationId: options.activeId.value,
			...patch,
		});
		if (!isSent) return;
		options.mode.value = { ...current.value, ...patch };
	};

	return {
		current,
		setMode: (mode) => change({ mode }),
		setScope: (generationMode) => change({ generationMode }),
	};
}
