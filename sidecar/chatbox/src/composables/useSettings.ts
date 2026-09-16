import { type Ref, ref } from "vue";
import { DEFAULT_SETTINGS } from "../constants/settings";
import { CLIENT_MESSAGE_TYPES, SERVER_EVENT_TYPES } from "../constants/ws";
import type { AppSettings } from "../types/settings";

export interface UseSettingsOptions {
	send: (msg: object) => void;
	onMessage: (handler: (msg: unknown) => void) => () => void;
}

export interface UseSettingsResult {
	settings: Ref<AppSettings>;
	update: (next: Partial<AppSettings>) => void;
}

interface SettingsUpdateEvent {
	type: typeof SERVER_EVENT_TYPES.SETTINGS_UPDATE;
	settings: AppSettings;
	builderAvailable?: boolean;
}

function isObject(value: unknown): value is Record<string, unknown> {
	return value !== null && typeof value === "object";
}

function getEventType(msg: unknown): string | null {
	if (!isObject(msg)) return null;
	const t = msg.type;
	return typeof t === "string" ? t : null;
}

export function useSettings(options: UseSettingsOptions): UseSettingsResult {
	const settings = ref<AppSettings>({ ...DEFAULT_SETTINGS });

	options.onMessage((msg: unknown): void => {
		if (getEventType(msg) !== SERVER_EVENT_TYPES.SETTINGS_UPDATE) return;
		const event = msg as SettingsUpdateEvent;
		settings.value = {
			...event.settings,
			builderAvailable: event.builderAvailable ?? false,
		};
	});

	const update = (partial: Partial<AppSettings>): void => {
		const next: AppSettings = { ...settings.value, ...partial };
		settings.value = next;
		options.send({
			type: CLIENT_MESSAGE_TYPES.SET_SETTINGS,
			mode: next.mode,
			thinking: next.thinking,
			generationMode: next.generationMode,
			allowLocalSkills: next.allowLocalSkills,
		});
	};

	return { settings, update };
}
