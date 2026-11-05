// @vitest-environment jsdom
import { flushPromises } from "@vue/test-utils";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ref } from "vue";
import plugin from "../app/plugins/ai.client";
import type { SidecarInfoPayload } from "../app/runtime/sidecar-status";
import { createSidePanel } from "./support/panel-harness";

vi.mock("#dms/frontend-module", () => ({
	defineDmsPlugin: (definition: unknown) => definition,
	useDmsRouter: () => ({ push: vi.fn() }),
}));

vi.mock("@inertiajs/vue3", () => ({
	router: { on: () => () => undefined },
}));

const SIDECAR_INFO_PATH = "/ai/sidecar-info";
const STATUS_PATH = "/ai/status";
const encoder = new TextEncoder();

interface Started {
	reads: string[];
	posted: unknown[];
	toast: ReturnType<typeof vi.fn>;
	unregisterSidePanel: ReturnType<typeof vi.fn>;
	registerCommandPaletteAssistant: ReturnType<typeof vi.fn>;
	paletteItemIds: () => string[];
}

interface PaletteSourceShape {
	groups: () => Array<{ items: Array<{ id: string }> }>;
}

/** A stream that says it is ready at once, as the backend's channel does. */
function readyStream(): Promise<Response> {
	const body = new ReadableStream<Uint8Array>({
		start: (controller) =>
			controller.enqueue(
				encoder.encode('event: ready\ndata: {"connectionId":"c1"}\n\n'),
			),
	});
	return Promise.resolve(new Response(body, { status: 200 }));
}

function apiRead(body: SidecarInfoPayload | null, error: unknown = null) {
	return {
		data: ref(body),
		error: ref(error),
		pending: ref(false),
		execute: async () => undefined,
		refresh: async () => undefined,
	};
}

/**
 * Runs the plugin for a signed-in user whose sidecar info answers `info`, or
 * fails with `error`, the panel open so the tab's stream connects.
 */
async function start(
	info: SidecarInfoPayload | null,
	error: unknown = null,
): Promise<Started> {
	const reads: string[] = [];
	const posted: unknown[] = [];
	const toast = vi.fn();
	const unregisterSidePanel = vi.fn();
	const registerCommandPaletteAssistant = vi.fn();
	let source: PaletteSourceShape | null = null;
	const panel = createSidePanel();
	panel.open();
	let mounted: () => void = () => undefined;
	const streams = vi.fn(readyStream);
	vi.stubGlobal("fetch", streams);
	vi.stubGlobal("useDmsUserSession", () => ({ loggedIn: ref(true) }));
	vi.stubGlobal("useAuthFetch", () => ({
		$authFetch: async (_path: string, init?: { body?: string }) => {
			posted.push(JSON.parse(init?.body ?? "{}"));
			return {};
		},
	}));
	vi.stubGlobal("useToast", () => ({ add: toast }));
	vi.stubGlobal("useDevReload", () => ({ awaitRoute: vi.fn() }));
	vi.stubGlobal("useApiData", (path: string) => {
		reads.push(path);
		return path === SIDECAR_INFO_PATH ? apiRead(info, error) : apiRead(null);
	});
	vi.stubGlobal("useSidePanel", () => panel);
	vi.stubGlobal("unregisterSidePanel", unregisterSidePanel);
	vi.stubGlobal("registerHeaderAction", vi.fn());
	vi.stubGlobal("registerCommandPaletteSource", (next: PaletteSourceShape) => {
		source = next;
	});
	vi.stubGlobal(
		"registerCommandPaletteAssistant",
		registerCommandPaletteAssistant,
	);
	await plugin({
		vueApp: { onUnmount: vi.fn(), provide: vi.fn() },
		$i18n: { t: (key: string) => key, locale: ref("en-GB") },
		hook: (_name: string, callback: () => void) => {
			mounted = callback;
		},
		runWithContext: (callback: () => unknown) => callback(),
	});
	await flushPromises();
	mounted();
	await vi.waitFor(() => expect(reads).toContain(SIDECAR_INFO_PATH));
	if (info?.isRunning === true) {
		await vi.waitFor(() => expect(streams).toHaveBeenCalled());
		await new Promise((resolve) => setTimeout(resolve, 20));
	}
	await flushPromises();
	return {
		reads,
		posted,
		toast,
		unregisterSidePanel,
		registerCommandPaletteAssistant,
		paletteItemIds: () =>
			source?.groups().flatMap((group) => group.items.map((item) => item.id)) ??
			[],
	};
}

function typesPosted(started: Started): unknown[] {
	return started.posted.map((msg) => Reflect.get(Object(msg), "type"));
}

afterEach(() => {
	vi.unstubAllGlobals();
	document.body.innerHTML = "";
});

describe("the assistant for a user the backend refuses", () => {
	it("leaves no trace and says nothing when the sidecar info answers 403", async () => {
		const forbidden = Object.assign(new Error("Forbidden"), {
			statusCode: 403,
		});
		const started = await start(null, forbidden);
		await vi.waitFor(() =>
			expect(started.unregisterSidePanel).toHaveBeenCalledWith(
				"dms-ai:assistant",
			),
		);
		expect(started.reads).toEqual([SIDECAR_INFO_PATH]);
		expect(started.toast).not.toHaveBeenCalled();
		expect(started.posted).toEqual([]);
	});
});

describe("the assistant for a user who may run the Analyst only", () => {
	it("neither polls the owner's status nor says hello as the Builder's host", async () => {
		const started = await start({ isRunning: true, modes: ["analyst"] });
		expect(started.unregisterSidePanel).not.toHaveBeenCalled();
		expect(started.reads).not.toContain(STATUS_PATH);
		expect(typesPosted(started)).not.toContain("host_state_update");
		expect(started.posted).not.toContainEqual(
			expect.objectContaining({ type: "hello", role: "host" }),
		);
	});

	it("offers no palette assistant mode, approvals or Changes page", async () => {
		const started = await start({ isRunning: true, modes: ["analyst"] });
		expect(started.registerCommandPaletteAssistant).not.toHaveBeenCalled();
		expect(started.paletteItemIds()).toEqual(["dms-ai-ask", "dms-ai-new"]);
	});
});

describe("the assistant for an owner in development", () => {
	it("polls the status, says hello as the host, and offers the Builder's entries", async () => {
		const started = await start({
			isRunning: true,
			modes: ["builder", "analyst"],
		});
		expect(started.reads).toContain(STATUS_PATH);
		expect(started.posted).toContainEqual(
			expect.objectContaining({ type: "hello", role: "host" }),
		);
		expect(typesPosted(started)).toContain("host_state_update");
		expect(started.registerCommandPaletteAssistant).toHaveBeenCalledTimes(1);
		expect(started.paletteItemIds()).toEqual([
			"dms-ai-ask",
			"dms-ai-new",
			"dms-ai-approvals",
			"dms-ai-changes",
		]);
	});
});
