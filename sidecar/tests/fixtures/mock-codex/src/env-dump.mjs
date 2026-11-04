import { writeFileSync } from "node:fs";
import { ENV_DUMP_FILE_ENV_VAR } from "./constants.mjs";

export function dumpEnvironment() {
  const file = process.env[ENV_DUMP_FILE_ENV_VAR];
  if (file === undefined) return;
  writeFileSync(file, JSON.stringify(process.env));
}
