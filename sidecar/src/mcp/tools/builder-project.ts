import { z } from "zod";
import type { BuilderClient } from "../../builder/builder-client.js";
import {
  BUILDER_ANALYSE_DATABASE_TOOL_NAME,
  BUILDER_ANALYSIS_POLL_MS,
  BUILDER_ANALYSIS_WAIT_MS,
  BUILDER_CONFIGURE_PROJECT_TOOL_NAME,
  BUILDER_MAP_RESOURCES_TOOL_NAME,
  BUILDER_MAPPING_TOOL_NAME,
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
      "One of the column's `accepts`, from the proposal or DatabaseDescribe; the first by default.",
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
      "`schema.name` of another relation in this call, or one the module mapped before: makes the column a relation column onto that relation's single-column key.",
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
  title: z
    .string()
    .optional()
    .describe("The page's title; the relation's name, humanized, by default."),
  tableView: z
    .boolean()
    .describe("False for a stats-only relation; forced false without a key."),
  writable: z
    .boolean()
    .describe("False serves the TableView without new, edit and delete."),
  fields: z.array(MAPPED_FIELD),
});

const EXCLUDED = z.object({
  relation: z.string().describe("`schema.name`."),
  reason: z.string(),
});

const MAP_RESOURCES_DESCRIPTION =
  "Maps relations of a connected database into a project module bound to it (created with BuilderConfigureProject): table classes and models with the database's names verbatim, DataAPI controllers and one TableView page per relation that has a key. Only your choices are sent: the Builder reads the relations' descriptions from its own catalog connection and checks every choice against them. A relation mapped before is rewritten from the new choices, its page created, kept or removed. `excluded` records relations decided against, so the next analysis does not propose them. Answers what was written and `leftOut`: columns a TableView cannot show, with why.";

const ANALYSE_DATABASE_DESCRIPTION =
  "Runs the Builder's analysis of a connected database: it reads the catalog and the profiles and proposes a mapping by fixed rules, writing nothing. Answers the proposal: resources in the shape BuilderMapResources takes, each choice with its rule and `kind` (`fact` from the catalog, or `default`, a judgement to check), the relations excluded and why, and `open`: what the rules could not decide, each with its options. Profiling is slow: when the analysis is still running after a minute this answers its progress and `job`; call again with that `job` to read on.";

const MAPPING_DESCRIPTION =
  "The relations a module maps for a connection, read back from its code as their current choices, in the proposal's shape (every rule `mapped`), with `included`: the columns the module declares. Read it before mapping a relation again with BuilderMapResources, so you send its current choices with only what you change.";

interface AnalysisAnswer {
  ok?: boolean;
  data?: { id?: string; status?: string };
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Starts an analysis, or reads the given job, and waits a while for its proposal. */
async function analysis(
  client: BuilderClient,
  args: Record<string, unknown>,
): Promise<McpToolResult> {
  const job = typeof args.job === "string" ? args.job : undefined;
  let state = (await (job
    ? client.call("GetAnalysis", [job])
    : client.call("AnalyseDatabase", [
        {
          connection: args.connection,
          module: args.module,
          schemas: args.schemas,
        },
      ]))) as AnalysisAnswer;
  const deadline = Date.now() + BUILDER_ANALYSIS_WAIT_MS;
  while (
    state?.ok &&
    state.data?.status === "running" &&
    Date.now() < deadline
  ) {
    await delay(BUILDER_ANALYSIS_POLL_MS);
    state = (await client.call("GetAnalysis", [
      state.data.id,
    ])) as AnalysisAnswer;
  }
  return opResult(state);
}

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
        resources: z.array(MAPPED_RESOURCE),
        excluded: z.array(EXCLUDED).optional(),
      },
      async (input: Record<string, unknown>) =>
        opResult(await client.call("MapResources", [input])),
    ),
    defineTool(
      BUILDER_ANALYSE_DATABASE_TOOL_NAME,
      ANALYSE_DATABASE_DESCRIPTION,
      {
        connection: z
          .string()
          .optional()
          .describe(
            "A connection id from DatabaseConnections, to start an analysis.",
          ),
        module: z
          .string()
          .optional()
          .describe(
            "The project module bound to the connection's database; relations it mapped or excluded are not proposed again.",
          ),
        schemas: z
          .array(z.string())
          .optional()
          .describe(
            "Limit the analysis to these schemas, as a `schemas` open item asks.",
          ),
        job: z
          .string()
          .optional()
          .describe(
            "A running analysis's `id`, to read on instead of starting one.",
          ),
      },
      (args: Record<string, unknown>) => analysis(client, args),
    ),
    defineTool(
      BUILDER_MAPPING_TOOL_NAME,
      MAPPING_DESCRIPTION,
      {
        connection: z
          .string()
          .describe("A connection id from DatabaseConnections."),
        module: z
          .string()
          .describe("The project module bound to the connection's database."),
      },
      async (args: Record<string, unknown>) =>
        opResult(
          await client.call("GetMapping", [args.connection, args.module]),
        ),
    ),
  ];
}
