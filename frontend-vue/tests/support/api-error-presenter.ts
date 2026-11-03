import { ref } from "vue";
import { afterEach, vi } from "vitest";
import { useApiErrorPresenter } from "../../../node_modules/@antelopejs/dms/frontend-vue/layers/dms-core/app/composables/useApiErrorPresenter";

afterEach(() => vi.unstubAllEnvs());

export function installApiErrorPresenter() {
	vi.stubEnv("SSR", false);
	const add = vi.fn(() => ({ id: "notice" }));
	const messages: Record<string, string> = {
		"error.read_only_demo": "This demo is read-only.",
		"error.500.description": "Something went wrong.",
		"dms_ai.views.error.description": "Could not load the assistant's data.",
		"dms_ai.views.unavailable.description": "The assistant is not running.",
	};
	vi.stubGlobal("useToast", () => ({ add }));
	vi.stubGlobal("getPluginI18n", () => ({
		i18n: {
			tm: (key: string) =>
				Object.hasOwn(messages, key) ? messages[key] : null,
			rt: (message: string) => message,
		},
	}));
	const presented = ref(new WeakMap<object, string | number | null>());
	vi.stubGlobal("useDmsState", () => presented);
	vi.stubGlobal("useApiErrorPresenter", useApiErrorPresenter);
	return { add };
}
