import { flushPromises, mount, type VueWrapper } from "@vue/test-utils";
import { vi } from "vitest";
import { nextTick, ref } from "vue";
import ChatPanel from "../../app/components/ChatPanel.vue";
import {
	ASSISTANT_SESSION_KEY,
	type AssistantSession,
} from "../../app/runtime/assistant-session";
import type { ChannelStatus } from "../../app/runtime/channel-client";
import {
	type ChatTransportHub,
	createChatTransport,
} from "../../app/runtime/chat-transport";
import { createPanelIntents } from "../../app/runtime/panel-intents";
import { createChatPanelState } from "../../app/runtime/panel-state";
import { CHAT_I18N_KEY } from "../../app/chat/composables/useChatI18n";
import { createTestI18n } from "./i18n";
import { PANEL_STUBS } from "./stubs";
import type { SidecarStatus } from "../../app/runtime/sidecar-status";

export const CONVERSATION_ID = "conv-native-1";

/** A panel mounted on a fake stream: what it sent, and handles to drive it. */
export interface Harness {
	session: AssistantSession;
	hub: ChatTransportHub;
	sent: Array<Record<string, unknown>>;
	reconnects: number;
	sidecarStatus: ReturnType<typeof ref<SidecarStatus>>;
	setChannelStatus: (status: ChannelStatus) => void;
	navigate: ReturnType<typeof vi.fn>;
	restart: ReturnType<typeof vi.fn>;
	lastError: ReturnType<typeof ref<string | null>>;
	api: AssistantSession["api"];
}

export function createHarness(): Harness {
	let channelStatus: ChannelStatus = "connected";
	const harness = {
		sent: [] as Array<Record<string, unknown>>,
		reconnects: 0,
		sidecarStatus: ref<SidecarStatus>("connected"),
		navigate: vi.fn(),
		restart: vi.fn(async () => undefined),
		lastError: ref<string | null>(null),
		api: { get: vi.fn(async () => ({ conflicts: [] })), post: vi.fn() },
	} as unknown as Harness;
	harness.hub = createChatTransport({
		send: (msg) => {
			if (channelStatus !== "connected") return false;
			harness.sent.push(msg as Record<string, unknown>);
			return true;
		},
		reconnect: () => {
			harness.reconnects += 1;
		},
		getStatus: () => channelStatus,
	});
	harness.setChannelStatus = (status) => {
		channelStatus = status;
		harness.hub.announceStatus(status);
	};
	const panel = createChatPanelState();
	const intents = createPanelIntents();
	harness.session = {
		status: harness.sidecarStatus,
		chat: harness.hub.transport,
		panel,
		navigate: harness.navigate,
		openConversation: (conversationId) => {
			intents.push({ kind: "open", conversationId });
			panel.open();
		},
		startConversation: (prompt) => {
			intents.push({ kind: "start", prompt });
			panel.open();
		},
		pendingApprovals: ref(0),
		intents,
		currentPage: ref({
			path: "/sales/overview",
			title: "Sales overview · DMS",
		}),
		api: harness.api,
		lastError: harness.lastError,
		restart: harness.restart,
	};
	return harness;
}

let wrapper: VueWrapper | null = null;

/** Unmounts what the last test mounted. */
export function unmountPanel(): void {
	wrapper?.unmount();
	wrapper = null;
}

function mountPanel(harness: Harness): VueWrapper {
	wrapper = mount(ChatPanel, {
		attachTo: document.body,
		global: {
			provide: {
				[ASSISTANT_SESSION_KEY as symbol]: harness.session,
				[CHAT_I18N_KEY as symbol]: createTestI18n(),
			},
			stubs: PANEL_STUBS,
		},
	});
	return wrapper;
}

export async function openPanel(harness: Harness): Promise<VueWrapper> {
	const mounted = mountPanel(harness);
	harness.session.panel.toggle();
	await nextTick();
	await flushPromises();
	return mounted;
}

/** A sidecar event for the panel's conversation. */
export function deliver(
	harness: Harness,
	event: Record<string, unknown>,
): void {
	harness.hub.deliver({ conversationId: CONVERSATION_ID, ...event });
}

export function sentOfType(harness: Harness, type: string) {
	return harness.sent.filter((msg) => msg.type === type);
}

export async function sendMessage(
	panel: VueWrapper,
	text: string,
): Promise<void> {
	await panel.find("textarea").setValue(text);
	await panel.find("form.composer").trigger("submit");
}

/** The first button whose text contains `label`. */
export function buttonWithText(
	root: VueWrapper | ReturnType<VueWrapper["find"]>,
	label: string,
) {
	const button = root
		.findAll("button")
		.find((item) => item.text().includes(label));
	if (button === undefined) throw new Error(`no button "${label}"`);
	return button;
}
