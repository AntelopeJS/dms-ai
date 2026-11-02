import {
  GetInterfaceInstances,
  GetResponsibleModule,
  type InterfaceConnection,
  RunWithResponsibleModule,
} from "@antelopejs/interface-core";
import type * as Catalog from "@antelopejs/interface-database-catalog";
import { CATALOG_INTERFACE } from "../constants/database";

/**
 * The module this file belongs to, read while the module evaluates it. A route handler runs in
 * the context of the module serving HTTP, so a lookup made there would answer that module's
 * connections, not this one's.
 */
const OWN_MODULE = GetResponsibleModule();

function catalogConnections(): InterfaceConnection[] {
  const lookup = () => GetInterfaceInstances(CATALOG_INTERFACE);
  return OWN_MODULE === undefined
    ? lookup()
    : RunWithResponsibleModule(OWN_MODULE, lookup);
}

/** The catalog functions of one connection, as its provider answers them. */
export type CatalogConnection = typeof Catalog;

/**
 * Whether the module a connection's path loads answers every function the interface declares. The
 * path is the interface package as core binds it to that connection, so the signatures are the ones
 * `CatalogConnection` names; this checks that each of them is there and callable.
 */
function isCatalogConnection(loaded: unknown): loaded is CatalogConnection {
  return (
    typeof loaded === "object" &&
    loaded !== null &&
    "Info" in loaded &&
    typeof loaded.Info === "function" &&
    "ListRelations" in loaded &&
    typeof loaded.ListRelations === "function" &&
    "DescribeRelations" in loaded &&
    typeof loaded.DescribeRelations === "function" &&
    "Profile" in loaded &&
    typeof loaded.Profile === "function" &&
    "CheckReference" in loaded &&
    typeof loaded.CheckReference === "function"
  );
}

/**
 * The catalog connections the project declares for dms-ai, each one an `importOverrides` entry of
 * `@antelopejs/interface-database-catalog` with an id: which database a tool reads is project
 * configuration, never a choice the agent makes beyond naming one of these.
 */
export function listConnections(): string[] {
  return catalogConnections()
    .map((connection) => connection.id)
    .filter((id): id is string => typeof id === "string" && id.length > 0);
}

/**
 * The catalog of a declared connection, resolved in its own scope; nothing for an unknown one.
 *
 * @throws {TypeError} When the connection's module lacks a catalog function.
 */
export function catalogOf(id: string): CatalogConnection | undefined {
  const connection = catalogConnections().find(
    (candidate) => candidate.id === id,
  );
  if (!connection) return undefined;
  const loaded: unknown = require(connection.path);
  if (!isCatalogConnection(loaded)) {
    throw new TypeError(
      `Catalog connection ${id} does not answer the interface-database-catalog functions`,
    );
  }
  return loaded;
}
