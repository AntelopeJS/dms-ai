import type { ComponentMetadata } from "@antelopejs/interface-dms/component";
import type { MenuOptions } from "@antelopejs/interface-dms/page";
import { I18N_SECTIONS } from "../constants/i18n";
import { MODULE_ID } from "../constants/module";
import { i18nKey } from "../vocabulary";

/**
 * The role editor's title, help and icon for a block: `$dms_ai.blocks.<path>`
 * holds its `name` and `description`.
 */
export function blockMeta(path: string, icon: string): ComponentMetadata {
  return {
    name: i18nKey(I18N_SECTIONS.BLOCKS, path, "name"),
    description: i18nKey(I18N_SECTIONS.BLOCKS, path, "description"),
    icon,
  };
}

/** A block's own text, next to its role-editor title. */
export function blockText(path: string, key: string): string {
  return i18nKey(I18N_SECTIONS.BLOCKS, path, key);
}

/** The menu entry of a page of the module, titled under `$dms_ai.pages.<id>`. */
export function pageMenu(id: string, icon: string, order: number): MenuOptions {
  return {
    displayName: i18nKey(I18N_SECTIONS.PAGES, id, "title"),
    description: i18nKey(I18N_SECTIONS.PAGES, id, "description"),
    icon,
    module: MODULE_ID,
    order,
  };
}
