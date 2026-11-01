import { afterEach, expect, it, vi } from "vitest";
import { ref } from "vue";
import { useAiData } from "../../app/views/composables/useAiData";
import { useChangeSetActions } from "../../app/views/composables/useChangeSetActions";

afterEach(() => vi.unstubAllGlobals());

it.each([true, false])(
	"keeps redo cleanup without duplicating a marked refusal (%s)",
	async (marked) => {
		const error = Object.assign(new Error("Forbidden"), {
			response: new Response(null, {
				status: 403,
				headers: marked ? { "x-dms-readonly": "1" } : {},
			}),
		});
		const notices: string[] = [];
		const presented = new WeakSet<Response>();
		const consume = (failure: unknown) => {
			if (failure !== error || !marked) return false;
			if (!presented.has(error.response)) notices.push("read-only");
			presented.add(error.response);
			return true;
		};
		vi.stubGlobal("useReadOnlyRefusal", () => consume);
		vi.stubGlobal("useToast", () => ({ add: () => notices.push("local") }));
		vi.stubGlobal("useI18n", () => ({ t: (key: string) => key }));
		vi.stubGlobal("useConfirmFrom", () => ({}));
		vi.stubGlobal("useAuthFetch", () => ({
			$authFetch: async () => {
				consume(error);
				throw error;
			},
		}));
		const actions = useChangeSetActions();
		await actions.redo({
			id: "change-1",
			number: 1,
			conversationId: "conversation-1",
			title: "Rename page",
			createdAtMs: 1,
			agent: "claude",
			scope: "safe",
			isAutoFix: false,
			overlapped: false,
			files: [],
			added: 1,
			removed: 0,
			typecheck: "passed",
			state: "applied",
			approvalsNeeded: 0,
			builderOps: 0,
		});
		expect(notices).toEqual([marked ? "read-only" : "local"]);
		expect(actions.isBusy.value).toBe(false);
	},
);

it.each([true, false])(
	"suppresses only a marked read failure (%s)",
	(marked) => {
		const error = new Error("Forbidden");
		vi.stubGlobal(
			"useReadOnlyRefusal",
			() => (failure: unknown) => marked && failure === error,
		);
		vi.stubGlobal("useApiData", () => ({
			error: ref(error),
			status: ref("error"),
		}));
		const read = useAiData("/ai/changes");
		expect(read.failure.value).toBe(marked ? null : "error");
		expect(read.message.value).toBe(marked ? "" : "Forbidden");
	},
);
