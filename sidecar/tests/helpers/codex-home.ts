import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import { CODEX_CONFIG_FILE_NAME } from "../../src/constants/codex.js";
import { JsonValueSchema } from "../../src/protocol/json.js";
import { codexHomeFor } from "../../src/providers/codex/process.js";

const CATALOG_PATH_PATTERN = /^model_catalog_json = "(.+)"$/m;

const CATALOG = z.object({
  models: z.array(z.record(z.string(), JsonValueSchema)),
});

/** The config.toml of a live conversation's Codex home. */
export function readCodexConfig(
  stateDir: string,
  conversationId: string,
): Promise<string> {
  return readFile(
    join(codexHomeFor(stateDir, conversationId), CODEX_CONFIG_FILE_NAME),
    "utf8",
  );
}

/** The models of the catalog a config.toml points Codex at. */
export async function readConfiguredCatalog(
  configToml: string,
): Promise<z.infer<typeof CATALOG>["models"]> {
  const file = CATALOG_PATH_PATTERN.exec(configToml)?.[1];
  if (file === undefined) throw new Error("no model_catalog_json in config");
  const raw = await readFile(z.string().parse(JSON.parse(`"${file}"`)), "utf8");
  return CATALOG.parse(JSON.parse(raw)).models;
}
