import {
  HOST_CONTEXT_CLOSE,
  HOST_CONTEXT_FILE_LABEL,
  HOST_CONTEXT_MODE_LABEL,
  HOST_CONTEXT_OPEN,
  HOST_CONTEXT_PAGE_LABEL,
  HOST_CONTEXT_TITLE_LABEL,
} from "../constants/agent.js";
import type { CurrentPage } from "../state/host-state.js";
import type { GenerationMode } from "../state/settings-types.js";

export function formatHostContext(
  page: CurrentPage,
  mode: GenerationMode,
): string {
  const lines = [`${HOST_CONTEXT_PAGE_LABEL}${page.path}`];
  if (page.filepath !== undefined) {
    lines.push(`${HOST_CONTEXT_FILE_LABEL}${page.filepath}`);
  }
  if (page.title !== undefined) {
    lines.push(`${HOST_CONTEXT_TITLE_LABEL}${page.title}`);
  }
  lines.push(`${HOST_CONTEXT_MODE_LABEL}${mode}`);
  return `${HOST_CONTEXT_OPEN}\n${lines.join("\n")}\n${HOST_CONTEXT_CLOSE}`;
}

export function prependHostContext(
  message: string,
  page: CurrentPage,
  mode: GenerationMode,
): string {
  return `${formatHostContext(page, mode)}\n\n${message}`;
}
