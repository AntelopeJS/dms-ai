import { GetInterfaceInstances } from "@antelopejs/interface-core";
import type * as Catalog from "@antelopejs/interface-database-catalog";
import { CATALOG_INTERFACE } from "../constants/database";

/** The catalog functions of one connection, as its provider answers them. */
export type CatalogConnection = typeof Catalog;

/**
 * The catalog connections the project declares for dms-ai, each one an `importOverrides` entry of
 * `@antelopejs/interface-database-catalog` with an id: which database a tool reads is project
 * configuration, never a choice the agent makes beyond naming one of these.
 */
export function listConnections(): string[] {
  return GetInterfaceInstances(CATALOG_INTERFACE)
    .map((connection) => connection.id)
    .filter((id): id is string => typeof id === "string" && id.length > 0);
}

/** The catalog of a declared connection, resolved in its own scope; nothing for an unknown one. */
export function catalogOf(id: string): CatalogConnection | undefined {
  const connection = GetInterfaceInstances(CATALOG_INTERFACE).find(
    (candidate) => candidate.id === id,
  );
  return connection
    ? (require(connection.path) as CatalogConnection)
    : undefined;
}
