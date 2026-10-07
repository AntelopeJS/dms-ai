import type { Ref } from "vue";
import type { Translate } from "../chat/composables/useChatI18n";
import { shortcutLabel } from "../chat/utils/platform";
import {
	COMMAND_PALETTE_ORDER,
	COMMAND_PALETTE_SOURCE_ID,
	LAUNCHER_ACTION_ID,
	LAUNCHER_ICON,
	LAUNCHER_LABEL_KEY,
	LAUNCHER_ORDER,
	TOGGLE_SHORTCUT_KEY,
} from "./constants";

/** The header button, in the shape `registerHeaderAction` takes. */
export interface LauncherAction {
	id: string;
	icon: string;
	label: string;
	order: number;
	onSelect: () => void;
	isActive: () => boolean;
}

/** One entry of the command palette. */
export interface PaletteItem {
	id: string;
	label: string;
	icon: string;
	suffix?: string;
	onSelect: () => void;
}

export interface PaletteGroup {
	id: string;
	label: string;
	items: PaletteItem[];
}

/** A command palette source, in the shape `registerCommandPaletteSource` takes. */
export interface PaletteSource {
	id: string;
	order: number;
	groups: () => PaletteGroup[];
}

/** What the palette's entries do. */
export interface AssistantCommandActions {
	ask: () => void;
	startConversation: () => void;
	reviewApprovals: () => void;
	openChanges: () => void;
}

/** "Assistant (⌘⇧K)": the launcher's label with its shortcut. */
export function launcherAction(
	t: Translate,
	isOpen: Readonly<Ref<boolean>>,
	onSelect: () => void,
): LauncherAction {
	return {
		id: LAUNCHER_ACTION_ID,
		icon: LAUNCHER_ICON,
		label: `${t(LAUNCHER_LABEL_KEY)} (${shortcutLabel(TOGGLE_SHORTCUT_KEY, true)})`,
		order: LAUNCHER_ORDER,
		onSelect,
		isActive: () => isOpen.value,
	};
}

/**
 * The assistant's entries in the DMS command palette: the palette has no mode
 * of its own for the assistant, so it offers ways into the panel instead.
 */
export function paletteSource(
	t: Translate,
	pendingApprovals: Readonly<Ref<number>>,
	actions: AssistantCommandActions,
): PaletteSource {
	return {
		id: COMMAND_PALETTE_SOURCE_ID,
		order: COMMAND_PALETTE_ORDER,
		groups: () => [
			{
				id: `${COMMAND_PALETTE_SOURCE_ID}-assistant`,
				label: t("dms_ai.panel.palette.group"),
				items: [
					{
						id: "dms-ai-ask",
						label: t("dms_ai.panel.palette.ask"),
						icon: "i-ph-sparkle",
						suffix: shortcutLabel(TOGGLE_SHORTCUT_KEY, true),
						onSelect: actions.ask,
					},
					{
						id: "dms-ai-new",
						label: t("dms_ai.panel.palette.new"),
						icon: "i-ph-note-pencil",
						onSelect: actions.startConversation,
					},
					{
						id: "dms-ai-approvals",
						label: t("dms_ai.panel.palette.approvals"),
						icon: "i-ph-hand-palm",
						suffix:
							pendingApprovals.value > 0
								? t(
										"dms_ai.panel.palette.waiting",
										{ count: pendingApprovals.value },
										pendingApprovals.value,
									)
								: undefined,
						onSelect: actions.reviewApprovals,
					},
					{
						id: "dms-ai-changes",
						label: t("dms_ai.panel.palette.changes"),
						icon: "i-ph-git-diff",
						onSelect: actions.openChanges,
					},
				],
			},
		],
	};
}
