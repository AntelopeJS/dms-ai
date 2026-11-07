import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const SIDECAR_BUILD = "pnpm build:sidecar";
const PLAYGROUNDS = ["playground", ".agents/skills/verify-dms-ai/playground"];

const requirements = [
  {
    file: "playground/antelope.config.ts",
    pattern:
      /installCommand: \["pnpm install", "pnpm build", "pnpm build:sidecar"\]/,
  },
  { file: ".agents/playground", pattern: new RegExp(SIDECAR_BUILD) },
];

const buildFailures = requirements
  .filter(
    ({ file, pattern }) =>
      !pattern.test(readFileSync(join(root, file), "utf8")),
  )
  .map(
    ({ file }) =>
      `${file}: the playground must build the sidecar before startup (\`${SIDECAR_BUILD}\`).`,
  );

const lockfileFailures = PLAYGROUNDS.filter(
  (dir) =>
    spawnSync(
      "pnpm",
      [
        "install",
        "--dir",
        join(root, dir),
        "--ignore-workspace",
        "--frozen-lockfile",
        "--lockfile-only",
        "--ignore-scripts",
      ],
      { stdio: "ignore" },
    ).status !== 0,
).map(
  (dir) =>
    `${dir}/pnpm-lock.yaml does not match ${dir}/package.json: run \`pnpm install --dir ${dir} --ignore-workspace --lockfile-only\`.`,
);

const failures = [...buildFailures, ...lockfileFailures];

if (failures.length > 0) {
  process.stderr.write(`${failures.join("\n")}\n`);
  process.exitCode = 1;
}
