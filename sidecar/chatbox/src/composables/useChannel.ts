import { onBeforeUnmount, onMounted, type Ref, ref } from "vue";
import {
	CHAT_TRANSPORT_KEY,
	CHAT_TRANSPORT_METHODS,
	TRANSPORT_LOOKUP_DELAYS_MS,
} from "../constants/channel";
import {
	CLIENT_MESSAGE_TYPES,
	CONNECTION_STATUSES,
	type ConnectionStatus,
	ROLES,
} from "../constants/ws";
import { type BackoffState, createBackoff, nextDelay } from "./useBackoff";

export interface UseChannelOptions {
	getConversationId: () => string;
}

export type ChannelMessageHandler = (msg: unknown) => void;

export interface UseChannelResult {
	/** False when the message was dropped: the channel is not connected. */
	send: (msg: object) => boolean;
	onMessage: (handler: ChannelMessageHandler) => () => void;
	reconnect: () => void;
	reidentify: () => void;
	isConnected: Ref<boolean>;
	connectionStatus: Ref<ConnectionStatus>;
}

/** The dashboard's side of the chat channel, published on the parent window. */
interface ChatTransport {
	onFrame: (listener: (raw: string) => void) => () => void;
	onReady: (listener: () => void) => () => void;
	onStatus: (listener: (status: string) => void) => () => void;
	getStatus: () => string;
	send: (msg: unknown) => boolean;
	reconnect: () => void;
}

interface ChannelState {
	options: UseChannelOptions;
	dispatch: ChannelMessageHandler;
	isConnected: Ref<boolean>;
	connectionStatus: Ref<ConnectionStatus>;
	transport: ChatTransport | null;
	detachers: Array<() => void>;
	lookup: BackoffState;
	lookupTimer: ReturnType<typeof setTimeout> | null;
}

const KNOWN_STATUSES = new Set<string>(Object.values(CONNECTION_STATUSES));

function isTransport(value: unknown): value is ChatTransport {
	if (value === null || typeof value !== "object") return false;
	return CHAT_TRANSPORT_METHODS.every(
		(method) => typeof Reflect.get(value, method) === "function",
	);
}

function findTransport(): ChatTransport | null {
	try {
		const candidate: unknown = Reflect.get(
			globalThis.parent,
			CHAT_TRANSPORT_KEY,
		);
		return isTransport(candidate) ? candidate : null;
	} catch {
		return null;
	}
}

function safeParse(raw: string): unknown {
	try {
		return JSON.parse(raw);
	} catch {
		return null;
	}
}

function setStatus(state: ChannelState, status: string): void {
	if (!KNOWN_STATUSES.has(status)) return;
	state.connectionStatus.value = status as ConnectionStatus;
	state.isConnected.value = status === CONNECTION_STATUSES.CONNECTED;
}

function sendHello(state: ChannelState): void {
	state.transport?.send({
		type: CLIENT_MESSAGE_TYPES.HELLO,
		role: ROLES.IFRAME,
		conversationId: state.options.getConversationId(),
	});
}

function attach(state: ChannelState, transport: ChatTransport): void {
	state.transport = transport;
	state.detachers = [
		transport.onFrame((raw) => {
			const parsed = safeParse(raw);
			if (parsed !== null) state.dispatch(parsed);
		}),
		transport.onReady(() => sendHello(state)),
		transport.onStatus((status) => setStatus(state, status)),
	];
	setStatus(state, transport.getStatus());
	if (state.isConnected.value) sendHello(state);
}

function lookUp(state: ChannelState): void {
	const transport = findTransport();
	if (transport !== null) {
		attach(state, transport);
		return;
	}
	const delay = nextDelay(state.lookup, TRANSPORT_LOOKUP_DELAYS_MS);
	state.lookupTimer = setTimeout(() => lookUp(state), delay);
}

function detach(state: ChannelState): void {
	if (state.lookupTimer !== null) clearTimeout(state.lookupTimer);
	state.lookupTimer = null;
	for (const stop of state.detachers) stop();
	state.detachers = [];
	state.transport = null;
}

interface Subscribers {
	register: (handler: ChannelMessageHandler) => () => void;
	dispatch: ChannelMessageHandler;
}

function createSubscribers(): Subscribers {
	const handlers = new Set<ChannelMessageHandler>();
	return {
		register: (handler) => {
			handlers.add(handler);
			return () => handlers.delete(handler);
		},
		dispatch: (msg) => {
			for (const handler of handlers) handler(msg);
		},
	};
}

export interface Channel {
	result: UseChannelResult;
	/** Finds the dashboard's transport, retrying until it is published. */
	start: () => void;
	/** Lets the transport go: no frame reaches the chat after this. */
	stop: () => void;
}

/** The channel without the component lifecycle, which `useChannel` adds. */
export function createChannel(options: UseChannelOptions): Channel {
	const subscribers = createSubscribers();
	const state: ChannelState = {
		options,
		dispatch: subscribers.dispatch,
		isConnected: ref(false),
		connectionStatus: ref<ConnectionStatus>(CONNECTION_STATUSES.CONNECTING),
		transport: null,
		detachers: [],
		lookup: createBackoff(),
		lookupTimer: null,
	};
	return {
		result: {
			send: (msg) => state.transport?.send(msg) === true,
			onMessage: subscribers.register,
			reconnect: () => state.transport?.reconnect(),
			reidentify: () => sendHello(state),
			isConnected: state.isConnected,
			connectionStatus: state.connectionStatus,
		},
		start: () => lookUp(state),
		stop: () => detach(state),
	};
}

/**
 * The chat's channel to the sidecar, lent by the dashboard that embeds it: both
 * documents share an origin, and one stream per tab keeps the browser's six
 * HTTP/1.1 connections to the dashboard for everything else. Same interface as
 * the WebSocket composable it replaces; a `hello` goes out on every
 * (re)connection, and the listeners are dropped when this document goes away.
 */
export function useChannel(options: UseChannelOptions): UseChannelResult {
	const channel = createChannel(options);
	onMounted(() => {
		globalThis.addEventListener("pagehide", channel.stop);
		channel.start();
	});
	onBeforeUnmount(() => {
		globalThis.removeEventListener("pagehide", channel.stop);
		channel.stop();
	});
	return channel.result;
}
