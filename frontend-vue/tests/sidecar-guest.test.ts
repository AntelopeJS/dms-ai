import { afterEach, expect, it, vi } from "vitest";
import { nextTick, ref, type Ref } from "vue";
import plugin from "../app/plugins/ai.client";

vi.mock("#dms/frontend-module", () => ({
	defineDmsPlugin: (definition: unknown) => definition,
	useDmsRouter: () => ({ push: vi.fn() }),
}));

interface PluginHarness {
	useAuthFetch: ReturnType<typeof vi.fn>;
	unregisterSidePanel: ReturnType<typeof vi.fn>;
	run: () => void | Promise<void>;
}

// A first probe reporting a disabled sidecar stops the startup right after the
// authenticated fetch, which is all these tests need to observe.
function disabledSidecarRead() {
	return {
		data: ref({ disabled: true }),
		error: ref(null),
		pending: ref(false),
		execute: async () => undefined,
		refresh: async () => undefined,
	};
}

function loadPlugin(loggedIn: Ref<boolean>): PluginHarness {
	const useAuthFetch = vi.fn(() => ({ $authFetch: vi.fn() }));
	const unregisterSidePanel = vi.fn();
	vi.stubGlobal("useDmsUserSession", () => ({ loggedIn }));
	vi.stubGlobal("useAuthFetch", useAuthFetch);
	vi.stubGlobal("useToast", () => ({ add: vi.fn() }));
	vi.stubGlobal("useDevReload", () => ({ awaitRoute: vi.fn() }));
	vi.stubGlobal("useApiData", disabledSidecarRead);
	vi.stubGlobal("unregisterSidePanel", unregisterSidePanel);
	return {
		useAuthFetch,
		unregisterSidePanel,
		run: () =>
			plugin({
				vueApp: { onUnmount: vi.fn(), provide: vi.fn() },
				$i18n: { t: (key: string) => key, locale: ref("en-GB") },
				hook: vi.fn(),
				runWithContext: (callback: () => unknown) => callback(),
			}),
	};
}

afterEach(() => {
	vi.unstubAllGlobals();
});

it("does not invoke authenticated fetching or inject the assistant for a guest", async () => {
	const harness = loadPlugin(ref(false));
	await harness.run();
	expect(harness.useAuthFetch).not.toHaveBeenCalled();
});

it("starts the assistant when a guest signs in without reloading the page", async () => {
	const loggedIn = ref(false);
	const harness = loadPlugin(loggedIn);
	await harness.run();
	expect(harness.useAuthFetch).not.toHaveBeenCalled();

	loggedIn.value = true;
	await nextTick();
	expect(harness.useAuthFetch).toHaveBeenCalledTimes(1);
});

it("withdraws the docked panel when the first probe finds no assistant", async () => {
	const harness = loadPlugin(ref(true));
	await harness.run();
	await vi.waitFor(() =>
		expect(harness.unregisterSidePanel).toHaveBeenCalledWith(
			"dms-ai:assistant",
		),
	);
});
