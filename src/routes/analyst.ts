import {
  Context,
  Controller,
  Get,
  HTTPResult,
  Parameter,
  type RequestContext,
} from "@antelopejs/interface-api";
import {
  AnalystRefusal,
  describePage,
  listPages,
  readRows,
} from "../analyst/catalog";
import { GrantUserGoneError } from "../analyst/as-user";
import { type GrantIdentity, resolveGrant } from "../assistant/grants";
import {
  ANALYST_PAGES_PATH,
  ANALYST_ROWS_PATH,
  ANALYST_TABLES_PATH,
} from "../constants/analyst";
import { DATA_GRANT_HEADER, HTTP_FORBIDDEN } from "../constants/assistant";
import { ROUTE_PREFIX } from "../constants/module";
import { SIDECAR_AUTH_HEADER } from "../constants/sidecar";
import { isSidecarRequest, sidecarForbidden } from "./sidecar-auth";

const HTTP_UNAUTHORIZED = 401;

function noGrant(): HTTPResult {
  return new HTTPResult(HTTP_UNAUTHORIZED, { error: "no_grant" });
}

async function answer<T>(
  token: string | undefined,
  grant: string | undefined,
  read: (identity: GrantIdentity) => Promise<T>,
): Promise<T | HTTPResult> {
  if (!isSidecarRequest(token)) return sidecarForbidden();
  const identity = resolveGrant(grant);
  if (identity === null) return noGrant();
  try {
    return await read(identity);
  } catch (err) {
    if (err instanceof AnalystRefusal) {
      return new HTTPResult(err.status, { error: err.reason });
    }
    if (err instanceof GrantUserGoneError) {
      return new HTTPResult(HTTP_FORBIDDEN, { error: "user_gone" });
    }
    throw err;
  }
}

/**
 * What Analyst reads, always as the user a grant names: the sidecar's token
 * alone opens nothing, and every answer comes from the DMS's own routes
 * called with that user's credential.
 */
export class AIAnalystController extends Controller(ROUTE_PREFIX) {
  @Get(ANALYST_PAGES_PATH)
  pages(
    @Parameter(SIDECAR_AUTH_HEADER, "header") token?: string,
    @Parameter(DATA_GRANT_HEADER, "header") grant?: string,
  ) {
    return answer(token, grant, async (identity) => ({
      pages: (await listPages(identity)).map(
        ({ layoutUrl: _url, ...page }) => page,
      ),
    }));
  }

  @Get(ANALYST_TABLES_PATH)
  tables(
    @Parameter("page", "query") page: string,
    @Parameter(SIDECAR_AUTH_HEADER, "header") token?: string,
    @Parameter(DATA_GRANT_HEADER, "header") grant?: string,
  ) {
    return answer(token, grant, async (identity) => {
      const described = await describePage(identity, page);
      return {
        page: described.page.path,
        tables: described.tables.map(
          ({ location: _location, ...table }) => table,
        ),
      };
    });
  }

  @Get(ANALYST_ROWS_PATH)
  rows(
    @Context() ctx: RequestContext,
    @Parameter("page", "query") page: string,
    @Parameter("table", "query") table: string,
    @Parameter(SIDECAR_AUTH_HEADER, "header") token?: string,
    @Parameter(DATA_GRANT_HEADER, "header") grant?: string,
  ) {
    return answer(token, grant, (identity) =>
      readRows(identity, page, table, ctx.url.searchParams),
    );
  }
}
