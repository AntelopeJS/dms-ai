import type { ComponentInfoSerialized } from "@antelopejs/interface-dms/component";
import type {
  FormFieldOrGroupSerialized,
  FormFieldSerialized,
  FormPropsSerialized,
} from "@antelopejs/interface-dms/base/form-types";
import type { DefaultValue } from "@antelopejs/interface-dms/base/types/form-values";
import { asFormValues } from "../../sidecar/settings-values";
import { readSidecar } from "../../sidecar";
import type { VocabularyOption } from "../../vocabulary";
import { CODEX_PROVIDER, SAFE_SCOPE, settingsText } from "./options";

const SETTINGS_PATH = "/settings";

interface ProviderAvailability {
  available: boolean;
  reason?: string;
}

/** What the sidecar's settings say this install can do, and its defaults. */
interface SidecarCapabilities {
  providers?: Record<string, ProviderAvailability | undefined>;
  builderAvailable?: boolean;
  /** The sidecar's `DEFAULT_SETTINGS`: the one source of the module defaults. */
  defaults?: Record<string, unknown>;
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

function offerDefault(
  field: FormFieldSerialized,
  defaults: Record<string, unknown>,
): FormFieldSerialized {
  if (!(field.id in defaults)) return field;
  // The sidecar's settings are text, numbers and switches.
  const defaultValue = defaults[field.id] as DefaultValue;
  return { ...field, defaultValue, offersDefault: true };
}

/** Each field the sidecar has a default for offers it ("Use default"). */
function withDefaults(
  entry: FormFieldOrGroupSerialized,
  defaults: Record<string, unknown>,
): FormFieldOrGroupSerialized {
  if (!("fields" in entry)) return offerDefault(entry, defaults);
  return {
    ...entry,
    fields: entry.fields.map((field) => offerDefault(field, defaults)),
  };
}

/**
 * Per request, from the sidecar's settings: each field offers the sidecar's
 * default, and the agent and scope choices this install cannot run are shown
 * disabled, each saying why (Codex not set up, no Builder for Safe mode).
 */
export async function applySidecarSettings(
  _permissions: Set<string>,
  options: FormPropsSerialized,
): Promise<FormPropsSerialized> {
  const capabilities = await readSidecar<SidecarCapabilities>(
    SETTINGS_PATH,
    {},
  );
  const defaults = asFormValues(capabilities.defaults ?? {});
  const locks = locksFor(capabilities);
  const fields = options.fields.map((entry) =>
    locks.reduce(
      (locked, lock) => lockField(locked, lock),
      withDefaults(entry, defaults),
    ),
  );
  return { ...options, fields };
}
