/**
 * Where the chat finds the dashboard's transport on its parent window: the
 * dashboard owns the tab's one stream to the sidecar and lends the chat its
 * channel of it.
 */
export const CHAT_TRANSPORT_KEY = "dmsAiChatTransport";

/** Retries while the dashboard has not published its transport yet. */
export const TRANSPORT_LOOKUP_DELAYS_MS = [100, 250, 500, 1000, 2000] as const;

export const CHAT_TRANSPORT_METHODS = [
	"onFrame",
	"onReady",
	"onStatus",
	"getStatus",
	"send",
	"reconnect",
] as const;
