// @vitest-environment jsdom
import { flushPromises, shallowMount } from "@vue/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
	computed,
	defineComponent,
	h,
	reactive,
	ref,
	toValue,
	watch,
	type MaybeRefOrGetter,
} from "vue";
import ActivityDetail from "../../app/components/ActivityDetail.vue";
import ChangesView from "../../app/components/ChangesView.vue";
import ChangeSetPanel from "../../app/views/ChangeSetPanel.vue";
import UnavailableState from "../../app/views/UnavailableState.vue";

// The views read what they render with the DMS's `useApiData`, which a server
// render hands to the browser (this repository has no renderer to run it:
// the playground proves that part); `$authFetch` is left to the writes and
// to "Load more". This fake reads as the browser does.

const route = reactive({ query: {} as Record<string, string> });

vi.mock("#dms/frontend-module", () => ({
	useDmsRoute: () => route,
	useDmsRouter: () => ({ push: vi.fn() }),
}));

interface Read {
	url: string;
	query?: Record<string, unknown>;
}

type Backend = (read: Read) => unknown;

let backend: Backend;
const reads: Read[] = [];
const authFetch = vi.fn();

function useApiData<T>(
	url: MaybeRefOrGetter<string | null | undefined>,
	options: { query?: MaybeRefOrGetter<Record<string, unknown>> } = {},
) {
	const data = ref<T | null>(null);
	const error = ref<unknown>(null);
	const status = ref<"idle" | "pending" | "success" | "error">("idle");
	const request = () => ({ url: toValue(url), query: toValue(options.query) });
	async function refresh(): Promise<void> {
		const { url: target, query } = request();
		if (target == null) return;
		const read = query ? { url: target, query } : { url: target };
		reads.push(read);
		status.value = "pending";
		try {
			// Each answer is a new value, as a parsed response is.
			data.value = structuredClone(await backend(read)) as T;
			error.value = null;
			status.value = "success";
		} catch (failure) {
			error.value = failure;
			status.value = "error";
		}
	}
	watch(request, () => void refresh(), { deep: true, immediate: true });
	return {
		data,
		error,
		status,
		pending: computed(() => status.value === "pending"),
		placeholder: ref(false),
		refresh,
		execute: refresh,
		clear: () => undefined,
	};
}

const Stub = (name: string) =>
	defineComponent({
		name,
		inheritAttrs: false,
		setup:
			(_, { slots }) =>
			() =>
				h("div", { "data-stub": name }, slots.default?.()),
	});

const GLOBAL_STUBS = Object.fromEntries(
	[
		"DmsCard",
		"DmsEmptyState",
		"DmsMasterDetail",
		"DmsSegmented",
		"DmsKeyValueList",
		"DmsIconWell",
		"DmsEyebrow",
		"DmsCodeSnippet",
		"UButton",
		"UInput",
		"USkeleton",
	].map((name) => [name, Stub(name)]),
);

const unavailable = () =>
	Object.assign(new Error("Service Unavailable"), {
		statusCode: 503,
		data: { message: "The assistant is not running" },
	});

const ROW = {
	id: "act-1",
	timestampMs: Date.UTC(2026, 9, 15, 10),
	tool: "Edit",
	target: "src/pages/home.ts",
	agent: "claude",
	allowedBy: "approved",
	result: "done",
	conversationId: "conv-1",
	conversationTitle: "Rename the home page",
	isReadOnly: false,
	isAutoFix: false,
};

const summary = (id: string, number: number) => ({
	id,
	number,
	title: `Change ${number}`,
	state: "applied",
	createdAtMs: Date.UTC(2026, 9, 15, 10),
	added: 1,
	removed: 0,
	scope: "safe",
	agent: "claude",
	files: [],
	isAutoFix: false,
	approvalsNeeded: 0,
	builderOps: 0,
	typecheck: "passed",
});

beforeEach(() => {
	reads.length = 0;
	authFetch.mockReset();
	route.query = {};
	vi.stubGlobal("useApiData", useApiData);
	vi.stubGlobal("useAuthFetch", () => ({ $authFetch: authFetch }));
	vi.stubGlobal("useI18n", () => ({
		t: (key: string) => key,
		te: () => false,
	}));
	vi.stubGlobal("useRegionalFormat", () => ({
		dateTimeFormat: (options: Intl.DateTimeFormatOptions) =>
			new Intl.DateTimeFormat("en-GB", { ...options, timeZone: "UTC" }),
	}));
	vi.stubGlobal("useToast", () => ({ add: vi.fn() }));
	vi.stubGlobal("useConfirmFrom", () => ({ confirmFrom: vi.fn() }));
});

afterEach(() => {
	vi.unstubAllGlobals();
});

const mount = (component: Parameters<typeof shallowMount>[0], props = {}) =>
	shallowMount(component, {
		props,
		global: { stubs: { ...GLOBAL_STUBS, UnavailableState: false } },
	});

describe("activity detail", () => {
	it("reads the entry its row names with the page, not with $authFetch", async () => {
		backend = () => ({ ...ROW, args: { file_path: "src/pages/home.ts" } });
		const wrapper = mount(ActivityDetail, { rowData: ROW });
		await flushPromises();
		expect(reads).toEqual([{ url: "/ai/activity/act-1" }]);
		expect(authFetch).not.toHaveBeenCalled();
		expect(wrapper.findComponent(UnavailableState).exists()).toBe(false);
		expect(wrapper.find('[data-stub="USkeleton"]').exists()).toBe(false);
	});

	it("says the assistant is not running on a 503, and reads again on retry", async () => {
		backend = () => {
			throw unavailable();
		};
		const wrapper = mount(ActivityDetail, { rowData: ROW });
		await flushPromises();
		const state = wrapper.findComponent(UnavailableState);
		expect(state.props("failure")).toBe("unavailable");
		backend = () => ROW;
		state.vm.$emit("retry");
		await flushPromises();
		expect(reads).toHaveLength(2);
		expect(wrapper.findComponent(UnavailableState).exists()).toBe(false);
	});
});

describe("changes view", () => {
	const PAGE = { results: [summary("cs-1", 1), summary("cs-2", 2)], total: 3 };

	function changesBackend({ url }: Read): unknown {
		if (url === "/ai/status") return { checkpointsAvailable: true };
		if (url === "/ai/changes") return PAGE;
		return { changeSet: summary("cs-1", 1), files: [] };
	}

	it("reads the status and the first page with the page, and opens the set the URL names", async () => {
		backend = changesBackend;
		route.query = { set: "cs-2" };
		const wrapper = mount(ChangesView);
		await flushPromises();
		expect(reads).toEqual([
			{ url: "/ai/status" },
			{ url: "/ai/changes", query: { offset: 0, limit: 30 } },
		]);
		expect(authFetch).not.toHaveBeenCalled();
		expect(wrapper.findComponent(ChangeSetPanel).props("changeSetId")).toBe(
			"cs-2",
		);
	});

	it("selects the first set when the URL names none", async () => {
		backend = changesBackend;
		const wrapper = mount(ChangesView);
		await flushPromises();
		expect(wrapper.findComponent(ChangeSetPanel).props("changeSetId")).toBe(
			"cs-1",
		);
	});

	it("appends the next page on Load more, and drops it with a newer first page", async () => {
		backend = changesBackend;
		authFetch.mockResolvedValue({ results: [summary("cs-3", 3)], total: 3 });
		const wrapper = mount(ChangesView);
		await flushPromises();
		const loadMore = wrapper
			.findAllComponents({ name: "UButton" })
			.find(
				(button) => button.vm.$attrs.label === "dms_ai.views.common.load_more",
			);
		loadMore!.vm.$emit("click");
		await flushPromises();
		expect(authFetch).toHaveBeenCalledWith("/ai/changes", {
			query: { offset: 2, limit: 30 },
		});
		const items = () =>
			(
				wrapper.findComponent({ name: "DmsMasterDetail" }).vm.$attrs.items as {
					value: string;
				}[]
			).map((item) => item.value);
		expect(items()).toEqual(["cs-1", "cs-2", "cs-3"]);

		// A change set undone in the panel reads the first page again.
		wrapper.findComponent(ChangeSetPanel).vm.$emit("changed");
		await flushPromises();
		expect(items()).toEqual(["cs-1", "cs-2"]);
	});

	it("reads the filtered first page when the scope changes", async () => {
		backend = changesBackend;
		const wrapper = mount(ChangesView);
		await flushPromises();
		wrapper
			.findComponent({ name: "DmsSegmented" })
			.vm.$emit("update:modelValue", "vibe");
		await flushPromises();
		expect(reads.at(-1)).toEqual({
			url: "/ai/changes",
			query: { offset: 0, limit: 30, scope: "vibe", filter_scope: "is:vibe" },
		});
	});
});
