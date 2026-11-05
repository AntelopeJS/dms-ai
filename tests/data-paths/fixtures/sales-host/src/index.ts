import {
  Context,
  Controller,
  Get,
  type RequestContext,
} from "@antelopejs/interface-api";
import {
  DataController,
  RegisterDataController,
} from "@antelopejs/interface-data-api";
import {
  Access,
  AccessMode,
  Listable,
  ModelReference,
} from "@antelopejs/interface-data-api/metadata";
import {
  BasicDataModel,
  Field,
  RegisterTable,
  Table,
} from "@antelopejs/interface-database-decorators";
import { DefaultDataTypes } from "@antelopejs/interface-dms/base/data-types/default-types";
import {
  ArchiveField,
  Column,
  TableView,
  TableViewRoutes,
} from "@antelopejs/interface-dms/base/table-view";
import { TENANT_SCHEMA_NAME } from "@antelopejs/interface-dms/constants";
import {
  RegisterPage,
  RootPageController,
} from "@antelopejs/interface-dms/page";
import { TenantScopedModel } from "@antelopejs/interface-dms/tenant-scoped-model";

const TABLE = "dms_ai_test_sales";
const API_BASE_URL_ENV = "DMS_AI_TEST_API_BASE_URL";

@RegisterTable(TABLE, TENANT_SCHEMA_NAME)
export class Sale extends Table {
  @Field("string") declare _id: string;
  @Field("string") declare label: string;
  @Field("number") declare amount: number;
  @Field("number") declare costPrice: number;
}

export class SaleModel extends BasicDataModel(Sale, TABLE) {}

/** A tenant's sales, served to a table view through its list route. */
@RegisterDataController()
export class SalesDataAPI extends DataController(
  Sale,
  TableViewRoutes.All,
  Controller("/api/dms-ai-test/sales"),
) {
  @ModelReference()
  @TenantScopedModel(SaleModel)
  declare model: SaleModel;

  @Listable()
  @Access(AccessMode.ReadOnly)
  declare _id: string;

  @Listable()
  @Column({ name: "Label", type: new DefaultDataTypes.StringType() })
  @Access(AccessMode.ReadWrite)
  declare label: string;

  @Listable()
  @Column({ name: "Amount", type: new DefaultDataTypes.NumberType() })
  @Access(AccessMode.ReadWrite)
  declare amount: number;

  @Listable()
  @Access(AccessMode.ReadWrite)
  declare costPrice: number;
}

/** The page the Analyst data path reads: one table view over the sales. */
@RegisterPage()
export class SalesPage extends RootPageController("dms-ai-test-sales", {
  displayName: "Sales",
}) {
  static content = TableView(SalesDataAPI, { realtime: false });
}

const LEDGER_TABLE = "dms_ai_test_ledger";

@RegisterTable(LEDGER_TABLE, TENANT_SCHEMA_NAME)
export class LedgerEntry extends Table {
  @Field("string") declare _id: string;
  @Field("string") declare label: string;
  @Field("boolean") declare isArchived?: boolean;
}

export class LedgerModel extends BasicDataModel(LedgerEntry, LEDGER_TABLE) {}

/** A tenant's ledger, whose entries are archived rather than deleted. */
@RegisterDataController()
export class LedgerDataAPI extends DataController(
  LedgerEntry,
  TableViewRoutes.All,
  Controller("/api/dms-ai-test/ledger"),
) {
  @ModelReference()
  @TenantScopedModel(LedgerModel)
  declare model: LedgerModel;

  @Listable()
  @Access(AccessMode.ReadOnly)
  declare _id: string;

  @Listable()
  @Column({
    name: "Label",
    type: new DefaultDataTypes.StringType(),
    filterable: true,
  })
  @Access(AccessMode.ReadWrite)
  declare label: string;

  @ArchiveField()
  @Access(AccessMode.ReadOnly)
  declare isArchived: boolean;
}

/** A table view in archive mode: archived entries leave its list. */
@RegisterPage()
export class LedgerPage extends RootPageController("dms-ai-test-ledger", {
  displayName: "Ledger",
}) {
  static content = TableView(LedgerDataAPI, {
    realtime: false,
    archiveMode: true,
    rowActions: { archive: true, restore: true },
  });
}

/** A row of the feed route: `note` is a field its table shows no column for. */
interface FeedRow {
  _id: string;
  kind: string;
  amount: number;
  note: string;
}

const FEED_ROWS: FeedRow[] = ["in", "out", "in", "in", "out"].map(
  (kind, index) => ({
    _id: `feed-${index}`,
    kind,
    amount: (index + 1) * 10,
    note: `hidden-${index}`,
  }),
);
const FEED_KIND_FILTER = "filter_kind";
const feedQueries: string[] = [];

/**
 * A module's own route behind a `TableView.fromSource` table: it filters on
 * `kind` (`filter_kind=is:in`) and answers every matching row, never a page.
 * `requests` answers the query string of each list request it was sent.
 */
export class FeedController extends Controller("/api/dms-ai-test/feed") {
  @Get("/")
  list(@Context() ctx: RequestContext) {
    const query = ctx.url.searchParams;
    feedQueries.push(query.toString());
    const kind = query.get(FEED_KIND_FILTER)?.replace(/^is:/, "");
    const rows =
      kind === undefined
        ? FEED_ROWS
        : FEED_ROWS.filter((row) => row.kind === kind);
    return { results: rows, total: rows.length };
  }

  @Get("/requests")
  requests() {
    return { queries: feedQueries };
  }
}

/** A table over the feed route: filtered by the route, sorted and paged by the browser. */
@RegisterPage()
export class FeedPage extends RootPageController("dms-ai-test-feed", {
  displayName: "Feed",
}) {
  static content = TableView.fromSource({
    fetchUrl: "/api/dms-ai-test/feed",
    capabilities: { filter: true },
    columns: {
      kind: {
        name: "Kind",
        type: new DefaultDataTypes.StringType(),
        filterable: true,
        sortable: true,
      },
      amount: { name: "Amount", type: new DefaultDataTypes.NumberType() },
    },
  });
}

/** Where the api module the harness started listens. */
export interface SalesHostConfig {
  apiBaseUrl: string;
}

/**
 * The harness points `apiBaseUrl` at `${@api.API_LOCAL_BASE_URL}`, so this
 * runs once the api has reserved its port; the tests read it back.
 */
export function construct(config: SalesHostConfig): void {
  process.env[API_BASE_URL_ENV] = config.apiBaseUrl;
}
