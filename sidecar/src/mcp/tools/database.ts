import { z } from "zod";
import {
  DATABASE_CONNECTIONS_PATH,
  DATABASE_CONNECTIONS_TOOL_NAME,
  DATABASE_DESCRIBE_PATH,
  DATABASE_DESCRIBE_TOOL_NAME,
  DATABASE_PROFILE_PATH,
  DATABASE_PROFILE_TOOL_NAME,
  DATABASE_RELATIONS_PATH,
  DATABASE_RELATIONS_TOOL_NAME,
} from "../../constants/database.js";
import type { DatabaseClient } from "../../database/database-client.js";
import {
  type AnyMcpToolDefinition,
  defineTool,
  type McpToolResult,
} from "../define-tool.js";

export interface DatabaseToolsDeps {
  databaseClient: DatabaseClient;
}

const FAILED_ANSWER = z.object({ ok: z.literal(false) });

function answer(value: unknown): McpToolResult {
  const text = JSON.stringify(value);
  return FAILED_ANSWER.safeParse(value).success
    ? { content: [{ type: "text", text }], isError: true }
    : { content: [{ type: "text", text }] };
}

const CONNECTION = z
  .string()
  .describe("A connection id from DatabaseConnections, e.g. `erp`.");
const RELATION = z
  .string()
  .describe('A relation named `"schema.name"`, e.g. `sales.accounts`.');
const COLUMN_REFERENCE = z.object({ relation: RELATION, column: z.string() });

const CONNECTIONS_DESCRIPTION =
  "Lists the databases the project connects dms-ai to, each with its engine, version, database and role. Configuration declares them; when none is listed, connect one first with BuilderConfigureProject.";
const RELATIONS_DESCRIPTION =
  "Lists every relation of a connection (tables, views and their kin; MongoDB collections and RethinkDB tables), with its row estimate and where it came from, its key (the columns `_id` aliases, or null), what the connected account may write, its comment, and `unmappable` with the reason when it cannot be mapped.";
const DESCRIBE_DESCRIPTION =
  "Describes relations in full: every column's native type (for a document database, the types its sample holds with their shares), nullability, default, generated/identity, enum labels, comment, `accepts` (the declarations registration takes, the one to propose first; empty with `unsupported` when none applies) and `readOnly`; indexes; declared references out (`references`) and in (`referencedBy`), which document databases never have. Describe in batches of up to 20.";
const PROFILE_DESCRIPTION =
  "Profiles one relation with aggregates only, without writing: rows, and per column nulls, distinct, numeric/date/enum ranges, months, categories (values of few-valued columns, each seen at least 5 times) and text lengths, with traits (enum-like, identifier-like, label-candidate, time-axis, measure); children per parent over each declared reference. A measure past its time answers `timeout`. Large relations are sampled. `references` checks columns that look like references the database does not declare: containment of their values in the target column, and whether the target is a key.";

/** The catalog tools: they read the connected database's catalog and aggregates, never its rows. */
export function buildDatabaseTools(
  deps: DatabaseToolsDeps,
): AnyMcpToolDefinition[] {
  const client = deps.databaseClient;
  return [
    defineTool(
      DATABASE_CONNECTIONS_TOOL_NAME,
      CONNECTIONS_DESCRIPTION,
      {},
      async () => answer(await client.get(DATABASE_CONNECTIONS_PATH)),
    ),
    defineTool(
      DATABASE_RELATIONS_TOOL_NAME,
      RELATIONS_DESCRIPTION,
      { connection: CONNECTION, schemas: z.array(z.string()).optional() },
      async (input) =>
        answer(await client.post(DATABASE_RELATIONS_PATH, input)),
    ),
    defineTool(
      DATABASE_DESCRIBE_TOOL_NAME,
      DESCRIBE_DESCRIPTION,
      { connection: CONNECTION, relations: z.array(RELATION).min(1) },
      async (input) => answer(await client.post(DATABASE_DESCRIBE_PATH, input)),
    ),
    defineTool(
      DATABASE_PROFILE_TOOL_NAME,
      PROFILE_DESCRIPTION,
      {
        connection: CONNECTION,
        relation: RELATION.optional(),
        columns: z.array(z.string()).optional(),
        references: z
          .array(z.object({ from: COLUMN_REFERENCE, to: COLUMN_REFERENCE }))
          .optional(),
      },
      async (input) => answer(await client.post(DATABASE_PROFILE_PATH, input)),
    ),
  ];
}
