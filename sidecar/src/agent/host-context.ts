import {
  GENERATION_MODE_AGENT_NAMES,
  HOST_CONTEXT_CLOSE,
  HOST_CONTEXT_FILE_LABEL,
  HOST_CONTEXT_MODE_LABEL,
  HOST_CONTEXT_OPEN,
  HOST_CONTEXT_PAGE_LABEL,
  HOST_CONTEXT_TITLE_LABEL,
  HOST_CONTEXT_UNKNOWN_VALUE,
} from "../constants/agent.js";
import type { CurrentPage } from "../state/host-state.js";
import type { GenerationMode } from "../state/settings-types.js";

export function formatHostContext(
  page: CurrentPage,
  mode: GenerationMode,
): string {
  const lines = [
    `${HOST_CONTEXT_PAGE_LABEL}${page.path}`,
    `${HOST_CONTEXT_TITLE_LABEL}${page.title ?? HOST_CONTEXT_UNKNOWN_VALUE}`,
    `${HOST_CONTEXT_FILE_LABEL}${page.filepath ?? HOST_CONTEXT_UNKNOWN_VALUE}`,
    `${HOST_CONTEXT_MODE_LABEL}${GENERATION_MODE_AGENT_NAMES[mode]}`,
  ];
  return `${HOST_CONTEXT_OPEN}\n${lines.join("\n")}\n${HOST_CONTEXT_CLOSE}`;
}

export function prependHostContext(
  message: string,
  page: CurrentPage,
  mode: GenerationMode,
): string {
  return `${formatHostContext(page, mode)}\n\n${message}`;
}
