import { useDmsState as useState } from '#dms/frontend-module'
import {
	HEADER_ACTIONS_STATE_KEY,
	LAUNCHER_ACTION_ID,
	LAUNCHER_ICON,
	LAUNCHER_LABEL,
	LAUNCHER_ORDER,
	TOGGLE_SHORTCUT_LABEL_MAC,
	TOGGLE_SHORTCUT_LABEL_OTHER,
} from './constants'

interface UserAgentData {
	platform?: string
}

interface NavigatorUserAgentData {
	userAgentData?: UserAgentData
}

// The shortcut combo accepts meta OR ctrl, so show the modifier each platform
// actually uses (⌘ on Apple, Ctrl elsewhere).
function isApplePlatform(): boolean {
	const nav = globalThis.navigator as
		| (Navigator & NavigatorUserAgentData)
		| undefined
	if (nav === undefined) return false
	const platform = nav.userAgentData?.platform ?? nav.platform ?? ''
	return /mac|iphone|ipad|ipod/i.test(platform)
}

function launcherLabel(): string {
	const shortcut = isApplePlatform()
		? TOGGLE_SHORTCUT_LABEL_MAC
		: TOGGLE_SHORTCUT_LABEL_OTHER
	return `${LAUNCHER_LABEL} (${shortcut})`
}

// Our view of the shared header-action shape the DMS core renders. Declared
// locally so this layer has no build-time dependency on the core layer; the
// only contract is the state key and these fields.
interface HeaderAction {
	id: string
	icon: string
	label: string
	onSelect: () => void
	order?: number
}

// Register the assistant launcher in the core's generic header-action registry.
// Idempotent so a re-running plugin can't add a duplicate button.
export function registerLauncherAction(onSelect: () => void): void {
	const actions = useState<HeaderAction[]>(HEADER_ACTIONS_STATE_KEY, () => [])
	if (actions.value.some((action) => action.id === LAUNCHER_ACTION_ID)) return
	actions.value = [
		...actions.value,
		{
			id: LAUNCHER_ACTION_ID,
			icon: LAUNCHER_ICON,
			label: launcherLabel(),
			order: LAUNCHER_ORDER,
			onSelect,
		},
	]
}
