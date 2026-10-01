import { effectiveGenerationMode } from "../builder/capability.js";
import type {
  AppSettings,
  ChatboxMode,
  GenerationMode,
} from "../state/settings-types.js";

const MODE_IN_FORCE: Record<
  GenerationMode,
  Record<ChatboxMode, ChatboxMode>
> = {
  safe: {
    normal: "normal",
    acceptEdits: "acceptEdits",
    plan: "plan",
    auto: "acceptEdits",
  },
  vibe: {
    normal: "normal",
    acceptEdits: "acceptEdits",
    plan: "plan",
    auto: "auto",
  },
};

/**
 * The chatbox mode a turn actually runs under. Safe mode caps it at
 * `acceptEdits`: *Auto* approves every prompt, and in safe mode the prompts that
 * remain (reads outside the workspace, web access) must still reach the user.
 * Every consumer of the mode reads it through here: the Claude permission mode,
 * the Codex policy and the permission bus's auto-approval.
 */
export function effectiveChatboxMode(settings: AppSettings): ChatboxMode {
  const generationMode = effectiveGenerationMode(settings.generationMode);
  return MODE_IN_FORCE[generationMode][settings.mode];
}
