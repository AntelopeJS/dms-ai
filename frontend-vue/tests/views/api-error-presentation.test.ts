import { afterEach, expect, it, vi } from "vitest";
import { ref } from "vue";
import { useAiData } from "../../app/views/composables/useAiData";
import { useChangeSetActions } from "../../app/views/composables/useChangeSetActions";
import { installApiErrorPresenter } from "../support/api-error-presenter";

afterEach(() => vi.unstubAllGlobals());

it.each([
	{
		status: 403,
		data: { message: "error.read_only_demo", severity: "warning" },
		title: "This demo is read-only.",
		color: "warning",
	},
	{
		status: 403,
		data: { message: "unknown.server.key" },
		title: "Could not load the assistant's data.",
		color: "warning",
	},
	{
		status: 503,
		data: { message: "unknown.server.key" },
		title: "The assistant is not running.",
		color: "error",
	},
])(
	"presents redo failure $status once with server or fallback copy",
	async ({ status, data, title, color }) => {
		const { add } = installApiErrorPresenter();
		const error = Object.assign(new Error("Request failed"), {
			response: new Response(JSON.stringify(data), {
				status,
				headers: { "content-type": "application/json" },
			}),
			data,
		});
		vi.stubGlobal("useI18n", () => ({ t: (key: string) => key }));
		vi.stubGlobal("useConfirmFrom", () => ({}));
		vi.stubGlobal("useAuthFetch", () => ({
			$authFetch: async () => {
				throw error;
			},
		}));
		const actions = useChangeSetActions();
		const changeSet = {
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
		} satisfies Parameters<typeof actions.redo>[0];
		await actions.redo(changeSet);
		await actions.redo(changeSet);
		expect(add.mock.calls).toEqual([
			[expect.objectContaining({ title, color })],
		]);
		expect(actions.isBusy.value).toBe(false);
	},
);

it("resolves a JSON read refusal as translated inline copy without a toast", () => {
	const { add } = installApiErrorPresenter();
	const data = { message: "error.read_only_demo", severity: "warning" };
	const error = Object.assign(new Error("Forbidden"), {
		response: new Response(JSON.stringify(data), { status: 403 }),
		data,
	});
	vi.stubGlobal("useApiData", () => ({
		error: ref(error),
		status: ref("error"),
	}));
	const read = useAiData("/ai/changes");
	expect(read.failure.value).toBe("error");
	expect(read.message.value).toBe("This demo is read-only.");
	expect(add).not.toHaveBeenCalled();
});
