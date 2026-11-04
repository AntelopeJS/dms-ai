// @vitest-environment jsdom
import { mount } from "@vue/test-utils";
import { describe, expect, it } from "vitest";
import ProviderNotice from "../../app/chat/components/ProviderNotice.vue";
import { CHAT_I18N_KEY } from "../../app/chat/composables/useChatI18n";
import fr from "../../i18n/locales/dms-ai-panel-fr-FR.json";
import { createTestI18n } from "../support/i18n";
import { PANEL_STUBS } from "../support/stubs";

const ENGLISH_REASON =
	"Sign in with ChatGPT in Assistant › Settings to run Codex on your ChatGPT plan.";

function noticeText(code?: "codex_not_signed_in"): string {
	return mount(ProviderNotice, {
		props: { agentName: "Codex", reason: ENGLISH_REASON, code },
		global: {
			provide: { [CHAT_I18N_KEY as symbol]: createTestI18n(fr) },
			stubs: PANEL_STUBS,
		},
	}).text();
}

describe("the agent can't run notice", () => {
	it("words the ChatGPT sign-in hint in the panel's language", () => {
		const text = noticeText("codex_not_signed_in");
		expect(text).toContain("Connectez-vous avec ChatGPT");
		expect(text).not.toContain(ENGLISH_REASON);
	});

	it("shows the sidecar's own reason when the panel has no wording for it", () => {
		expect(noticeText()).toContain(ENGLISH_REASON);
	});
});
