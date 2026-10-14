import type { ComponentInfoSerialized } from "@antelopejs/interface-dms/component";
import type {
  FormFieldOrGroupSerialized,
  FormPropsSerialized,
} from "@antelopejs/interface-dms/base/form-types";
import { readSidecar } from "../../sidecar";
import type { VocabularyOption } from "../../vocabulary";
import { CODEX_PROVIDER, SAFE_SCOPE, settingsText } from "./options";

const SETTINGS_PATH = "/settings";

interface ProviderAvailability {
  available: boolean;
  reason?: string;
}

/** What the sidecar's settings say this install can do. */
interface SidecarCapabilities {
  providers?: Record<string, ProviderAvailability | undefined>;
  builderAvailable?: boolean;
}

interface OptionsWithItems {
  items?: VocabularyOption[];
}

/** An option turned off for this request, with why in place of its text. */
interface OptionLock {
  fieldId: string;
  value: string;
  reason: string;
}

function lockItems(
  component: ComponentInfoSerialized,
  lock: OptionLock,
): ComponentInfoSerialized {
  const options = (component.options ?? {}) as OptionsWithItems;
  const items = (options.items ?? []).map((item) =>
    item.value === lock.value
      ? { ...item, disabled: true, description: lock.reason }
      : item,
  );
  return { ...component, options: { ...options, items } };
}

function lockField(
  entry: FormFieldOrGroupSerialized,
  lock: OptionLock,
): FormFieldOrGroupSerialized {
  if (!("component" in entry) || entry.id !== lock.fieldId) return entry;
  return { ...entry, component: lockItems(entry.component, lock) };
}

function locksFor(capabilities: SidecarCapabilities): OptionLock[] {
  const locks: OptionLock[] = [];
  const codex = capabilities.providers?.[CODEX_PROVIDER];
  if (codex !== undefined && !codex.available) {
    locks.push({
      fieldId: "provider",
      value: CODEX_PROVIDER,
      reason: codex.reason ?? settingsText("provider", "unavailable"),
    });
  }
  if (capabilities.builderAvailable === false) {
    locks.push({
      fieldId: "generationMode",
      value: SAFE_SCOPE,
      reason: settingsText("generation_mode", "builder_missing"),
    });
  }
  return locks;
}

/**
 * Per request: the agent and scope choices this install cannot run are shown
 * disabled, each saying why (Codex not set up, no Builder for Safe mode).
 */
export async function lockUnavailableChoices(
  _permissions: Set<string>,
  options: FormPropsSerialized,
): Promise<FormPropsSerialized> {
  const capabilities = await readSidecar<SidecarCapabilities>(
    SETTINGS_PATH,
    {},
  );
  const locks = locksFor(capabilities);
  if (locks.length === 0) return options;
  const fields = options.fields.map((entry) =>
    locks.reduce((locked, lock) => lockField(locked, lock), entry),
  );
  return { ...options, fields };
}
