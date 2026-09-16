import { onBeforeUnmount, onMounted, type Ref, ref } from "vue";
import {
	CLIENT_MESSAGE_TYPES,
	CONNECTION_STATUSES,
	type ConnectionStatus,
	PAGE_PROTOCOL_SECURE,
	ROLES,
	WS_PROTOCOLS,
	WS_RECONNECT_DELAYS_MS,
} from "../constants/ws";
import {
	type BackoffState,
	createBackoff,
	nextDelay,
	resetBackoff,
} from "./useBackoff";

export interface UseWsOptions {
	path: string;
	getConversationId: () => string;
}

export type WsMessageHandler = (msg: unknown) => void;

export interface UseWsResult {
	send: (msg: object) => void;
	onMessage: (handler: WsMessageHandler) => () => void;
	reconnect: () => void;
	reidentify: () => void;
	isConnected: Ref<boolean>;
	connectionStatus: Ref<ConnectionStatus>;
}

interface ConnectionHandlers {
	onOpen: () => void;
	onMessage: (data: unknown) => void;
	onClose: () => void;
}

interface Connection {
	socket: WebSocket;
	teardown: () => void;
}

function buildSocketUrl(path: string): string {
	const isSecure = window.location.protocol === PAGE_PROTOCOL_SECURE;
	const protocol = isSecure ? WS_PROTOCOLS.SECURE : WS_PROTOCOLS.INSECURE;
	return `${protocol}//${window.location.host}${path}`;
}

function buildHello(conversationId: string): object {
	return {
		type: CLIENT_MESSAGE_TYPES.HELLO,
		role: ROLES.IFRAME,
		conversationId,
	};
}

function safeParseMessage(raw: string): unknown {
	try {
		return JSON.parse(raw);
	} catch {
		return null;
	}
}

function attachListeners(
	socket: WebSocket,
	handlers: ConnectionHandlers,
): () => void {
	const onOpen = (): void => handlers.onOpen();
	const onMessage = (event: MessageEvent<string>): void => {
		const parsed = safeParseMessage(event.data);
		if (parsed === null) return;
		handlers.onMessage(parsed);
	};
	const onClose = (): void => handlers.onClose();
	socket.addEventListener("open", onOpen);
	socket.addEventListener("message", onMessage);
	socket.addEventListener("close", onClose);
	return (): void => {
		socket.removeEventListener("open", onOpen);
		socket.removeEventListener("message", onMessage);
		socket.removeEventListener("close", onClose);
	};
}

function createConnection(
	url: string,
	handlers: ConnectionHandlers,
): Connection {
	const token = new URLSearchParams(window.location.hash.slice(1)).get("token");
	const socket = new WebSocket(url, token ? `dms-ai.${token}` : []);
	const detach = attachListeners(socket, handlers);
	const teardown = (): void => {
		detach();
		socket.close();
	};
	return { socket, teardown };
}

function createSubscribers(): {
	register: (handler: WsMessageHandler) => () => void;
	dispatch: (msg: unknown) => void;
} {
	const handlers = new Set<WsMessageHandler>();
	const register = (handler: WsMessageHandler): (() => void) => {
		handlers.add(handler);
		return (): void => {
			handlers.delete(handler);
		};
	};
	const dispatch = (msg: unknown): void => {
		for (const handler of handlers) handler(msg);
	};
	return { register, dispatch };
}

interface ReconnectContext {
	url: string;
	getConversationId: () => string;
	backoff: BackoffState;
	dispatch: (msg: unknown) => void;
	connectionStatus: Ref<ConnectionStatus>;
	isConnected: Ref<boolean>;
	getIntentionallyClosed: () => boolean;
	setConnection: (conn: Connection | null) => void;
	getConnection: () => Connection | null;
}

function sendHelloOnSocket(socket: WebSocket, conversationId: string): void {
	if (socket.readyState !== WebSocket.OPEN) return;
	socket.send(JSON.stringify(buildHello(conversationId)));
}

function handleSocketOpen(ctx: ReconnectContext): void {
	resetBackoff(ctx.backoff);
	ctx.isConnected.value = true;
	ctx.connectionStatus.value = CONNECTION_STATUSES.CONNECTED;
	const conn = ctx.getConnection();
	if (conn !== null) sendHelloOnSocket(conn.socket, ctx.getConversationId());
}

function handleSocketClose(ctx: ReconnectContext): void {
	ctx.isConnected.value = false;
	if (ctx.getIntentionallyClosed()) {
		ctx.connectionStatus.value = CONNECTION_STATUSES.DISCONNECTED;
		return;
	}
	ctx.connectionStatus.value = CONNECTION_STATUSES.RECONNECTING;
	const delay = nextDelay(ctx.backoff, WS_RECONNECT_DELAYS_MS);
	setTimeout(() => openWithReconnect(ctx), delay);
}

function openWithReconnect(ctx: ReconnectContext): void {
	if (ctx.getIntentionallyClosed()) return;
	const conn = createConnection(ctx.url, {
		onOpen: () => handleSocketOpen(ctx),
		onMessage: (data) => ctx.dispatch(data),
		onClose: () => handleSocketClose(ctx),
	});
	ctx.setConnection(conn);
}

function buildContext(
	options: UseWsOptions,
	state: {
		isConnected: Ref<boolean>;
		connectionStatus: Ref<ConnectionStatus>;
		dispatch: (msg: unknown) => void;
		getIntentionallyClosed: () => boolean;
		setConnection: (c: Connection | null) => void;
		getConnection: () => Connection | null;
	},
): ReconnectContext {
	return {
		url: buildSocketUrl(options.path),
		getConversationId: options.getConversationId,
		backoff: createBackoff(),
		dispatch: state.dispatch,
		connectionStatus: state.connectionStatus,
		isConnected: state.isConnected,
		getIntentionallyClosed: state.getIntentionallyClosed,
		setConnection: state.setConnection,
		getConnection: state.getConnection,
	};
}

export function useWs(options: UseWsOptions): UseWsResult {
	const isConnected = ref(false);
	const connectionStatus = ref<ConnectionStatus>(
		CONNECTION_STATUSES.CONNECTING,
	);
	const subscribers = createSubscribers();
	let connection: Connection | null = null;
	let intentionallyClosed = false;
	let activeContext: ReconnectContext | null = null;

	const send = (msg: object): void => {
		if (connection === null) return;
		if (connection.socket.readyState !== WebSocket.OPEN) return;
		connection.socket.send(JSON.stringify(msg));
	};

	const reidentify = (): void => {
		if (connection === null) return;
		sendHelloOnSocket(connection.socket, options.getConversationId());
	};

	const reconnect = (): void => {
		if (activeContext === null) return;
		intentionallyClosed = false;
		resetBackoff(activeContext.backoff);
		if (connection !== null) {
			connection.teardown();
			connection = null;
		}
		isConnected.value = false;
		connectionStatus.value = CONNECTION_STATUSES.CONNECTING;
		openWithReconnect(activeContext);
	};

	onMounted(() => {
		activeContext = buildContext(options, {
			isConnected,
			connectionStatus,
			dispatch: subscribers.dispatch,
			getIntentionallyClosed: () => intentionallyClosed,
			setConnection: (c) => {
				connection = c;
			},
			getConnection: () => connection,
		});
		connectionStatus.value = CONNECTION_STATUSES.CONNECTING;
		openWithReconnect(activeContext);
	});

	onBeforeUnmount(() => {
		intentionallyClosed = true;
		if (connection === null) return;
		connection.teardown();
		connection = null;
		connectionStatus.value = CONNECTION_STATUSES.DISCONNECTED;
	});

	return {
		send,
		onMessage: subscribers.register,
		reconnect,
		reidentify,
		isConnected,
		connectionStatus,
	};
}
