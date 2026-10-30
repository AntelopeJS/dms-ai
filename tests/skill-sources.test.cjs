const assert = require("node:assert/strict");
const fs = require("node:fs");
const Module = require("node:module");
const os = require("node:os");
const path = require("node:path");
const { test } = require("node:test");
const { z } = require("zod");

const SKILLS_DIR = "skills";
const LOADED_MODULE = "loaded-module";

/**
 * @param {string} dir - Directory of the package, created when missing.
 * @param {object} manifest - The package.json to write.
 */
function writePackage(dir, manifest) {
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "package.json"), JSON.stringify(manifest));
}

/**
 * @param {string} name - Package name.
 * @param {object} [extra] - Further package.json fields.
 */
function skillPackage(name, extra = {}) {
  return { name, antelopeJs: { skills: [`./${SKILLS_DIR}`] }, ...extra };
}

/**
 * @param {string} root - Directory holding a node_modules.
 * @param {string} name - Package name, scope included.
 */
function installed(root, name) {
  return path.join(root, "node_modules", ...name.split("/"));
}

/**
 * A loaded module in the module cache with one interface dependency, and a
 * project root that installs the core, a dev tool and the same module from
 * npm, none of them loaded as modules.
 */
function createFixture() {
  const base = fs.realpathSync(
    fs.mkdtempSync(path.join(os.tmpdir(), "dms-ai-skill-sources-")),
  );
  const moduleDir = path.join(base, "cache", LOADED_MODULE);
  const projectDir = path.join(base, "project");
  writePackage(
    moduleDir,
    skillPackage(LOADED_MODULE, { dependencies: { "@acme/interface-x": "1" } }),
  );
  writePackage(
    installed(moduleDir, "@acme/interface-x"),
    skillPackage("@acme/interface-x"),
  );
  writePackage(projectDir, {
    name: "project",
    dependencies: { "@acme/core": "1", "no-skills": "1" },
    devDependencies: { "@acme/dev-tools": "1", [LOADED_MODULE]: "1" },
  });
  for (const name of ["@acme/core", "@acme/dev-tools", LOADED_MODULE]) {
    writePackage(installed(projectDir, name), skillPackage(name));
  }
  writePackage(installed(projectDir, "no-skills"), { name: "no-skills" });
  return { base, moduleDir, projectDir };
}

/**
 * @param {Record<string, string>} modules - Local path of each loaded module by id.
 */
function loadCollector(modules) {
  const filename = require.resolve("../dist/lifecycle/skill-sources.js");
  /** @type {Record<string, unknown>} */
  const mocks = {
    "@antelopejs/interface-core/logging": {
      Logging: { Warn() {}, Error() {} },
    },
    "@antelopejs/interface-core/modules": {
      ListModules: async () => Object.keys(modules),
      /** @param {string} id - Id of a loaded module. */
      GetModuleInfo: async (id) => ({ localPath: modules[id] }),
    },
  };
  const originalRequire = z
    .instanceof(Function)
    .parse(Object.getOwnPropertyDescriptor(Module.prototype, "require")?.value);
  /**
   * @this {Module}
   * @param {string} request - The specifier being required.
   * @returns {unknown} The mock of the specifier, else the module it resolves to.
   */
  Module.prototype.require = function (request) {
    return mocks[request] ?? originalRequire.call(this, request);
  };
  try {
    delete require.cache[filename];
    return require("../dist/lifecycle/skill-sources.js");
  } finally {
    Object.defineProperty(Module.prototype, "require", {
      value: originalRequire,
    });
  }
}

void test("adds the skills of the project root's dependencies and devDependencies after the loaded modules", async (t) => {
  const { base, moduleDir, projectDir } = createFixture();
  t.after(() => fs.rmSync(base, { recursive: true, force: true }));
  const { collectSkillSources } = loadCollector({ [LOADED_MODULE]: moduleDir });

  const sources = await collectSkillSources(projectDir);

  assert.deepEqual(sources, [
    { module: LOADED_MODULE, dir: path.join(moduleDir, SKILLS_DIR) },
    {
      module: "acme-interface-x",
      dir: path.join(installed(moduleDir, "@acme/interface-x"), SKILLS_DIR),
    },
    {
      module: "acme-core",
      dir: path.join(installed(projectDir, "@acme/core"), SKILLS_DIR),
    },
    {
      module: "acme-dev-tools",
      dir: path.join(installed(projectDir, "@acme/dev-tools"), SKILLS_DIR),
    },
  ]);
});

void test("reads the project root when no module is loaded, as in an embedded runtime's host app", async (t) => {
  const { base, projectDir } = createFixture();
  t.after(() => fs.rmSync(base, { recursive: true, force: true }));
  const { collectSkillSources } = loadCollector({});

  const sources = await collectSkillSources(projectDir);

  assert.deepEqual(
    sources.map((source) => source.module),
    ["acme-core", "acme-dev-tools", LOADED_MODULE],
  );
});

void test("keeps the loaded modules' sources when the project root has no package.json", async (t) => {
  const { base, moduleDir } = createFixture();
  t.after(() => fs.rmSync(base, { recursive: true, force: true }));
  const { collectSkillSources } = loadCollector({ [LOADED_MODULE]: moduleDir });

  const sources = await collectSkillSources(path.join(base, "missing"));

  assert.deepEqual(
    sources.map((source) => source.module),
    [LOADED_MODULE, "acme-interface-x"],
  );
});
