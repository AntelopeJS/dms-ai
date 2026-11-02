import { z } from "zod";
import { defineTool } from "../define-tool.js";
import {
  type BuilderRun,
  exprRefusal,
  hasExprSentinel,
  note,
} from "./builder-expr.js";
import { QUERY_ARGS, QUERY_FIELDS } from "./builder-queries.js";

const DESCRIPTION =
  "Builds a whole page, or adds a group of blocks to one, in a single call: the blocks, the queries they read, the layout rows and the page itself when it does not exist yet. One rewrite, one typecheck, and nothing is written when any block is refused; the error names each refused block by JSON pointer into your input (`/blocks/3/children/0/query/params/groupBy`). A data block carries its `query` inline (the BuilderAddQuery fields, `name` defaulting to the block's name): the route it compiles to is written into the block's `fetchUrl` for you, so never pass `fetchUrl` yourself. Containers (`PageToolbar`, `Grid`, `GridRow`, `Section`…) carry their blocks in `children`, and a child sits in its row in order. Pass `preview: true` first to run every query with `args` and read each block's answer without writing: a block whose `status` is `empty` or `zero` would render nothing useful, so fix its query before the writing call. To put blocks above or below a table already on the page (a KPI row above the TableView a mapping wrote), pass `placement: { before: \"table\" }`; a later BuilderMapResources keeps them. Use BuilderAddBlock and BuilderAddQuery for a single edit.";

const OPTIONS = z.record(z.string(), z.unknown());
type Options = z.infer<typeof OPTIONS>;

const BLOCK_QUERY = z.object({
  ...QUERY_FIELDS,
  name: QUERY_FIELDS.name.optional(),
  into: z
    .string()
    .optional()
    .describe(
      "The block config key that receives the route. Defaults to `fetchUrl`.",
    ),
  args: QUERY_ARGS.optional().describe(
    "Values for this query's preview only, over the call's `args`.",
  ),
});

export interface ComposeBlockInput {
  name: string;
  type: string;
  config?: Options | undefined;
  controller?: string | undefined;
  slot?: string | undefined;
  meta?: Options | undefined;
  query?: z.infer<typeof BLOCK_QUERY> | undefined;
  children?: ComposeBlockInput[] | undefined;
}

const COMPOSE_BLOCK: z.ZodType<ComposeBlockInput> = z.lazy(() =>
  z.object({
    name: z
      .string()
      .describe(
        "camelCase identifier, unique among its siblings. Becomes the block's path segment.",
      ),
    type: z.string().describe("A block type from BuilderCatalog."),
    config: OPTIONS.optional().describe(
      'The block\'s options, per BuilderCatalog. A chart inside a ChartCard is `{ "$block": { "type": "ChartArea", "config": {} } }`.',
    ),
    controller: z
      .string()
      .optional()
      .describe(
        "Resource ref for a controller-leading block such as `TableView`.",
      ),
    slot: z.string().optional().describe("The slot this block fills."),
    meta: OPTIONS.optional().describe(
      'Child metadata in its row, e.g. `{ "colSpan": 2 }`.',
    ),
    query: BLOCK_QUERY.optional().describe(
      "The query this block reads, added to the page with it.",
    ),
    children: z
      .array(COMPOSE_BLOCK)
      .optional()
      .describe("Blocks nested in this container, in order."),
  }),
);

const CREATE_PAGE = z
  .object({
    name: z
      .string()
      .describe("Route slug: lowercase letters, digits and dashes."),
    displayName: z.string(),
    category: z
      .string()
      .describe("An existing CategoryRef from BuilderListPages."),
    icon: z.string().optional(),
    description: z.string().optional(),
    order: z.number().optional(),
    module: z
      .string()
      .optional()
      .describe(
        "The project module to write into. Omit for the project's own.",
      ),
  })
  .describe(
    "Create the page with these fields in the same call. Give this or `pageRef`, not both.",
  );

const PLACEMENT = z
  .object({
    before: z.string().optional(),
    after: z.string().optional(),
  })
  .describe(
    'Put the new blocks next to the block of this name among the siblings already there (e.g. `{ "before": "table" }`). Omit to append.',
  );

/** The tool that builds or extends a whole page in one call. */
export function buildComposeTools(run: BuilderRun) {
  return [
    defineTool(
      "BuilderComposePage",
      note(DESCRIPTION),
      {
        pageRef: z
          .string()
          .optional()
          .describe("An existing PageRef to add the blocks to."),
        create: CREATE_PAGE.optional(),
        parent: z
          .string()
          .optional()
          .describe(
            "An existing container block path to add the blocks under (from BuilderPageStructure). Omit for the page itself.",
          ),
        placement: PLACEMENT.optional(),
        blocks: z
          .array(COMPOSE_BLOCK)
          .min(1)
          .describe("The blocks to add, in order, each with its query inline."),
        preview: z
          .boolean()
          .optional()
          .describe(
            "Run every query with `args` and answer `previews` per block without writing anything.",
          ),
        args: QUERY_ARGS.optional(),
      },
      async ({ pageRef, create, parent, placement, blocks, preview, args }) => {
        const input = {
          page: pageRef,
          create,
          parent,
          placement,
          blocks,
          preview,
          args,
        };
        return hasExprSentinel(input)
          ? exprRefusal()
          : run("ComposePage", [input]);
      },
    ),
  ];
}
