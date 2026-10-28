import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const SIDECAR_BUILD = "pnpm build:sidecar";

const requirements = [
  {
    file: "playground/antelope.config.ts",
    pattern:
      /installCommand: \["pnpm install", "pnpm build", "pnpm build:sidecar"\]/,
  },
  { file: ".agents/playground", pattern: new RegExp(SIDECAR_BUILD) },
];

const failures = requirements
  .filter(
    ({ file, pattern }) =>
      !pattern.test(readFileSync(join(root, file), "utf8")),
  )
  .map(
    ({ file }) =>
      `${file}: the playground must build the sidecar before startup (\`${SIDECAR_BUILD}\`).`,
  );

if (failures.length > 0) {
  process.stderr.write(`${failures.join("\n")}\n`);
  process.exitCode = 1;
}
