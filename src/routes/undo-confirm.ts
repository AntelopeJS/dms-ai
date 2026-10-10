import { serializeConfirmDialog } from "@antelopejs/interface-dms/base/confirm-dialog";
import { DefaultDataTypes } from "@antelopejs/interface-dms/base/data-types";
import type { ConfirmDialog } from "@antelopejs/interface-dms/base/types";
import { I18N_SECTIONS } from "../constants/i18n";
import type { UndoConflict, UndoPreview } from "../types";
import { i18nKey } from "../vocabulary";

/** Field of the dialog sent with the undo request. */
export const INCLUDE_LATER_FIELD = "includeLater";
const CONFLICT_ICON = "i-ph-warning";

function text(key: string): string {
  return i18nKey(I18N_SECTIONS.CHANGES_TABLE, "undo_confirm", key);
}

function conflictImpact(conflict: UndoConflict) {
  return {
    icon: CONFLICT_ICON,
    label: `#${conflict.number} · ${conflict.title}`,
    count: conflict.files.length,
  };
}

function includeLaterField() {
  return {
    id: INCLUDE_LATER_FIELD,
    type: new DefaultDataTypes.BooleanType({
      label: text("include_later"),
      description: text("include_later_hint"),
    }),
    defaultValue: true,
  };
}

/**
 * The dialog Undo asks in, worded from the sidecar's preview: how many files
 * go back, and the later change sets touching the same files, with the choice
 * to undo them together (the safe default).
 */
export function undoConfirmDialog(preview: UndoPreview) {
  const hasConflicts = preview.conflicts.length > 0;
  const dialog: ConfirmDialog = {
    title: text("title"),
    description: text(hasConflicts ? "description_conflicts" : "description"),
    params: {
      files: preview.files.length,
      conflicts: preview.conflicts.length,
    },
    icon: "i-ph-arrow-counter-clockwise",
    color: "warning",
    confirmLabel: text("confirm"),
    impact: preview.conflicts.map(conflictImpact),
    fields: hasConflicts ? [includeLaterField()] : undefined,
  };
  return serializeConfirmDialog(dialog);
}
