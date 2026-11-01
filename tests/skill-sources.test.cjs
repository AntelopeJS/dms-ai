const assert = require("node:assert/strict");
const fs = require("node:fs");
const Module = require("node:module");
const os = require("node:os");
const path = require("node:path");
const { test } = require("node:test");

const SKILLS_DIR = "skills";
const LOADED_MODULE = "loaded-module";

function writePackage(dir, manifest) {
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "package.json"), JSON.stringify(manifest));
}

function skillPackage(name, extra = {}) {
  return { name, antelopeJs: { skills: [`./${SKILLS_DIR}`] }, ...extra };
}

function installed(root, name) {
  return path.join(root, "node_modules", ...name.split("/"));
}

/**
 * A loaded module in the module cache with one interface dependency, and a
 * project root that installs the core, a dev tool and the same module from
 * npm, none of them loaded as modules.
 * @returns {{ base: string, moduleDir: string, projectDir: string }}
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

function loadCollector(modules) {
  const filename = path.resolve(
    __dirname,
    "../dist/lifecycle/skill-sources.js",
  );
  const mocks = {
    "@antelopejs/interface-core/logging": {
      Logging: { Warn() {}, Error() {} },
    },
    "@antelopejs/interface-core/modules": {
      ListModules: async () => Object.keys(modules),
      GetModuleInfo: async (id) => ({ localPath: modules[id] }),
    },
  };
  const originalLoad = Module._load;
  Module._load = (request, parent, isMain) =>
    mocks[request] ?? originalLoad(request, parent, isMain);
  try {
    delete require.cache[filename];
    return require(filename);
  } finally {
    Module._load = originalLoad;
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

void test("takes a loaded module's skills from the loaded copy, not from another module's installed copy of it", async (t) => {
  const { base, moduleDir, projectDir } = createFixture();
  t.after(() => {
    fs.rmSync(base, { recursive: true, force: true });
  });
  writePackage(
    path.join(base, "cache", "interface-x"),
    skillPackage("@acme/interface-x"),
  );
  const modules = {
    [LOADED_MODULE]: moduleDir,
    "interface-x": path.join(base, "cache", "interface-x"),
  };

  assert.deepEqual(
    await loadCollector(modules).collectSkillSources(projectDir),
    [
      { module: LOADED_MODULE, dir: path.join(moduleDir, SKILLS_DIR) },
      {
        module: "interface-x",
        dir: path.join(base, "cache", "interface-x", SKILLS_DIR),
      },
      {
        module: "acme-core",
        dir: path.join(installed(projectDir, "@acme/core"), SKILLS_DIR),
      },
      {
        module: "acme-dev-tools",
        dir: path.join(installed(projectDir, "@acme/dev-tools"), SKILLS_DIR),
      },
    ],
  );
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
