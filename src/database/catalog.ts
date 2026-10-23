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
 * The catalog connections the project declares for dms-ai, each one an `importOverrides` entry of
 * `@antelopejs/interface-database-catalog` with an id: which database a tool reads is project
 * configuration, never a choice the agent makes beyond naming one of these.
 */
export function listConnections(): string[] {
  return catalogConnections()
    .map((connection) => connection.id)
    .filter((id): id is string => typeof id === "string" && id.length > 0);
}

/** The catalog of a declared connection, resolved in its own scope; nothing for an unknown one. */
export function catalogOf(id: string): CatalogConnection | undefined {
  const connection = catalogConnections().find(
    (candidate) => candidate.id === id,
  );
  return connection
    ? (require(connection.path) as CatalogConnection)
    : undefined;
}
