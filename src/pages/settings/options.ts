import { I18N_SECTIONS } from "../../constants/i18n";
import { i18nKey, type VocabularyOption } from "../../vocabulary";

const SECTION = I18N_SECTIONS.SETTINGS;

/** A settings text, under `$dms_ai.settings`. */
export function settingsText(...segments: string[]): string {
  return i18nKey(SECTION, ...segments);
}

interface ChoiceDeclaration {
  value: string;
  icon?: string;
  /** Shown, never picked. */
  disabled?: boolean;
}

/** Options labelled `<field>.<value>.label`, described `<field>.<value>.description`. */
function choices(
  field: string,
  declarations: readonly ChoiceDeclaration[],
): VocabularyOption[] {
  return declarations.map(({ value, icon, disabled }) => ({
    value,
    label: settingsText(field, value, "label"),
    description: settingsText(field, value, "description"),
    icon,
    disabled,
  }));
}

/** Options labelled `<field>.<value>`, for compact selects. */
function labels(field: string, values: readonly string[]): VocabularyOption[] {
  return values.map((value) => ({
    value,
    label: settingsText(field, "options", value),
  }));
}

export const CODEX_PROVIDER = "codex";
export const SAFE_SCOPE = "safe";

export const PROVIDER_OPTIONS = choices("provider", [
  { value: "claude", icon: "i-ph-robot" },
  { value: CODEX_PROVIDER, icon: "i-ph-robot" },
]);

export const THINKING_OPTIONS = labels("thinking", [
  "off",
  "low",
  "medium",
  "high",
]);

const NORMAL_MODE: ChoiceDeclaration = {
  value: "normal",
  icon: "i-ph-hand-palm",
};
const AUTO_REVIEW_MODE: ChoiceDeclaration = {
  value: "auto",
  icon: "i-ph-seal-check",
};
const ACCEPT_EDITS_MODE: ChoiceDeclaration = {
  value: "acceptEdits",
  icon: "i-ph-pencil-simple-line",
};
const PLAN_MODE: ChoiceDeclaration = {
  value: "plan",
  icon: "i-ph-list-checks",
};
const FULL_AUTO_MODE: ChoiceDeclaration = {
  value: "fullAuto",
  icon: "i-ph-lightning",
  disabled: true,
};

export const CLAUDE_MODE_OPTIONS = choices("mode", [
  NORMAL_MODE,
  AUTO_REVIEW_MODE,
  ACCEPT_EDITS_MODE,
  PLAN_MODE,
  FULL_AUTO_MODE,
]);

export const CODEX_MODE_OPTIONS = choices("mode", [
  NORMAL_MODE,
  ACCEPT_EDITS_MODE,
  PLAN_MODE,
  FULL_AUTO_MODE,
]);

export const SCOPE_OPTIONS = choices("generation_mode", [
  { value: SAFE_SCOPE, icon: "i-ph-shield-check" },
  { value: "vibe", icon: "i-ph-code" },
]);

/** Numeric settings travel as strings: a select's values are text. */
export const REQUEST_TIMEOUT_OPTIONS = labels("request_timeout", [
  "5",
  "15",
  "30",
]);

export const RETENTION_OPTIONS = labels("checkpoint_retention", [
  "7",
  "30",
  "90",
]);
