import { type Ref, ref } from "vue";
import { DEFAULT_SETTINGS, STORABLE_MODES } from "../constants/settings";
import { SERVER_EVENT_TYPES } from "../constants/protocol";
import type {
	AppSettings,
	ProviderAvailability,
	ProviderName,
} from "../types/settings";

export interface UseSettingsOptions {
	onMessage: (handler: (msg: unknown) => void) => () => void;
}

export interface UseSettingsResult {
	settings: Ref<AppSettings>;
}

interface SettingsUpdateEvent {
	type: typeof SERVER_EVENT_TYPES.SETTINGS_UPDATE;
	settings?: Partial<AppSettings>;
	builderAvailable?: boolean;
	providers?: Record<ProviderName, ProviderAvailability>;
}

function isSettingsUpdate(msg: unknown): msg is SettingsUpdateEvent {
	if (msg === null || typeof msg !== "object") return false;
	return Reflect.get(msg, "type") === SERVER_EVENT_TYPES.SETTINGS_UPDATE;
}

/** The pushed settings over the defaults, with a legacy `auto` mode read as normal. */
export function readSettings(event: SettingsUpdateEvent): AppSettings {
	const merged: AppSettings = {
		...DEFAULT_SETTINGS,
		...event.settings,
		builderAvailable: event.builderAvailable ?? false,
		providers: event.providers ?? DEFAULT_SETTINGS.providers,
	};
	if (!STORABLE_MODES.includes(merged.mode))
		merged.mode = DEFAULT_SETTINGS.mode;
	return merged;
}

/** The sidecar's settings, as it pushes them; the Settings page edits them. */
export function useSettings(options: UseSettingsOptions): UseSettingsResult {
	const settings = ref<AppSettings>({ ...DEFAULT_SETTINGS });

	options.onMessage((msg: unknown): void => {
		if (!isSettingsUpdate(msg)) return;
		settings.value = readSettings(msg);
	});

	return { settings };
}
