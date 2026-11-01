import { z } from "zod";
import { defineTool } from "../define-tool.js";
import { TABLE_VIEW_SETTINGS } from "./builder-table-view-schema.js";
import {
  type BuilderRun,
  exprRefusal,
  hasExprSentinel,
  note,
} from "./builder-expr.js";

const DESCRIPTION =
  "Sets displays, named views and footer figures on a table page's TableView, checking every choice against the columns of the table first: a kanban needs a single-choice column, a sum a number or price column, a view's filters filterable columns and its sort sortable ones, the default display one the table offers. A key left out stays as the page has it; `null` removes it. A footer figure also mounts the controller's summary route. Nothing is written when a choice is refused or the page would not typecheck. Read the column names and types with BuilderResourceStructure first. For the page's title, icon, description and order use BuilderConfigurePage.";

export function buildTableViewTools(run: BuilderRun) {
  return [
    defineTool(
      "BuilderConfigureTableView",
      note(DESCRIPTION),
      {
        pageRef: z.string(),
        block: z
          .string()
          .optional()
          .describe(
            "The TableView block's name; only needed when the page holds several.",
          ),
        ...TABLE_VIEW_SETTINGS,
      },
      async ({ pageRef, block, ...settings }) =>
        hasExprSentinel(settings)
          ? exprRefusal()
          : run("ConfigureTableView", [
              pageRef,
              Object.fromEntries(
                Object.entries(settings).filter(
                  ([, value]) => value !== undefined,
                ),
              ),
              ...(block === undefined ? [] : [{ block }]),
            ]),
    ),
  ];
}
