import { Controller } from "@antelopejs/interface-api";
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
