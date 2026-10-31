import { z } from "zod";
import { defineTool } from "../define-tool.js";
import {
  type BuilderRun,
  exprRefusal,
  hasExprSentinel,
  note,
} from "./builder-expr.js";

const QUERY_REF = z
  .string()
  .describe(
    "A query ref `<pageRef>@<queryName>` (e.g. `/catalog/books@inStockCount`), as reported in BuilderPageStructure's `queries`.",
  );

const QUERY_ENDPOINT = z
  .string()
  .describe(
    'Route path relative to the page\'s slug, e.g. `/stats/in-stock`. Must start with `/` and not collide with another route the page serves. Omit for `/stats/<kebab-name>`. A `$param` bound with `in: "param"` reads a path segment, so include a matching `:name` (e.g. `/stats/by-author/:author`).',
  );

const QUERY_PARAMS = z
  .record(z.string(), z.unknown())
  .describe(
    "The template's parameters, keyed exactly as the `params` schema BuilderQueryTemplates reports for it — that schema documents every key and value shape, and an unrecognised key is rejected.",
  );

/** The tools that list, add, reconfigure and remove a page's queries. */
export function buildQueryTools(run: BuilderRun) {
  return [
    defineTool(
      "BuilderQueryTemplates",
      note(
        "Lists the query templates BuilderAddQuery can compile, each with its id, what it computes, its `output` kind, and the JSON Schema for its `params`. Call this before adding a query — the schema is the reference for every parameter and value shape.",
      ),
      {
        resourceType: z
          .string()
          .optional()
          .describe(
            "Filter to templates for one resource type (v1 has only `database-table`). Omit for all.",
          ),
      },
      ({ resourceType }: { resourceType?: string }) =>
        run("ListQueryTemplates", resourceType ? [resourceType] : []),
    ),
    defineTool(
      "BuilderAddQuery",
      note(
        "Adds a query — a page-hosted GET route serving one computed number that the DataAPI cannot give you. Compiles the template into a method on the resource's model and a route on the page, atomically. Returns `{ query, route }`; `route` is the full URL to pass as a KpiCard's `fetchUrl`, and it serves `{ \"value\": <number> }`.",
      ),
      {
        page: z
          .string()
          .describe(
            "PageRef the query is served from — the page that displays it, not the resource's page.",
          ),
        name: z
          .string()
          .describe(
            "camelCase identifier, unique among the page's members. Names the route; the model method it compiles into may differ, since queries wanting the identical chain share one.",
          ),
        resource: z
          .string()
          .describe("Resource ref to read, from BuilderListResources."),
        template: z
          .string()
          .describe("A template id from BuilderQueryTemplates."),
        params: QUERY_PARAMS.optional(),
        endpoint: QUERY_ENDPOINT.optional(),
      },
      async ({ page, ...input }) =>
        hasExprSentinel(input) ? exprRefusal() : run("AddQuery", [page, input]),
    ),
    defineTool(
      "BuilderConfigureQuery",
      note(
        "Recompiles a query, replacing both its route and its chain. Only the keys you pass change; the rest are re-read from the query. A query BuilderPageStructure reports as `opaque` is refused with opaque_target, leaving the hand-edit intact. Renaming is not supported — remove and re-add. Never affects another page's query, even one sharing the same model method.",
      ),
      {
        query: QUERY_REF,
        patch: z.object({
          resource: z.string().optional(),
          template: z.string().optional(),
          params: QUERY_PARAMS.optional(),
          endpoint: QUERY_ENDPOINT.optional(),
        }),
      },
      async ({ query, patch }: { query: string; patch: unknown }) =>
        hasExprSentinel(patch)
          ? exprRefusal()
          : run("ConfigureQuery", [query, patch]),
    ),
    defineTool(
      "BuilderRemoveQuery",
      note(
        "Removes a query's route from the page, and its model method too once no route on any page still calls it. Works on an opaque query as well — the builder can always remove what it cannot edit. Does not detect blocks whose fetchUrl points at the removed route: fix those in the same turn.",
      ),
      { query: QUERY_REF },
      ({ query }: { query: string }) => run("RemoveQuery", [query]),
    ),
  ];
}
