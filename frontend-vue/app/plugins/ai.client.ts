import {
	type DmsAppContext,
	type DmsI18n,
	defineDmsPlugin,
	useDmsRouter,
} from "#dms/frontend-module";
import { computed, type Ref, readonly, ref, watch } from "vue";
import { CHAT_I18N_KEY, type ChatI18n } from "../chat/composables/useChatI18n";
import type { ChatApi } from "../chat/composables/useChangeSetActions";
import type { CurrentPage } from "../chat/types/conversation";
import {
	type AssistantActivity,
	type AssistantStatusPayload,
	createAssistantActivity,
} from "../runtime/assistant-activity";
import { launcherAction, paletteSource } from "../runtime/assistant-commands";
import { installAssistantNotifications } from "../runtime/assistant-notifications";
import {
	ASSISTANT_SESSION_KEY,
	type AssistantSession,
} from "../runtime/assistant-session";
import {
	type ChannelClient,
	createChannelClient,
} from "../runtime/channel-client";
import {
	type ChatTransportHub,
	createChatTransport,
} from "../runtime/chat-transport";
import {
	CHANGES_PATH,
	CHANNEL_IDLE_STOP_MS,
	CHANNEL_STATUS_RECONNECTING,
	CHAT_PANEL_COMPONENT_NAME,
	HELLO_MESSAGE_TYPE,
	HOST_ROLE,
	JSON_CONTENT_TYPE,
	RESTART_PATH,
	SIDECAR_INFO_PATH,
	SIDECAR_STATUS_CONNECTED,
	SIDECAR_STATUS_REVIVING,
	STATUS_PATH,
	VISIBILITY_CHANGE_EVENT,
} from "../runtime/constants";
import {
	buildCurrentPageUpdate,
	installCurrentPageTracker,
} from "../runtime/current-page";
import { createFrameRouter } from "../runtime/frame-router";
import {
	createHostCommandDispatcher,
	type HostCommandDispatcher,
} from "../runtime/host-commands";
import { installNavigationCompleteEmitter } from "../runtime/navigation-complete";
import { createPanelIntents } from "../runtime/panel-intents";
import {
	type ChatPanelState,
	createChatPanelState,
} from "../runtime/panel-state";
import { runWhenLoggedIn } from "../runtime/session-gate";
import { installToggleShortcut } from "../runtime/shortcuts";
import {
	createSidecarStatusController,
	type SidecarStatus,
	type SidecarStatusController,
} from "../runtime/sidecar-status";

type AuthFetch = ReturnType<typeof useAuthFetch>["$authFetch"];
type Toaster = ReturnType<typeof useToast>;

interface ChannelDeps {
	$authFetch: AuthFetch;
	controller: SidecarStatusController;
	dispatchHostCommand: HostCommandDispatcher;
}

interface AssistantChannel {
	client: ChannelClient;
	chat: ChatTransportHub;
}

/** What the plugin takes from the DMS before its first await, while in context. */
interface DashboardDeps {
	$authFetch: AuthFetch;
	toaster: Toaster;
	devReload: ReturnType<typeof useDevReload>;
	router: ReturnType<typeof useDmsRouter>;
}

function postJson(
	$authFetch: AuthFetch,
	path: string,
	body?: unknown,
): Promise<unknown> {
	return $authFetch(path, {
		method: "POST",
		body: JSON.stringify(body ?? {}),
		headers: { "content-type": JSON_CONTENT_TYPE },
	});
}

function createAssistantChannel(deps: ChannelDeps): AssistantChannel {
	const chat = createChatTransport({
		send: (msg) => client.send(msg),
		reconnect: () => client.reconnectNow(),
		getStatus: () => client.getStatus(),
	});
	const client = createChannelClient({
		post: (path, body) => postJson(deps.$authFetch, path, body),
		onReady: () => {
			client.send({ type: HELLO_MESSAGE_TYPE, role: HOST_ROLE });
			client.send(buildCurrentPageUpdate(window.location.href));
			chat.announceReady();
		},
		onFrame: createFrameRouter({
			host: deps.dispatchHostCommand,
			chat: chat.deliver,
		}),
		onStatusChange: (status) => {
			chat.announceStatus(status);
			if (status === CHANNEL_STATUS_RECONNECTING)
				deps.controller.reportChannelDown();
		},
	});
	return { client, chat };
}

/**
 * The stream is open while the panel is, and while the tab shows a chat that
 * works or waits, so its events (and their toasts) still arrive; otherwise it
 * gives its connection back shortly after.
 */
function followPanel(
	panel: ChatPanelState,
	activity: AssistantActivity,
	client: ChannelClient,
): () => void {
	let stopTimer: ReturnType<typeof setTimeout> | null = null;
	const clearStopTimer = (): void => {
		if (stopTimer !== null) clearTimeout(stopTimer);
		stopTimer = null;
	};
	const follow = (): void => {
		clearStopTimer();
		const isVisible = document.visibilityState === "visible";
		const isNeeded = isVisible && (panel.isOpen.value || activity.isBusy.value);
		if (isNeeded) client.start();
		else stopTimer = setTimeout(() => client.stop(), CHANNEL_IDLE_STOP_MS);
	};
	const stopWatching = watch([panel.isOpen, activity.isBusy], follow);
	document.addEventListener(VISIBILITY_CHANGE_EVENT, follow);
	follow();
	return () => {
		clearStopTimer();
		stopWatching();
		document.removeEventListener(VISIBILITY_CHANGE_EVENT, follow);
	};
}

interface FollowedSidecarStatus {
	status: Readonly<Ref<SidecarStatus>>;
	stop: () => void;
}

function followSidecarStatus(
	controller: SidecarStatusController,
	client: ChannelClient,
): FollowedSidecarStatus {
	const status = ref<SidecarStatus>(controller.getStatus());
	// Only a sidecar coming back needs a fresh stream: replacing the one that
	// just opened would re-attach every chat and replay its running turn.
	const stop = controller.subscribe((next) => {
		if (
			next === SIDECAR_STATUS_CONNECTED &&
			status.value === SIDECAR_STATUS_REVIVING
		)
			client.reconnectNow();
		status.value = next;
	});
	return { status: readonly(status), stop };
}

function installHostState(
	client: ChannelClient,
	currentPage: Ref<CurrentPage | null>,
): () => void {
	const sendWhenConnected = (msg: unknown): void => {
		if (!client.isConnected()) return;
		client.send(msg);
	};
	const stopTracking = installCurrentPageTracker({
		send: (msg) => {
			currentPage.value = msg.currentPage;
			sendWhenConnected(msg);
		},
	});
	const stopNavigation = installNavigationCompleteEmitter({
		send: sendWhenConnected,
	});
	return () => {
		stopTracking();
		stopNavigation();
	};
}

function createChatI18n(i18n: DmsI18n): ChatI18n {
	return {
		t: (key, params, plural) =>
			plural === undefined
				? i18n.t(key, params ?? {})
				: i18n.t(key, params ?? {}, plural),
		locale: computed(() => String(i18n.locale.value)),
	};
}

function createApi($authFetch: AuthFetch): ChatApi {
	return {
		get: <T>(path: string) => $authFetch(path) as Promise<T>,
		post: <T>(path: string, body?: unknown) =>
			postJson($authFetch, path, body) as Promise<T>,
	};
}

interface SessionParts {
	deps: DashboardDeps;
	controller: SidecarStatusController;
	chat: ChatTransportHub;
	panel: ChatPanelState;
	status: Readonly<Ref<SidecarStatus>>;
	activity: AssistantActivity;
	currentPage: Ref<CurrentPage | null>;
}

function createSession(parts: SessionParts): AssistantSession {
	const { deps, panel, activity } = parts;
	const intents = createPanelIntents();
	return {
		status: parts.status,
		chat: parts.chat.transport,
		panel,
		navigate: (path) => void deps.router.push(path),
		openConversation: (conversationId) => {
			intents.push({ kind: "open", conversationId });
			panel.open();
		},
		startConversation: (prompt) => {
			intents.push({ kind: "start", prompt });
			panel.open();
		},
		pendingApprovals: activity.pendingApprovals,
		intents,
		currentPage: readonly(parts.currentPage),
		api: createApi(deps.$authFetch),
		lastError: activity.lastError,
		restart: async () => {
			try {
				await postJson(deps.$authFetch, RESTART_PATH);
			} finally {
				parts.controller.retry();
				void activity.refresh();
			}
		},
	};
}

function registerDashboardEntries(
	session: AssistantSession,
	i18n: ChatI18n,
): () => void {
	const register = (): void =>
		registerHeaderAction(
			launcherAction(
				i18n.t,
				session.panel.isOpen,
				session.panel.toggleFromLauncher,
			),
		);
	register();
	const stopWatchingLocale = watch(i18n.locale, register);
	registerCommandPaletteSource(
		paletteSource(i18n.t, session.pendingApprovals, {
			ask: () => {
				session.intents.push({ kind: "focus" });
				session.panel.open();
			},
			startConversation: () => session.startConversation(),
			reviewApprovals: () => {
				session.intents.push({ kind: "approvals" });
				session.panel.open();
			},
			openChanges: () => session.navigate(CHANGES_PATH),
		}),
	);
	return stopWatchingLocale;
}

function installToasts(
	session: AssistantSession,
	i18n: ChatI18n,
	toaster: Toaster,
): () => void {
	return installAssistantNotifications({
		chat: session.chat,
		isPanelOpen: session.panel.isOpen,
		pendingApprovals: session.pendingApprovals,
		t: i18n.t,
		toast: (input) => void toaster.add(input),
		reviewApprovals: (conversationId) => {
			if (conversationId !== undefined)
				session.openConversation(conversationId);
			session.intents.push({ kind: "approvals" });
			session.panel.open();
		},
		undoChangeSet: (set) =>
			session.chat.send({
				type: "change_set_action",
				conversationId: set.conversationId,
				changeSetId: set.id,
				action: "undo",
			}),
		reviewChangeSet: (id) =>
			session.navigate(`${CHANGES_PATH}?set=${encodeURIComponent(id)}`),
	});
}

/**
 * The launcher, the palette entries and the panel join the dashboard only once
 * the app is mounted: the server renders no assistant, and anything added
 * before hydration would make the client's tree, and the ids its tooltips and
 * menus draw, differ from the server's.
 */
function registerOnceMounted(
	context: DmsAppContext,
	appMounted: Promise<void>,
	session: AssistantSession,
	i18n: ChatI18n,
): () => void {
	let stop: (() => void) | null = null;
	let isActive = true;
	void appMounted.then(() => {
		if (!isActive) return;
		context.runWithContext(() => {
			stop = registerDashboardEntries(session, i18n);
			useAppOverlay().register(CHAT_PANEL_COMPONENT_NAME);
		});
	});
	return () => {
		isActive = false;
		stop?.();
	};
}

function wireAssistant(
	context: DmsAppContext,
	appMounted: Promise<void>,
	deps: DashboardDeps,
	controller: SidecarStatusController,
): () => void {
	const dispatchHostCommand = createHostCommandDispatcher({
		router: deps.router,
		devReload: deps.devReload,
	});
	const { client, chat } = createAssistantChannel({
		$authFetch: deps.$authFetch,
		controller,
		dispatchHostCommand,
	});
	const panel = createChatPanelState();
	const sidecarStatus = followSidecarStatus(controller, client);
	const activity = createAssistantActivity({
		fetchStatus: () =>
			deps.$authFetch(STATUS_PATH) as Promise<AssistantStatusPayload>,
		chat: chat.transport,
		shouldPoll: () =>
			!panel.isOpen.value ||
			sidecarStatus.status.value !== SIDECAR_STATUS_CONNECTED,
	});
	const currentPage = ref<CurrentPage | null>(null);
	const session = createSession({
		deps,
		controller,
		chat,
		panel,
		status: sidecarStatus.status,
		activity,
		currentPage,
	});
	const i18n = createChatI18n(context.$i18n);
	context.vueApp.provide(ASSISTANT_SESSION_KEY, session);
	context.vueApp.provide(CHAT_I18N_KEY, i18n);
	const stops = [
		registerOnceMounted(context, appMounted, session, i18n),
		installToasts(session, i18n, deps.toaster),
		installToggleShortcut({ onToggle: panel.toggle }),
		followPanel(panel, activity, client),
		installHostState(client, currentPage),
		sidecarStatus.stop,
		activity.stop,
		controller.dispose,
		client.stop,
	];
	void activity.refresh();
	return () => stops.forEach((stop) => stop());
}

async function startAssistant(
	context: DmsAppContext,
	appMounted: Promise<void>,
): Promise<void> {
	const deps: DashboardDeps = {
		$authFetch: useAuthFetch().$authFetch,
		toaster: useToast(),
		devReload: useDevReload(),
		router: useDmsRouter(),
	};
	const controller = createSidecarStatusController(() =>
		deps.$authFetch(SIDECAR_INFO_PATH),
	);
	if (!(await controller.init())) return;
	const teardown = context.runWithContext(() =>
		wireAssistant(context, appMounted, deps, controller),
	);
	context.vueApp.onUnmount(teardown);
	import.meta.hot?.dispose(teardown);
}

/**
 * The assistant appears for a signed-in owner in development only: a first
 * probe that finds no dms-ai backend, or a disabled sidecar, leaves no trace.
 */
export default defineDmsPlugin((context) => {
	if (!import.meta.env.DEV) return;
	const appMounted = new Promise<void>((resolve) =>
		context.hook("app:mounted", resolve),
	);
	const { loggedIn } = useUserSession();
	const stopGate = runWhenLoggedIn(
		() => loggedIn.value,
		() =>
			void context.runWithContext(() => startAssistant(context, appMounted)),
	);
	context.vueApp.onUnmount(stopGate);
});
