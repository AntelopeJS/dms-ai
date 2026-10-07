import { I18N_PREFIX } from "../constants/i18n";

/** A `$dms_ai.<path>` i18n key, as backend metadata carries it. */
export function i18nKey(...segments: string[]): string {
  return [I18N_PREFIX, ...segments].join(".");
}
