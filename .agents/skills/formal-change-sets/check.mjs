#!/usr/bin/env node
/**
 * Model-checks ChangeSets.tla with TLC under Sequential.cfg and ChangeSets.cfg.
 *
 * Every INVARIANT of a config must hold, except its `findings`, each of which
 * must still break with a shortest counterexample of exactly the recorded
 * number of states. Prints one line per rule (`holds`, `finding`, `BROKEN`,
 * `CHANGED` or `HOLDS`), the output contract of the shared runner in
 * `@antelopejs/tooling-configs/formal`, which this repository's pinned pack
 * does not ship yet. Exits 0 when TLC agrees, 1 when a rule changed, 2 when
 * TLC could not run.
 */
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

/** @typedef {{ config: string, findings: Record<string, number> }} Check */
/** @typedef {{ constants: string[], invariants: string[] }} Config */
/** @typedef {{ violated: string | undefined, distinct: string | undefined, steps: string[] }} TlcResult */

const DIR = path.dirname(fileURLToPath(import.meta.url));
const SPEC = "ChangeSets";
const TLC_VERSION = "1.7.4";
const TLC_URL = `https://github.com/tlaplus/tlaplus/releases/download/v${TLC_VERSION}/tla2tools.jar`;
const TLC_SHA256 = "936a262061c914694dfd669a543be24573c45d5aa0ff20a8b96b23d01e050e88";
const DOCKER_IMAGE = "eclipse-temurin:21-jre";
const EXIT = { changed: 1, tool: 2 };

/** Rules today's code breaks, per config, with the states in TLC's shortest counterexample. */
const CHECKS = /** @type {Check[]} */ ([
  {
    config: "Sequential",
    findings: {
      UndoAloneKeepsLaterLines: 13,
      RedoKeepsAppliedLines: 15,
      RedoLeavesUndoneLinesOut: 15,
      UndoLeavesUndoneLinesOut: 15,
      UndoKeepsAppliedLines: 17,
    },
  },
  {
    config: "ChangeSets",
    findings: {
      SetHoldsOnlyItsTurnsLines: 12,
      UndoReachesLaterSets: 12,
    },
  },
]);

/**
 * Stops the check because TLC could not run.
 *
 * @param {string} message What went wrong
 * @returns {never}
 */
function fail(message) {
  console.error(`check: ${message}`);
  process.exit(EXIT.tool);
}

/**
 * @param {string} file A file
 * @returns {string} Its SHA-256, hex
 */
function sha256(file) {
  return createHash("sha256").update(readFileSync(file)).digest("hex");
}

/**
 * The pinned tla2tools.jar, downloaded once into the shared cache and checked against its SHA-256.
 *
 * @returns {Promise<string>} Its path
 */
async function ensureJar() {
  const cacheRoot = process.env.XDG_CACHE_HOME ?? path.join(os.homedir(), ".cache");
  const dir = path.join(cacheRoot, "antelopejs-formal");
  const jar = path.join(dir, `tla2tools-${TLC_VERSION}.jar`);
  if (existsSync(jar) && sha256(jar) === TLC_SHA256) return jar;
  mkdirSync(dir, { recursive: true });
  console.log(`Downloading ${TLC_URL}`);
  const response = await fetch(TLC_URL);
  if (!response.ok) fail(`download failed: HTTP ${response.status}`);
  const partial = `${jar}.${process.pid}.part`;
  writeFileSync(partial, Buffer.from(await response.arrayBuffer()));
  const actual = sha256(partial);
  if (actual !== TLC_SHA256) {
    rmSync(partial, { force: true });
    fail(`tla2tools.jar has SHA-256 ${actual}, expected ${TLC_SHA256}`);
  }
  renameSync(partial, jar);
  return jar;
}

let dockerRuns = 0;

/**
 * Java from `$JAVA`, else `java` on PATH, else the Temurin Docker image.
 *
 * @param {string} jar The jar
 * @param {string} work The work folder
 * @returns {{ program: string, prefix: string[] }} The program and the arguments before Java's own
 */
function javaInvocation(jar, work) {
  if (process.env.JAVA) return { program: process.env.JAVA, prefix: [] };
  if (spawnSync("java", ["-version"], { stdio: "ignore" }).status === 0) return { program: "java", prefix: [] };
  dockerRuns += 1;
  const name = process.env.TLC_DOCKER_PREFIX ?? "antelopejs-formal-tlc";
  const jars = path.dirname(jar);
  const user = `${process.getuid?.() ?? 0}:${process.getgid?.() ?? 0}`;
  return {
    program: "docker",
    prefix: ["run", "--rm", "--name", `${name}-${process.pid}-${dockerRuns}`, "--user", user, "-v", `${jars}:${jars}:ro`, "-v", `${work}:${work}`, "-w", work, DOCKER_IMAGE, "java"],
  };
}

/**
 * @param {string} config The config's name, without `.cfg`
 * @param {Record<string, number>} findings The recorded findings
 * @returns {Config} Its constants and invariants
 */
function readConfig(config, findings) {
  const text = readFileSync(path.join(DIR, `${config}.cfg`), "utf8");
  const constants = Array.from(text.matchAll(/^\s+(\w+)\s*=\s*(.+?)\s*$/gm), ([, name, value]) => `  ${name} = ${value}`);
  const invariants = Array.from(text.matchAll(/^INVARIANT\s+(\w+)/gm), ([, name]) => name);
  for (const name of Object.keys(findings)) {
    if (!invariants.includes(name)) fail(`finding ${name} is not an INVARIANT in ${config}.cfg`);
  }
  return { constants, invariants };
}

/**
 * Runs TLC on the spec under a config's constants with these invariants.
 *
 * @param {{ jar: string, work: string, config: Config, name: string, workers: string }} run The run
 * @param {string[]} invariants The rules to check
 * @returns {TlcResult} The first violated rule, the states explored and the counterexample's actions
 */
function runTlc(run, invariants) {
  const { jar, work, config, name, workers } = run;
  const cfg = path.join(work, `${name}.cfg`);
  writeFileSync(cfg, ["SPECIFICATION Spec", "CONSTANTS", ...config.constants, ...invariants.map((rule) => `INVARIANT ${rule}`), ""].join("\n"));
  const java = javaInvocation(jar, work);
  const args = [...java.prefix, "-XX:+UseParallelGC", "-cp", jar, "tlc2.TLC", "-config", cfg, "-workers", workers, "-deadlock", "-metadir", path.join(work, `states-${name}`), `${SPEC}.tla`];
  const result = spawnSync(java.program, args, { cwd: work, encoding: "utf8", maxBuffer: 268_435_456 });
  if (result.error) fail(`cannot run ${java.program}: ${result.error.message}`);
  const output = `${result.stdout}${result.stderr}`;
  writeFileSync(path.join(work, `${name}.out`), output);
  const violated = /Invariant (\w+) is violated/.exec(output)?.[1];
  const distinct = /([\d,]+) distinct states found, 0 states left/.exec(output)?.[1];
  if (!violated && !output.includes("No error has been found")) {
    fail(`TLC did not finish ${name}; output in ${path.join(work, `${name}.out`)}\n${output.slice(-2000)}`);
  }
  return { violated, distinct, steps: Array.from(output.matchAll(/^State \d+: <(\w+)/gm), ([, action]) => action) };
}

/**
 * Checks one config: the holding rules together, then each finding alone.
 *
 * @param {string} jar The jar
 * @param {string} work The work folder
 * @param {Check} check The config and its findings
 * @returns {boolean} Whether a rule changed
 */
function checkConfig(jar, work, check) {
  const config = readConfig(check.config, check.findings);
  const run = { jar, work, config };
  const holding = config.invariants.filter((rule) => !Object.hasOwn(check.findings, rule));
  console.log(`TLC ${TLC_VERSION} on ${SPEC}.tla (${check.config}.cfg) with ${config.constants.map((line) => line.trim()).join(", ")}`);
  let changed = false;
  if (holding.length > 0) {
    const held = runTlc({ ...run, name: `${check.config}-holds`, workers: "auto" }, holding);
    if (held.violated) {
      changed = true;
      console.log(`BROKEN ${held.violated}: ${held.steps.join(" -> ")}`);
    } else {
      console.log(`holds  ${holding.join(", ")} (${held.distinct} states)`);
    }
  }
  for (const [rule, expected] of Object.entries(check.findings)) {
    const found = runTlc({ ...run, name: `${check.config}-${rule}`, workers: "1" }, [rule]);
    if (!found.violated) {
      changed = true;
      console.log(`HOLDS  ${rule}: the finding is gone (${found.distinct} states)`);
      continue;
    }
    const length = found.steps.length;
    changed ||= length !== expected;
    console.log(`${length === expected ? "finding" : "CHANGED"} ${rule}: ${length} states (recorded ${expected}): ${found.steps.join(" -> ")}`);
  }
  return changed;
}

const jar = await ensureJar();
const work = mkdtempSync(path.join(os.tmpdir(), `formal-${SPEC}-`));
for (const file of readdirSync(DIR).filter((name) => name.endsWith(".tla"))) copyFileSync(path.join(DIR, file), path.join(work, file));
let changed = false;
for (const check of CHECKS) changed = checkConfig(jar, work, check) || changed;
if (changed) {
  console.log(`TLC output kept in ${work}`);
  process.exit(EXIT.changed);
}
rmSync(work, { recursive: true, force: true });
console.log("Every rule matches the record in SKILL.md.");
