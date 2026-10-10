const assert = require("node:assert/strict");
const Module = require("node:module");
const path = require("node:path");
const { test } = require("node:test");

const BACKEND_URL = "http://127.0.0.1:41234";
const HOST_ORIGIN = "http://localhost:4173";

function loadModule(registrations, sidecars, warnings = []) {
  const filename = path.resolve(__dirname, "../dist/index.js");
  const mocks = {
    "@antelopejs/interface-dms/page": {
      AddFrontendModule: (registration) => registrations.push(registration),
    },
    "@antelopejs/interface-core/logging": {
      Logging: {
        Warn: (...args) => warnings.push(args),
        Error() {},
      },
    },
    "./builder/presence": { isBuilderAvailable: () => true },
    "./lifecycle/module-roots": {
      collectModuleRoots: () => ["fixture-module"],
    },
    "./lifecycle/skill-sources": {
      collectSkillSources: () => ["fixture-skills"],
    },
    "./lifecycle/spawn-sidecar": {
      spawnSidecar: async (options) => {
        sidecars.push(options);
      },
    },
    "./logging/log-buffer": { startLogCapture() {} },
    "./constants/frontend-module": {
      FRONTEND_MODULE_DIR: "../frontend-vue",
      FRONTEND_MODULE_NAME: "@antelopejs/dms-ai-frontend-vue",
      FRONTEND_MODULE_PRIORITY: 100,
    },
    "node:path": path,
    "./constants/sidecar": require(
      path.resolve(__dirname, "../dist/constants/sidecar.js"),
    ),
    // The config store is the unit under test here, so it is loaded for real.
    "./config": require(path.resolve(__dirname, "../dist/config.js")),
  };
  const originalLoad = Module._load;
  Module._load = (request) => mocks[request] ?? {};
  try {
    delete require.cache[filename];
    return originalLoad(filename, module, false);
  } finally {
    Module._load = originalLoad;
    delete require.cache[filename];
  }
}

void test("registers Vue and preserves sidecar inputs without launching an agent", async () => {
  const registrations = [];
  const sidecars = [];
  const loaded = loadModule(registrations, sidecars);
  loaded.construct({ backendUrl: BACKEND_URL });
  await loaded.start();
  assert.deepEqual(registrations, [
    {
      name: "@antelopejs/dms-ai-frontend-vue",
      sourcePath: path.resolve(__dirname, "../frontend-vue"),
      renderer: { name: "vue", version: "3" },
      priority: 100,
    },
  ]);
  assert.deepEqual(sidecars, [
    {
      hostProjectRoot: process.cwd(),
      backendUrl: BACKEND_URL,
      moduleRoots: ["fixture-module"],
      skillDirs: ["fixture-skills"],
      builderEnabled: true,
    },
  ]);
});

void test("warns once about a set hostOrigin and otherwise ignores it", async () => {
  const withHostOrigin = [];
  const warnings = [];
  const loaded = loadModule([], withHostOrigin, warnings);
  loaded.construct({ backendUrl: BACKEND_URL, hostOrigin: HOST_ORIGIN });
  loaded.construct({ backendUrl: BACKEND_URL, hostOrigin: HOST_ORIGIN });
  await loaded.start();
  const withoutHostOrigin = [];
  const silent = [];
  const reference = loadModule([], withoutHostOrigin, silent);
  reference.construct({ backendUrl: BACKEND_URL });
  await reference.start();
  assert.equal(warnings.length, 1);
  assert.match(String(warnings[0][0]), /hostOrigin/);
  assert.deepEqual(silent, []);
  assert.deepEqual(withHostOrigin, withoutHostOrigin);
});

void test("omits the origins the project did not configure", async () => {
  const sidecars = [];
  const loaded = loadModule([], sidecars);
  loaded.construct(undefined);
  await loaded.start();
  assert.deepEqual(sidecars, [
    {
      hostProjectRoot: process.cwd(),
      moduleRoots: ["fixture-module"],
      skillDirs: ["fixture-skills"],
      builderEnabled: true,
    },
  ]);
});

void test("ignores config entries that are not usable origins", async () => {
  const sidecars = [];
  const loaded = loadModule([], sidecars);
  loaded.construct({ backendUrl: "   ", hostOrigin: 5010 });
  await loaded.start();
  assert.deepEqual(sidecars, [
    {
      hostProjectRoot: process.cwd(),
      moduleRoots: ["fixture-module"],
      skillDirs: ["fixture-skills"],
      builderEnabled: true,
    },
  ]);
});

const LOCALES_DIR = path.resolve(__dirname, "../frontend-vue/i18n/locales");
const PAGE_LOCALES = ["dms-ai-pages-en-GB.json", "dms-ai-pages-fr-FR.json"];
const I18N_KEY = /\$dms_ai\.[A-Za-z0-9_.-]+/g;
const MODULE_PAGES = ["overview", "changes", "activity", "skills", "settings"];

function readLocale(file) {
  return JSON.parse(
    require("node:fs").readFileSync(path.join(LOCALES_DIR, file), "utf8"),
  );
}

function translate(locale, key) {
  return key
    .slice(1)
    .split(".")
    .reduce((node, part) => (node === undefined ? node : node[part]), locale);
}

function loadPages() {
  const registered = { modules: [], pages: [] };
  const pageApi = {
    RegisterModule: (info) => registered.modules.push(info),
    RegisterPage: () => (target) => {
      registered.pages.push(target);
    },
    PageController: (id, menu, layout) => {
      class Page {}
      Page.pageId = id;
      Page.menu = menu;
      Page.layout = layout;
      return Page;
    },
  };
  const originalLoad = Module._load;
  Module._load = (request, parent, isMain) =>
    request === "@antelopejs/interface-dms/page"
      ? pageApi
      : originalLoad(request, parent, isMain);
  try {
    for (const file of Object.keys(require.cache)) {
      if (file.includes(`${path.sep}dist${path.sep}pages`)) {
        delete require.cache[file];
      }
    }
    require(path.resolve(__dirname, "../dist/pages/index.js"));
  } finally {
    Module._load = originalLoad;
  }
  return registered;
}

function staticComponents(page) {
  return Object.entries(page).filter(
    ([, value]) => value && typeof value.serialize === "function",
  );
}

async function collectPositions(prefix, component, positions) {
  positions.push({ path: prefix, metadata: component.metadata });
  const info = await component.componentInfo;
  for (const child of info.children ?? []) {
    await collectPositions(`${prefix}.${child.id}`, child.component, positions);
  }
}

function collectKeys(value, keys) {
  if (typeof value === "string") {
    for (const match of value.matchAll(I18N_KEY)) keys.add(match[0]);
    return;
  }
  if (value && typeof value === "object") {
    for (const entry of Object.values(value)) collectKeys(entry, keys);
  }
}

void test("registers the five AI pages, in order, with translated menu entries", () => {
  const { modules, pages } = loadPages();
  assert.equal(modules.length, 1);
  assert.equal(modules[0].id, "ai");
  assert.equal(modules[0].landingPage, "overview");
  const sorted = [...pages].sort((a, b) => a.menu.order - b.menu.order);
  assert.deepEqual(
    sorted.map((page) => page.pageId),
    MODULE_PAGES,
  );
  for (const page of pages) {
    assert.equal(page.menu.module, "ai");
    assert.match(page.menu.displayName, /^\$dms_ai\.pages\./);
    assert.match(page.menu.description, /^\$dms_ai\.pages\./);
    assert.ok(page.menu.icon, `${page.pageId} has an icon`);
  }
});

void test("titles every block and child of the AI pages for the role editor", async () => {
  const { pages } = loadPages();
  const locales = PAGE_LOCALES.map(readLocale);
  for (const page of pages) {
    const positions = [];
    for (const [key, component] of staticComponents(page)) {
      await collectPositions(`${page.pageId}.${key}`, component, positions);
    }
    assert.ok(positions.length > 0, `${page.pageId} declares blocks`);
    for (const { path: where, metadata } of positions) {
      assert.match(metadata.name, /^\$dms_ai\.blocks\./, where);
      assert.match(metadata.description ?? "", /^\$dms_ai\.blocks\./, where);
      assert.ok(metadata.icon, `${where} has an icon`);
      for (const locale of locales) {
        assert.equal(typeof translate(locale, metadata.name), "string", where);
        assert.equal(
          typeof translate(locale, metadata.description),
          "string",
          where,
        );
      }
    }
  }
});

void test("translates every $dms_ai key the AI pages serve, in English and French", async () => {
  const { modules, pages } = loadPages();
  const keys = new Set();
  collectKeys(modules, keys);
  for (const page of pages) {
    collectKeys(page.menu, keys);
    collectKeys(page.layout, keys);
    for (const [, component] of staticComponents(page)) {
      collectKeys(await component.serialize(), keys);
    }
  }
  assert.ok(keys.size > 0);
  for (const file of PAGE_LOCALES) {
    const locale = readLocale(file);
    const missing = [...keys].filter(
      (key) => typeof translate(locale, key) !== "string",
    );
    assert.deepEqual(missing, [], file);
  }
});

const COMPONENT_PREFIX = "DmsAi";
const CUSTOM_COMPONENT = /"(DmsAi[A-Z][A-Za-z]+)"/g;
const COMPONENTS_DIR = path.resolve(
  __dirname,
  "../frontend-vue/app/components",
);
/** What no DMS block draws: the Changes view, the row drawers, the skill card. */
const PAGE_CUSTOM_COMPONENTS = [
  "DmsAiActivityDetail",
  "DmsAiChangesView",
  "DmsAiSkillCard",
  "DmsAiSkillDetail",
];

void test("names only the custom components the frontend registers, where no DMS block fits", async () => {
  const { pages } = loadPages();
  const names = new Set();
  for (const page of pages) {
    for (const [, component] of staticComponents(page)) {
      const serialized = JSON.stringify(await component.serialize());
      for (const match of serialized.matchAll(CUSTOM_COMPONENT)) {
        names.add(match[1]);
      }
    }
  }
  assert.deepEqual(
    [...names].sort((left, right) => left.localeCompare(right)),
    PAGE_CUSTOM_COMPONENTS,
  );
  for (const name of names) {
    const file = `${name.slice(COMPONENT_PREFIX.length)}.vue`;
    assert.ok(
      require("node:fs").existsSync(path.join(COMPONENTS_DIR, file)),
      `${name} is registered from ${file}`,
    );
  }
});
