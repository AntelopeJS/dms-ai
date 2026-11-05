import { z } from "zod";
import type { AnalystClient } from "../../analyst/analyst-client.js";
import {
  type AnalystDatasets,
  type AnalystRow,
  AnalystRowSchema,
} from "../../analyst/datasets.js";
import { runAnalystScript } from "../../analyst/sandbox.js";
import {
  ANALYST_COMPUTE_DESCRIPTION,
  ANALYST_COMPUTE_TOOL_NAME,
  ANALYST_DATASET_NAME_PATTERN,
  ANALYST_DATASET_ROW_CAP,
  ANALYST_EVICTED_MESSAGE,
  ANALYST_LOAD_DESCRIPTION,
  ANALYST_LOAD_TOOL_NAME,
  ANALYST_RESERVED_DATASET_NAMES,
  ANALYST_SAMPLE_ROWS,
} from "../../constants/analyst.js";
import type { JsonValue } from "../../protocol/json.js";
import {
  type AnyMcpToolDefinition,
  defineTool,
  type McpToolResult,
} from "../define-tool.js";
import {
  pageRows,
  ROWS_SELECTION,
  type RowsSelection,
} from "./analyst-rows.js";

/** Runs a read with the turn's grant, or answers that no user is attached. */
export type WithGrant = (
  read: (grant: string) => Promise<JsonValue>,
) => Promise<McpToolResult>;

const DATASET_NAME = z
  .string()
  .regex(ANALYST_DATASET_NAME_PATTERN)
  .refine((name) => !ANALYST_RESERVED_DATASET_NAMES.has(name), {
    message: "This name is a JavaScript word or global: pick another.",
  })
  .describe(
    "The dataset's name, the global it is under in AnalystCompute scripts: a lowercase letter, then letters, digits or `_`.",
  );

const RowsSchema = z.array(AnalystRowSchema);

function failure(code: string, detail: string): JsonValue {
  return { ok: false, error: { code, detail } };
}

function columnsOf(rows: readonly AnalystRow[]): string[] {
  const fields = new Set<string>();
  for (const row of rows) {
    for (const field of Object.keys(row)) fields.add(field);
  }
  return [...fields];
}

interface LoadArgs extends RowsSelection {
  name: string;
  limit?: number;
}

async function load(
  client: AnalystClient,
  datasets: AnalystDatasets,
  grant: string,
  args: LoadArgs,
): Promise<JsonValue> {
  const room = datasets.room(args.name);
  if (room === 0) {
    return failure(
      "dataset_cap",
      `This conversation's datasets already hold ${ANALYST_DATASET_ROW_CAP} rows: load again under the name of a dataset you no longer need.`,
    );
  }
  const wanted = Math.min(args.limit ?? room, room);
  const read = await pageRows(client, grant, args, { start: 0, wanted });
  if (!read.ok) return read.answer;
  const rows = RowsSchema.safeParse(read.rows);
  if (!rows.success) {
    return failure("not_rows", "The table answered rows that are not objects.");
  }
  const rowCount = datasets.put(args.name, rows.data);
  return {
    name: args.name,
    rowCount,
    total: read.total,
    isPartial: rowCount < read.total,
    columns: columnsOf(rows.data),
    samples: rows.data.slice(0, ANALYST_SAMPLE_ROWS),
  };
}

async function compute(
  datasets: AnalystDatasets,
  code: string,
): Promise<JsonValue> {
  const outcome = await runAnalystScript(datasets.all(), code);
  const evicted = datasets.evicted();
  if (outcome.ok) {
    return evicted.length === 0
      ? { result: outcome.value }
      : { result: outcome.value, evicted, warning: ANALYST_EVICTED_MESSAGE };
  }
  return failure(
    "script_failed",
    evicted.length === 0
      ? outcome.error
      : `${outcome.error} ${ANALYST_EVICTED_MESSAGE} ${evicted.join(", ")}`,
  );
}

/** AnalystLoad and AnalystCompute over one conversation's datasets. */
export function buildAnalystDatasetTools(
  client: AnalystClient,
  datasets: AnalystDatasets,
  withGrant: WithGrant,
): AnyMcpToolDefinition[] {
  return [
    defineTool(
      ANALYST_LOAD_TOOL_NAME,
      ANALYST_LOAD_DESCRIPTION,
      {
        name: DATASET_NAME,
        ...ROWS_SELECTION,
        limit: z.number().int().min(1).max(ANALYST_DATASET_ROW_CAP).optional(),
      },
      (args) => withGrant((grant) => load(client, datasets, grant, args)),
    ),
    defineTool(
      ANALYST_COMPUTE_TOOL_NAME,
      ANALYST_COMPUTE_DESCRIPTION,
      {
        code: z
          .string()
          .min(1)
          .describe(
            "The body of an async function over the loaded datasets, ending in `return <value>`.",
          ),
      },
      ({ code }) => withGrant(() => compute(datasets, code)),
    ),
  ];
}
