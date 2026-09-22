#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const SIDECAR_ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const REPO_ROOT = path.dirname(SIDECAR_ROOT);
const OUTPUT_DIR = path.join(
  SIDECAR_ROOT,
  "src",
  "providers",
  "codex",
  "protocol",
);
const GENERATION_CODEX_HOME = path.join(SIDECAR_ROOT, ".codex-home-generate");

/**
 * Protocol types the sidecar names, as `<namespace>/<type>` keys. Everything
 * these reach transitively is kept; the rest of the app-server surface is
 * dropped. `generate-ts` emits one file per type for the whole protocol, which
 * is two orders of magnitude more than the sidecar consumes.
 *
 * Naming a new `v2.Something` in the sidecar means adding it here. Forgetting
 * fails the sidecar typecheck with "Property 'Something' does not exist on type
 * 'typeof v2'", which is the intended signal rather than a silent gap.
 */
const PROTOCOL_ROOTS = [
  "v2/AskForApproval",
  "v2/FileUpdateChange",
  "v2/SandboxMode",
  "v2/SandboxPolicy",
  "v2/SkillMetadata",
  "v2/SkillScope",
  "v2/SkillsConfigWriteParams",
  "v2/SkillsListEntry",
  "v2/SkillsListResponse",
  "v2/ThreadStartResponse",
  "v2/ThreadTokenUsageUpdatedNotification",
  "v2/Turn",
  "v2/TurnPlanStep",
  "v2/TurnStartedNotification",
  "v2/UserInput",
];

// Namespace directory, as `generate-ts` lays it out, to the module it is
// flattened into. The root namespace lands in `common.ts` rather than in
// `index.ts` so the barrel the package's `exports` map points at holds only
// re-exports, which keeps the public shape identical to the generated tree.
const MODULE_BY_NAMESPACE = {
  ".": "common",
  v2: "v2",
  serde_json: "serde_json",
};

// Namespaces the barrel re-exports. `serde_json` stays reachable only through
// the types that reference it, exactly as the generated tree had it.
const PUBLIC_NAMESPACES = [".", "v2"];

const GENERATED_HEADER = [
  "// GENERATED CODE! DO NOT MODIFY BY HAND!",
  "// Pruned to the transitive closure of PROTOCOL_ROOTS and flattened by",
  "// sidecar/scripts/generate-codex-types.mjs. Run `pnpm generate:codex-types`.",
].join("\n");

const IMPORT_PATTERN = /^import type \{ (\w+) \} from "([^"]+)";$/;
const JS_SUFFIX_PATTERN = /\.js$/;

const PLATFORM_PACKAGE_BY_TARGET = {
  "x86_64-unknown-linux-musl": "@openai/codex-linux-x64",
  "aarch64-unknown-linux-musl": "@openai/codex-linux-arm64",
  "x86_64-apple-darwin": "@openai/codex-darwin-x64",
  "aarch64-apple-darwin": "@openai/codex-darwin-arm64",
  "x86_64-pc-windows-msvc": "@openai/codex-win32-x64",
  "aarch64-pc-windows-msvc": "@openai/codex-win32-arm64",
};

const TARGET_TRIPLE_BY_HOST = {
  "linux:x64": "x86_64-unknown-linux-musl",
  "linux:arm64": "aarch64-unknown-linux-musl",
  "darwin:x64": "x86_64-apple-darwin",
  "darwin:arm64": "aarch64-apple-darwin",
  "win32:x64": "x86_64-pc-windows-msvc",
  "win32:arm64": "aarch64-pc-windows-msvc",
};

/**
 * The version consumers are told to install. It lives in the root manifest's
 * optional peer dependency — the one declaration a consumer's package manager
 * sees — and is stamped into the generated barrel, so the spawn-time gate has a
 * single source of truth to compare the installed binary against.
 */
function readPinnedVersion() {
  const manifest = JSON.parse(
    readFileSync(path.join(REPO_ROOT, "package.json"), "utf8"),
  );
  const pinned = manifest.peerDependencies?.["@openai/codex"];
  if (!pinned || !/^\d+\.\d+\.\d+$/.test(pinned)) {
    throw new Error(
      `@openai/codex must be pinned to an exact version in the root manifest, found "${pinned}"`,
    );
  }
  return pinned;
}

function resolveCodexBinary() {
  const triple = TARGET_TRIPLE_BY_HOST[`${process.platform}:${process.arch}`];
  if (!triple) {
    throw new Error(`Unsupported host: ${process.platform} ${process.arch}`);
  }
  const require = createRequire(path.join(SIDECAR_ROOT, "package.json"));
  const launcher = require.resolve("@openai/codex/package.json");
  const fromLauncher = createRequire(launcher);
  const platformManifest = fromLauncher.resolve(
    `${PLATFORM_PACKAGE_BY_TARGET[triple]}/package.json`,
  );
  const binaryName = process.platform === "win32" ? "codex.exe" : "codex";
  const binary = path.join(
    path.dirname(platformManifest),
    "vendor",
    triple,
    "bin",
    binaryName,
  );
  if (!existsSync(binary)) {
    throw new Error(`codex binary not found at ${binary}`);
  }
  return binary;
}

function assertBinaryMatchesPin(binary, pinnedVersion) {
  const reported = execFileSync(binary, ["--version"], {
    encoding: "utf8",
  }).trim();
  if (!reported.endsWith(pinnedVersion)) {
    throw new Error(
      `Binary reports "${reported}" but package pins ${pinnedVersion}`,
    );
  }
  return reported;
}

function listGeneratedFiles(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return listGeneratedFiles(full);
    return entry.name.endsWith(".ts") ? [full] : [];
  });
}

/** Stable, locale-independent ordering for the emitted declarations. */
function byName(a, b) {
  return a < b ? -1 : a > b ? 1 : 0;
}

function namespaceOf(key) {
  const separator = key.lastIndexOf("/");
  return separator === -1 ? "." : key.slice(0, separator);
}

function nameOf(key) {
  return key.slice(key.lastIndexOf("/") + 1);
}

function fileOf(key) {
  return path.join(OUTPUT_DIR, `${key}.ts`);
}

/**
 * Splits one generated file into its imports and its declaration. The layout is
 * fixed: banner comments, then one single-line `import type` per dependency,
 * then the doc comment and the type itself.
 */
function parseGeneratedFile(key) {
  const lines = readFileSync(fileOf(key), "utf8").split("\n");
  const imports = [];
  let cursor = 0;
  for (; cursor < lines.length; cursor += 1) {
    const line = lines[cursor].trim();
    if (line === "" || line.startsWith("//")) continue;
    const matched = line.match(IMPORT_PATTERN);
    if (matched === null) break;
    imports.push(matched[2]);
  }
  const body = lines.slice(cursor).join("\n").trim();
  if (/^import\b/m.test(body)) {
    throw new Error(`Unexpected import past the header block in ${key}.ts`);
  }
  return { imports, body };
}

/** Turns a relative specifier into the `<namespace>/<type>` key it points at. */
function resolveSpecifier(fromKey, specifier) {
  const target = path.posix.normalize(
    path.posix.join(
      path.posix.dirname(`/${fromKey}`),
      specifier.replace(JS_SUFFIX_PATTERN, ""),
    ),
  );
  return target.replace(/^\//, "");
}

/**
 * Every type reachable from `PROTOCOL_ROOTS`, parsed once and kept in memory so
 * the generated tree can be replaced by the flattened modules afterwards.
 */
function collectClosure() {
  const closure = new Map();
  const pending = [...PROTOCOL_ROOTS];
  while (pending.length > 0) {
    const key = pending.pop();
    if (closure.has(key)) continue;
    if (!existsSync(fileOf(key))) {
      throw new Error(
        `Protocol root "${key}" does not exist in this codex version`,
      );
    }
    const parsed = parseGeneratedFile(key);
    closure.set(key, parsed);
    for (const specifier of parsed.imports) {
      const target = resolveSpecifier(key, specifier);
      if (existsSync(fileOf(target))) {
        pending.push(target);
        continue;
      }
      // A directory specifier is a barrel re-export; it carries no
      // declaration of its own, so nothing to pull in.
      const asDirectory = path.join(OUTPUT_DIR, target);
      if (existsSync(asDirectory) && statSync(asDirectory).isDirectory()) {
        continue;
      }
      throw new Error(`Dangling import "${specifier}" in ${key}.ts`);
    }
  }
  return closure;
}

function groupByNamespace(closure) {
  const grouped = new Map();
  for (const key of [...closure.keys()].sort(byName)) {
    const namespace = namespaceOf(key);
    if (!(namespace in MODULE_BY_NAMESPACE)) {
      throw new Error(`Unknown protocol namespace "${namespace}" (${key})`);
    }
    grouped.set(namespace, [...(grouped.get(namespace) ?? []), key]);
  }
  return grouped;
}

/**
 * Imports one flattened module needs from its siblings. Types of the same
 * namespace become same-file references and drop out.
 */
function crossNamespaceImports(closure, keys, namespace) {
  const byModule = new Map();
  for (const key of keys) {
    for (const specifier of closure.get(key).imports) {
      const target = resolveSpecifier(key, specifier);
      const targetNamespace = namespaceOf(target);
      if (targetNamespace === namespace) continue;
      const module = MODULE_BY_NAMESPACE[targetNamespace];
      byModule.set(
        module,
        (byModule.get(module) ?? new Set()).add(nameOf(target)),
      );
    }
  }
  return byModule;
}

function writeNamespaceModule(closure, namespace, keys) {
  const declared = new Set(keys.map(nameOf));
  const imports = crossNamespaceImports(closure, keys, namespace);
  for (const [module, names] of imports) {
    for (const name of names) {
      // Flattening puts imports and declarations in one scope, so a name
      // carried by two namespaces would silently shadow. Codex has a few
      // such pairs; refuse rather than emit types that mean the wrong thing.
      if (declared.has(name)) {
        throw new Error(
          `"${name}" exists in both "${namespace}" and "${module}"; flattening would shadow it`,
        );
      }
    }
  }
  const lines = [GENERATED_HEADER, ""];
  for (const module of [...imports.keys()].sort(byName)) {
    const names = [...imports.get(module)].sort(byName).join(", ");
    lines.push(`import type { ${names} } from "./${module}.js";`);
  }
  if (imports.size > 0) lines.push("");
  for (const key of keys) lines.push(closure.get(key).body, "");
  const file = `${MODULE_BY_NAMESPACE[namespace]}.ts`;
  writeFileSync(path.join(OUTPUT_DIR, file), `${lines.join("\n").trimEnd()}\n`);
  return file;
}

function writeBarrel(grouped, pinnedVersion) {
  const lines = [
    GENERATED_HEADER,
    "",
    "/** Codex version these types were generated from. */",
    `export const CODEX_PROTOCOL_VERSION = "${pinnedVersion}";`,
    "",
  ];
  for (const namespace of PUBLIC_NAMESPACES) {
    const keys = grouped.get(namespace) ?? [];
    if (keys.length === 0) continue;
    const module = MODULE_BY_NAMESPACE[namespace];
    if (namespace === ".") {
      const names = keys.map(nameOf).sort();
      lines.push(
        "export type {",
        ...names.map((name) => `\t${name},`),
        `} from "./${module}.js";`,
      );
      continue;
    }
    lines.push(`export * as ${namespace} from "./${module}.js";`);
  }
  writeFileSync(path.join(OUTPUT_DIR, "index.ts"), `${lines.join("\n")}\n`);
}

/** Replaces the file-per-type tree with one module per protocol namespace. */
function pruneAndFlatten(pinnedVersion) {
  const closure = collectClosure();
  const grouped = groupByNamespace(closure);
  for (const entry of readdirSync(OUTPUT_DIR)) {
    rmSync(path.join(OUTPUT_DIR, entry), { recursive: true, force: true });
  }
  const modules = [...grouped].map(([namespace, keys]) =>
    writeNamespaceModule(closure, namespace, keys),
  );
  writeBarrel(grouped, pinnedVersion);
  return { types: closure.size, modules: modules.length + 1 };
}

function main() {
  const pinnedVersion = readPinnedVersion();
  const binary = resolveCodexBinary();
  const reported = assertBinaryMatchesPin(binary, pinnedVersion);

  rmSync(OUTPUT_DIR, { recursive: true, force: true });
  mkdirSync(OUTPUT_DIR, { recursive: true });
  mkdirSync(GENERATION_CODEX_HOME, { recursive: true });
  execFileSync(binary, ["app-server", "generate-ts", "--out", OUTPUT_DIR], {
    env: { ...process.env, CODEX_HOME: GENERATION_CODEX_HOME },
    stdio: ["ignore", "inherit", "inherit"],
  });
  rmSync(GENERATION_CODEX_HOME, { recursive: true, force: true });

  const emitted = listGeneratedFiles(OUTPUT_DIR).length;
  const { types, modules } = pruneAndFlatten(pinnedVersion);
  process.stdout.write(
    `${reported}: generated ${emitted} protocol types, kept ${types} in ${modules} modules\n`,
  );
}

main();
