import { z } from "zod";
import type { BuilderClient } from "../../builder/builder-client.js";
import {
  BUILDER_CONFIGURE_PROJECT_TOOL_NAME,
  BUILDER_MAP_RESOURCES_TOOL_NAME,
} from "../../constants/builder.js";
import {
  type AnyMcpToolDefinition,
  defineTool,
  type McpToolResult,
} from "../define-tool.js";
import type { BuilderGate } from "./builder-gate.js";

/** The key the gate reads a config operation's dry-run changes from, for the approval card. */
export const PLANNED_CHANGES_ARG = "plannedChanges";

interface OpAnswer {
  ok?: boolean;
  changes?: unknown[];
}

/** A Builder answer as a tool result: an `{ ok: false }` answer is a failed call. */
export function opResult(value: unknown): McpToolResult {
  const text = JSON.stringify(value);
  const failed = (value as OpAnswer | null)?.ok === false;
  return failed
    ? { content: [{ type: "text", text }], isError: true }
    : { content: [{ type: "text", text }] };
}

export const TARGET_MODULE = z
  .string()
  .optional()
  .describe(
    "A project module id from antelope.config.ts to write into; omit for the project's own. The module generated for a connected database is one.",
  );

const IMPORT_OVERRIDE = z.object({
  interface: z.string(),
  source: z.string().optional(),
  id: z.string().optional(),
});

const MODULE_ENTRY = z
  .object({
    source: z.record(z.string(), z.unknown()).optional(),
    config: z.record(z.string(), z.unknown()).optional(),
    env: z
      .record(z.string(), z.string())
      .optional()
      .describe(
        "Config path under the module's `config` → the NAME of the environment variable that supplies it, e.g. `{ url: \"ERP_DATABASE_URL\" }`. Never put a secret's value anywhere in a step.",
      ),
    importOverrides: z.array(IMPORT_OVERRIDE).optional(),
    exportPriority: z.record(z.string(), z.number()).optional(),
  })
  .describe("What to write into the module's entry of antelope.config.ts.");

const STEP = z.discriminatedUnion("op", [
  z.object({ op: z.literal("AddModule"), id: z.string(), entry: MODULE_ENTRY }),
  z.object({
    op: z.literal("ConfigureModule"),
    id: z.string(),
    entry: MODULE_ENTRY,
  }),
  z.object({
    op: z.literal("CreateLocalModule"),
    id: z.string(),
    path: z
      .string()
      .describe("Relative to the project root, e.g. `modules/erp-tables`."),
    entry: MODULE_ENTRY.optional(),
  }),
]);

const CONFIGURE_PROJECT_DESCRIPTION =
  "Edits antelope.config.ts in one step: adds modules (AddModule), merges into existing ones (ConfigureModule: config, importOverrides pins and connections, exportPriority, env variable names) and scaffolds local modules (CreateLocalModule). Every step is validated before anything is written, and a refused step writes nothing. The user always approves the change, shown as a diff. A restart is needed before new modules load.";

const MAPPED_FIELD = z.object({
  column: z.string(),
  declared: z
    .string()
    .optional()
    .describe(
      "One of the column's `accepts` from DatabaseDescribe; the first by default.",
    ),
  label: z.string().optional(),
  listable: z.boolean().optional(),
  filterable: z.boolean().optional(),
  sortable: z.boolean().optional(),
  searchable: z.boolean().optional(),
  relation: z
    .string()
    .optional()
    .describe(
      "`schema.name` of another relation in this call: makes the column a relation column onto that relation's single-column key.",
    ),
});

const MAPPED_RESOURCE = z.object({
  relation: z.string().describe("`schema.name`."),
  className: z.string().optional(),
  label: z
    .string()
    .optional()
    .describe(
      "The column relation columns pointing here show; also the TableView's labelKey.",
    ),
  tableView: z
    .boolean()
    .describe("False for a stats-only relation; forced false without a key."),
  writable: z
    .boolean()
    .describe("False serves the TableView without new, edit and delete."),
  fields: z.array(MAPPED_FIELD),
});

const MAP_RESOURCES_DESCRIPTION =
  "Maps relations of a connected database into a project module bound to it (created with BuilderConfigureProject): table classes and models with the database's names verbatim, DataAPI controllers and one TableView page per relation that has a key. Only your choices are sent: the relations' descriptions are read from the connection's catalog, and every choice is checked against them. Answers what was written and `leftOut`: columns a TableView cannot show, with why.";

/** Runs the operation as a dry run, asks the gate with its changes, then runs it for real. */
async function confirmedRun(
  client: BuilderClient,
  gate: BuilderGate | undefined,
  args: Record<string, unknown>,
): Promise<McpToolResult> {
  const steps = args.steps;
  const planned = (await client.call("ConfigureProject", [
    steps,
    { dryRun: true },
  ])) as OpAnswer;
  if (planned?.ok === false) {
    return opResult(planned);
  }
  if (gate) {
    const decision = await gate(BUILDER_CONFIGURE_PROJECT_TOOL_NAME, {
      ...args,
      [PLANNED_CHANGES_ARG]: planned?.changes ?? [],
    });
    if (!decision.isAllowed) {
      return {
        content: [{ type: "text", text: decision.message ?? "" }],
        isError: true,
      };
    }
  }
  return opResult(await client.call("ConfigureProject", [steps]));
}

/** The project-config and mapping tools. The config tool asks the user itself, with its diff. */
export function buildProjectTools(
  client: BuilderClient,
  gate: BuilderGate | undefined,
): AnyMcpToolDefinition[] {
  return [
    defineTool(
      BUILDER_CONFIGURE_PROJECT_TOOL_NAME,
      CONFIGURE_PROJECT_DESCRIPTION,
      { steps: z.array(STEP).min(1) },
      (args: Record<string, unknown>) => confirmedRun(client, gate, args),
    ),
    defineTool(
      BUILDER_MAP_RESOURCES_TOOL_NAME,
      MAP_RESOURCES_DESCRIPTION,
      {
        module: z
          .string()
          .describe("The project module bound to the connection's database."),
        connection: z
          .string()
          .describe("A connection id from DatabaseConnections."),
        resources: z.array(MAPPED_RESOURCE).min(1),
      },
      async (input: Record<string, unknown>) =>
        opResult(await client.call("MapResources", [input])),
    ),
  ];
}
