import {
  Controller,
  Get,
  HTTPResult,
  JSONBody,
  Parameter,
  Post,
} from "@antelopejs/interface-api";
import type {
  ProfileRequest,
  ReferenceCheck,
} from "@antelopejs/interface-database-catalog";
import {
  DATABASE_CONNECTIONS_PATH,
  DATABASE_DESCRIBE_PATH,
  DATABASE_PROFILE_PATH,
  DATABASE_RELATIONS_PATH,
  HTTP_CATALOG_FAILED,
  HTTP_NOT_FOUND,
} from "../constants/database";
import { ROUTE_PREFIX } from "../constants/module";
import { SIDECAR_AUTH_HEADER } from "../constants/sidecar";
import {
  type CatalogConnection,
  catalogOf,
  listConnections,
} from "../database/catalog";
import { isSidecarRequest, sidecarForbidden } from "./sidecar-auth";

interface ConnectionBody {
  connection?: string;
}

interface RelationsBody extends ConnectionBody {
  schemas?: string[];
}

interface DescribeBody extends ConnectionBody {
  relations?: string[];
}

interface ProfileBody extends ConnectionBody, Partial<ProfileRequest> {
  references?: ReferenceCheck[];
}

function unknownConnection(connection: string | undefined): HTTPResult {
  return new HTTPResult(HTTP_NOT_FOUND, {
    error: "unknown_connection",
    connection,
    known: listConnections(),
  });
}

/** Runs `work` on the named connection's catalog, answering its refusal as the agent reads it. */
async function onCatalog(
  token: string | undefined,
  connection: string | undefined,
  work: (catalog: CatalogConnection) => Promise<unknown>,
): Promise<unknown> {
  if (!isSidecarRequest(token)) {
    return sidecarForbidden();
  }
  const catalog = connection ? catalogOf(connection) : undefined;
  if (!catalog) {
    return unknownConnection(connection);
  }
  try {
    return await work(catalog);
  } catch (err) {
    return new HTTPResult(HTTP_CATALOG_FAILED, {
      error: "catalog_failed",
      detail: err instanceof Error ? err.message : String(err),
    });
  }
}

async function describeConnection(connection: string): Promise<unknown> {
  try {
    return { connection, ...(await catalogOf(connection)?.Info()) };
  } catch (err) {
    return {
      connection,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

/** The catalog routes the sidecar's `Database*` tools call, with the sidecar's token only. */
export class AIDatabaseController extends Controller(ROUTE_PREFIX) {
  @Get(DATABASE_CONNECTIONS_PATH)
  async connections(
    @Parameter(SIDECAR_AUTH_HEADER, "header") token?: string,
  ): Promise<unknown> {
    if (!isSidecarRequest(token)) {
      return sidecarForbidden();
    }
    return Promise.all(listConnections().map(describeConnection));
  }

  @Post(DATABASE_RELATIONS_PATH)
  relations(
    @Parameter(SIDECAR_AUTH_HEADER, "header") token?: string,
    @JSONBody() body?: RelationsBody,
  ): Promise<unknown> {
    return onCatalog(token, body?.connection, (catalog) =>
      catalog.ListRelations(body?.schemas),
    );
  }

  @Post(DATABASE_DESCRIBE_PATH)
  describe(
    @Parameter(SIDECAR_AUTH_HEADER, "header") token?: string,
    @JSONBody() body?: DescribeBody,
  ): Promise<unknown> {
    return onCatalog(token, body?.connection, (catalog) =>
      catalog.DescribeRelations(body?.relations ?? []),
    );
  }

  @Post(DATABASE_PROFILE_PATH)
  profile(
    @Parameter(SIDECAR_AUTH_HEADER, "header") token?: string,
    @JSONBody() body?: ProfileBody,
  ): Promise<unknown> {
    return onCatalog(token, body?.connection, async (catalog) => ({
      profile: body?.relation
        ? await catalog.Profile({
            relation: body.relation,
            columns: body.columns,
          })
        : undefined,
      references: await Promise.all(
        (body?.references ?? []).map((check) => catalog.CheckReference(check)),
      ),
    }));
  }
}
