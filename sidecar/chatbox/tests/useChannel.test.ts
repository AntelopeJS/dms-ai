import { afterEach, describe, expect, it } from "vitest";
import { type Channel, createChannel } from "../src/composables/useChannel";
import { CHAT_TRANSPORT_KEY } from "../src/constants/channel";
import {
	CLIENT_MESSAGE_TYPES,
	CONNECTION_STATUSES,
	ROLES,
	SERVER_EVENT_TYPES,
} from "../src/constants/ws";

const CONVERSATION_ID = "conv-channel-1";

const HELLO = {
	type: CLIENT_MESSAGE_TYPES.HELLO,
	role: ROLES.IFRAME,
	conversationId: CONVERSATION_ID,
};

interface FakeTransport {
	sent: unknown[];
	reconnects: number;
	status: string;
	emitFrame: (raw: string) => void;
	emitReady: () => void;
	emitStatus: (status: string) => void;
}

function listeners<T extends unknown[]>() {
	const set = new Set<(...args: T) => void>();
	return {
		add: (listener: (...args: T) => void) => {
			set.add(listener);
			return () => {
				set.delete(listener);
			};
		},
		emit: (...args: T) => {
			for (const listener of set) listener(...args);
		},
	};
}

/** Publishes a dashboard transport where the chat document looks for it. */
function publishTransport(status: string): FakeTransport {
	const frames = listeners<[string]>();
	const readies = listeners<[]>();
	const statuses = listeners<[string]>();
	const fake: FakeTransport = {
		sent: [],
		reconnects: 0,
		status,
		emitFrame: frames.emit,
		emitReady: readies.emit,
		emitStatus: statuses.emit,
	};
	Reflect.set(globalThis, "parent", {
		[CHAT_TRANSPORT_KEY]: {
			onFrame: frames.add,
			onReady: readies.add,
			onStatus: statuses.add,
			getStatus: () => fake.status,
			send: (msg: unknown) => {
				if (fake.status !== CONNECTION_STATUSES.CONNECTED) return false;
				fake.sent.push(msg);
				return true;
			},
			reconnect: () => {
				fake.reconnects += 1;
			},
		},
	});
	return fake;
}

let channel: Channel | undefined;

function open(): Channel {
	channel = createChannel({ getConversationId: () => CONVERSATION_ID });
	channel.start();
	return channel;
}

afterEach(() => {
	channel?.stop();
	channel = undefined;
	Reflect.deleteProperty(globalThis, "parent");
});

describe("the chat's channel, lent by the dashboard", () => {
	it("hands the chat every frame of its channel, a running turn's progress included", () => {
		const transport = publishTransport(CONNECTION_STATUSES.CONNECTED);
		const received: unknown[] = [];
		open().result.onMessage((msg) => received.push(msg));
		const progress = {
			type: SERVER_EVENT_TYPES.RUN_PROGRESS,
			conversationId: CONVERSATION_ID,
			activity: "Running a tool",
			elapsedMs: 5_000,
			idleMs: 0,
		};
		transport.emitFrame(JSON.stringify(progress));
		transport.emitFrame("not json");
		expect(received).toEqual([progress]);
	});

	it("says hello with its conversation when it attaches and on every new connection", () => {
		const transport = publishTransport(CONNECTION_STATUSES.CONNECTED);
		open();
		transport.emitReady();
		expect(transport.sent).toEqual([HELLO, HELLO]);
	});

	it("tells the chat a message did not leave while the dashboard's stream is down", () => {
		const transport = publishTransport(CONNECTION_STATUSES.RECONNECTING);
		const { result } = open();
		expect(result.isConnected.value).toBe(false);
		expect(result.send({ type: CLIENT_MESSAGE_TYPES.INTERRUPT_TURN })).toBe(
			false,
		);
		transport.status = CONNECTION_STATUSES.CONNECTED;
		transport.emitStatus(CONNECTION_STATUSES.CONNECTED);
		expect(result.isConnected.value).toBe(true);
		expect(result.send({ type: CLIENT_MESSAGE_TYPES.INTERRUPT_TURN })).toBe(
			true,
		);
	});

	it("reconnects through the dashboard's stream when the chat asks, as the stalled-run notice does", () => {
		const transport = publishTransport(CONNECTION_STATUSES.CONNECTED);
		open().result.reconnect();
		expect(transport.reconnects).toBe(1);
	});

	it("hands nothing over once stopped", () => {
		const transport = publishTransport(CONNECTION_STATUSES.CONNECTED);
		const received: unknown[] = [];
		const opened = open();
		opened.result.onMessage((msg) => received.push(msg));
		opened.stop();
		transport.emitFrame("{}");
		expect(received).toEqual([]);
	});
});
