export const OVERLAY_DEFAULT_WIDTH_PX = 460
export const OVERLAY_Z_INDEX = 999_999
export const OVERLAY_DOM_ID = 'dms-ai-overlay-root'
export const OVERLAY_IFRAME_ID = 'dms-ai-overlay-iframe'
export const SIDECAR_INFO_PATH = '/ai/sidecar-info'
export const SIDECAR_PROBE_HOST = 'http://localhost'
export const OVERLAY_BOX_SHADOW = '0 8px 24px rgba(0, 0, 0, 0.18)'
export const SIDECAR_HOST_NAME = 'localhost'
export const WS_HOST_PATH = '/ws/host'
export const WS_RECONNECT_DELAYS_MS = [
	1000, 2000, 4000, 8000, 15000, 30000,
] as const
// Sidecar reachability, as seen by the host. `reviving` is the self-healing
// state (idle-exited / crashed-respawning): the probe loop is relearning the new
// random port and will repoint the frame. `unavailable` is terminal (the crash
// budget is spent) and needs a reload.
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
export const OVERLAY_PLACEHOLDER_ID = 'dms-ai-overlay-placeholder'
export const PLACEHOLDER_CONNECTING_TEXT = 'Connecting the assistant…'
export const PLACEHOLDER_REVIVING_TEXT = 'Reconnecting the assistant…'
export const PLACEHOLDER_UNAVAILABLE_TITLE = 'Assistant unavailable'
export const PLACEHOLDER_UNAVAILABLE_TEXT = 'Reload the page to try again.'

export const WS_STATUS_CONNECTING = 'connecting'
export const WS_STATUS_CONNECTED = 'connected'
export const WS_STATUS_DISCONNECTED = 'disconnected'
export const WS_STATUS_RECONNECTING = 'reconnecting'
export const WS_PROTOCOL_SECURE = 'wss:'
export const WS_PROTOCOL_INSECURE = 'ws:'
export const PAGE_PROTOCOL_SECURE = 'https:'
export const HOST_ROLE = 'host'
export const HELLO_MESSAGE_TYPE = 'hello'
export const LOG_PREFIX = '[dms-ai]'
export const HOST_STATE_UPDATE_TYPE = 'host_state_update'
export const HOST_NAVIGATION_COMPLETE_TYPE = 'host_navigation_complete'
export const HOST_COMMAND_NAVIGATE_TYPE = 'host_command_navigate'
export const OVERLAY_RESIZE_HANDLE_SIZE_PX = 6
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
export const LAUNCHER_ACTION_ID = 'dms-ai-launcher'
export const LAUNCHER_ICON = 'i-ph-robot'
export const LAUNCHER_LABEL = 'AI assistant'
export const LAUNCHER_ORDER = 50
// Toggle shortcut, shown in the launcher tooltip. The combo is meta/ctrl + shift
// + k, so render it the way each platform expects.
export const TOGGLE_SHORTCUT_LABEL_MAC = '⌘⇧K'
export const TOGGLE_SHORTCUT_LABEL_OTHER = 'Ctrl+Shift+K'
