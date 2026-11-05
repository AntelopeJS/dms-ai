import { computed, type ComputedRef, type Ref } from "vue";
import { modeFor } from "../constants/modes";
import { CLIENT_MESSAGE_TYPES } from "../constants/protocol";
import type {
	ApprovalMode,
	AssistantMode,
	ConversationModeState,
	Scope,
} from "../types/protocol";
import type { AppSettings } from "../types/settings";

export interface UseConversationModeOptions {
	activeId: Ref<string>;
	/** What the sidecar last said of this chat's mode; null before it did. */
	mode: Ref<ConversationModeState | null>;
	settings: Ref<AppSettings>;
	/** The assistant modes the signed-in user may run. */
	modes: () => readonly AssistantMode[];
	send: (msg: object) => boolean;
}

export interface UseConversationModeResult {
	/** The chat's assistant, mode and scope, defaults until the sidecar says. */
	current: ComputedRef<ConversationModeState>;
	/** The chat is in Builder: its scope and approval mode apply. */
	isBuilder: ComputedRef<boolean>;
	setAssistant: (assistant: AssistantMode) => void;
	setMode: (mode: ApprovalMode) => void;
	setScope: (scope: Scope) => void;
}

function effectiveScope(scope: Scope, builderAvailable: boolean): Scope {
	return builderAvailable ? scope : "vibe";
}

function defaultAssistant(modes: readonly AssistantMode[]): AssistantMode {
	return modes.includes("builder") ? "builder" : "analyst";
}

function effectiveAssistant(
	assistant: AssistantMode,
	modes: readonly AssistantMode[],
): AssistantMode {
	return modes.includes(assistant) ? assistant : defaultAssistant(modes);
}

/**
 * The active chat's assistant, approval mode and scope: what the sidecar
 * says, or the current provider's default from the settings until it has. A
 * mode the provider does not have reads as Ask first. Changes apply at once
 * here and are sent for the sidecar to confirm. The Builder's settings change
 * only while the chat is in Builder.
 */
export function useConversationMode(
	options: UseConversationModeOptions,
): UseConversationModeResult {
	const current = computed<ConversationModeState>(() => {
		const { settings, mode } = options;
		const modes = options.modes();
		const base: ConversationModeState = mode.value ?? {
			assistant: defaultAssistant(modes),
			mode: settings.value.defaultModes[settings.value.provider],
			generationMode: settings.value.generationMode,
		};
		const assistant = effectiveAssistant(base.assistant, modes);
		return {
			...base,
			assistant,
			mode: modeFor(settings.value.provider, base.mode),
			generationMode: effectiveScope(
				base.generationMode,
				settings.value.builderAvailable,
			),
		};
	});
	const isBuilder = computed(() => current.value.assistant === "builder");

	const change = (patch: Partial<ConversationModeState>): void => {
		const isSent = options.send({
			type: CLIENT_MESSAGE_TYPES.SET_CONVERSATION_MODE,
			conversationId: options.activeId.value,
			...patch,
		});
		if (!isSent) return;
		options.mode.value = { ...current.value, ...patch };
	};
	const changeBuilder = (patch: Partial<ConversationModeState>): void => {
		if (isBuilder.value) change(patch);
	};

	return {
		current,
		isBuilder,
		setAssistant: (assistant) => {
			if (!options.modes().includes(assistant)) return;
			if (assistant !== current.value.assistant) change({ assistant });
		},
		setMode: (mode) => changeBuilder({ mode }),
		setScope: (generationMode) => changeBuilder({ generationMode }),
	};
}
