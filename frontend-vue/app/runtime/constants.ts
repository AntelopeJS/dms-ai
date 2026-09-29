export const OVERLAY_DEFAULT_WIDTH_PX = 460
/**
 * Above the dashboard's header and the builder's overlay (z-50), below what the
 * dashboard portals out of the app: the DMS paints its popovers, modals and
 * toasts in an isolated layer after the app, whatever this value is.
 */
export const OVERLAY_Z_INDEX = 55
export const OVERLAY_DOM_ID = 'dms-ai-overlay-root'
export const SIDECAR_INFO_PATH = '/ai/sidecar-info'
/** Event stream to receive, POST to send: HTTP the DMS frontend server relays. */
export const CHANNEL_PATH = '/ai/channel'
export const CHANNEL_EVENTS_PATH = `${CHANNEL_PATH}/events`
export const CHANNEL_MESSAGES_SEGMENT = 'messages'
export const CHANNEL_EVENT_READY = 'ready'
/** A sidecar frame: the stream's default event name. */
export const CHANNEL_EVENT_FRAME = 'message'
/**
 * How long the stream outlives a closed panel or a hidden tab, so a quick
 * close and reopen does not reconnect, while a tab left in the background soon
 * gives back its one of the browser's six HTTP/1.1 connections to the dashboard.
 */
export const CHANNEL_IDLE_STOP_MS = 2_000
export const EVENT_STREAM_TYPE = 'text/event-stream'
export const JSON_CONTENT_TYPE = 'application/json'
export const CHANNEL_RECONNECT_DELAYS_MS = [
	1000, 2000, 4000, 8000, 15000, 30000,
] as const
// Sidecar reachability, as seen by the host. `reviving` is the self-healing
// state (idle-exited / crashed-respawning): the probe loop revives the sidecar
// and the channels reconnect once it answers. `unavailable` is terminal (the
// crash budget is spent) and needs a reload.
export const SIDECAR_STATUS_CONNECTING = 'connecting'
export const SIDECAR_STATUS_CONNECTED = 'connected'
export const SIDECAR_STATUS_REVIVING = 'reviving'
export const SIDECAR_STATUS_UNAVAILABLE = 'unavailable'
// Re-probe cadence while reviving. Each probe also revives the daemon backend
// side, so this doubles as the respawn heartbeat; capped so a genuinely stuck
// sidecar is polled sparingly rather than hammered.
export const SIDECAR_POLL_DELAYS_MS = [
	500, 1000, 2000, 4000, 8000,
] as const
export const PLACEHOLDER_CONNECTING_TEXT = 'Connecting the assistant…'
export const PLACEHOLDER_REVIVING_TEXT = 'Reconnecting the assistant…'
export const PLACEHOLDER_UNAVAILABLE_TITLE = 'Assistant unavailable'
export const PLACEHOLDER_UNAVAILABLE_TEXT = 'Reload the page to try again.'

export const CHANNEL_STATUS_CONNECTING = 'connecting'
export const CHANNEL_STATUS_CONNECTED = 'connected'
export const CHANNEL_STATUS_DISCONNECTED = 'disconnected'
export const CHANNEL_STATUS_RECONNECTING = 'reconnecting'
export const HOST_ROLE = 'host'
export const HELLO_MESSAGE_TYPE = 'hello'
export const LOG_PREFIX = '[dms-ai]'
export const HOST_STATE_UPDATE_TYPE = 'host_state_update'
export const HOST_NAVIGATION_COMPLETE_TYPE = 'host_navigation_complete'
export const HOST_COMMAND_NAVIGATE_TYPE = 'host_command_navigate'
/** Frames of the tab's stream meant for the dashboard; every other one is the chat's. */
export const HOST_COMMAND_TYPES: ReadonlySet<string> = new Set([
	HOST_COMMAND_NAVIGATE_TYPE,
])
export const OVERLAY_MIN_WIDTH_PX = 320
export const OVERLAY_PREFS_STORAGE_KEY = 'dms-ai:overlay-prefs'
export const OVERLAY_OUTSIDE_TOGGLE_SUPPRESS_MS = 300
export const OVERLAY_PREFS_DEBOUNCE_MS = 300
export const TOGGLE_SHORTCUT_KEY = 'k'
export const MODAL_OPEN_SELECTOR = '[role="dialog"][aria-modal="true"]'

// Generic header-action registry exposed by the DMS core (dms-back). Any module
// can push a button by writing to this shared Nuxt state key; the core renders
// it with no knowledge of who registered it.
export const HEADER_ACTIONS_STATE_KEY = 'dms:header-actions'
/**
 * The DMS's persistent overlays: components rendered on every page, inside the
 * app but outside the routed page, so they live through Inertia navigations.
 * The state key and the component name are the whole contract.
 */
export const APP_OVERLAYS_STATE_KEY = 'dms-app-overlays'
export const CHAT_PANEL_COMPONENT_NAME = 'DmsAiChatPanel'
export const LAUNCHER_ACTION_ID = 'dms-ai-launcher'
/**
 * The chat panel's header shows the same icon, which is what gets it into the
 * renderer's icon bundle: it only scans `.vue` files for icon names.
 */
export const LAUNCHER_ICON = 'i-ph-robot'
export const LAUNCHER_LABEL = 'AI assistant'
export const LAUNCHER_ORDER = 50
// Toggle shortcut, shown in the launcher tooltip. The combo is meta/ctrl + shift
// + k, so render it the way each platform expects.
export const TOGGLE_SHORTCUT_LABEL_MAC = '⌘⇧K'
export const TOGGLE_SHORTCUT_LABEL_OTHER = 'Ctrl+Shift+K'
