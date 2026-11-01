const assert = require("node:assert/strict");
const { z } = require("zod");
const Module = require("node:module");
const path = require("node:path");
const { test } = require("node:test");
const { PAGE_LOCALES, readLocale } = require("./helpers/page-locales.cjs");

const BACKEND_URL = "http://127.0.0.1:41234";

function loadModule(registrations, sidecars) {
  const filename = path.resolve(__dirname, "../dist/index.js");
  const mocks = {
    "@antelopejs/interface-dms/page": {
      AddFrontendModule: (registration) => registrations.push(registration),
    },
    "@antelopejs/interface-core/logging": {
      Logging: { Error() {} },
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
    "./frontend-module": require(
      path.resolve(__dirname, "../dist/frontend-module.js"),
    ),
    "node:path": path,
    zod: require("zod"),
    "./constants/sidecar": require(
      path.resolve(__dirname, "../dist/constants/sidecar.js"),
    ),
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

void test("registers Vue with its /ai backend prefix and preserves sidecar inputs without launching an agent", async () => {
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
      backendProxies: [{ path: "/ai/**", auth: "session" }],
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
  loaded.construct({ backendUrl: "   ", unknown: 5010 });
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

const I18N_KEY = /\$dms_ai\.[A-Za-z0-9_.-]+/g;
const MODULE_PAGES = ["overview", "changes", "activity", "skills", "settings"];

function translate(locale, key) {
  return key
    .slice(1)
    .split(".")
    .reduce((node, part) => (node === undefined ? node : node[part]), locale);
}

const TextSchema = z.string();

function isTranslated(locale, key) {
  return TextSchema.safeParse(translate(locale, key)).success;
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
  if (TextSchema.safeParse(value).success) {
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
        assert.ok(isTranslated(locale, metadata.name), where);
        assert.ok(isTranslated(locale, metadata.description), where);
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
    const missing = [...keys].filter((key) => !isTranslated(locale, key));
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

/** The skill drawer is a reading panel: 768 px, the SKILL.md at a readable measure. */
const SKILL_DRAWER_SIZE = "3xl";

function findDrawers(value, drawers) {
  if (!value || typeof value !== "object") return drawers;
  if (value.type === "drawer") drawers.push(value);
  for (const entry of Object.values(value)) findDrawers(entry, drawers);
  return drawers;
}

void test("opens the skill detail as a 3xl reading panel on the right", async () => {
  const { pages } = loadPages();
  const skills = pages.find((page) => page.pageId === "skills");
  const drawers = [];
  for (const [, component] of staticComponents(skills)) {
    findDrawers(await component.serialize(), drawers);
  }
  const detail = drawers.filter((drawer) =>
    JSON.stringify(drawer).includes('"DmsAiSkillDetail"'),
  );
  assert.equal(detail.length, 1);
  assert.equal(detail[0].size, SKILL_DRAWER_SIZE);
  assert.equal(detail[0].direction, "right");
});

void test("titles the skill drawer with the DMS row header", async () => {
  const { pages } = loadPages();
  const skills = pages.find((page) => page.pageId === "skills");
  const drawers = [];
  for (const [, component] of staticComponents(skills)) {
    findDrawers(await component.serialize(), drawers);
  }
  const [detail] = drawers.filter((drawer) =>
    JSON.stringify(drawer).includes('"DmsAiSkillDetail"'),
  );
  assert.equal(detail.rowTitle, "{name}");
  assert.notEqual(detail.rowHeader, false);
  for (const file of PAGE_LOCALES) {
    const position = translate(readLocale(file), detail.positionLabel);
    assert.match(position, /\{index\}.*\{total\}/, file);
  }
});

/** The height of a real skill card, held by its placeholders while the cards load. */
const CARD_SKELETON_HEIGHT = "250px";

function findCards(value, cards) {
  if (!value || typeof value !== "object") return cards;
  if (value.card) cards.push(value.card);
  for (const entry of Object.values(value)) findCards(entry, cards);
  return cards;
}

void test("holds the skill card placeholders at the height of a real card", async () => {
  const { pages } = loadPages();
  const skills = pages.find((page) => page.pageId === "skills");
  const cards = [];
  for (const [, component] of staticComponents(skills)) {
    findCards(await component.serialize(), cards);
  }
  const skillCards = cards.filter((card) =>
    JSON.stringify(card).includes('"DmsAiSkillCard"'),
  );
  assert.ok(skillCards.length > 0);
  for (const card of skillCards) {
    assert.equal(card.skeletonHeight, CARD_SKELETON_HEIGHT);
  }
});

async function toolbarPeriod(page) {
  const [firstKey, toolbar] = staticComponents(page)[0];
  const info = await toolbar.componentInfo;
  const period = info.children.find((child) => child.id === "period");
  return {
    firstKey,
    toolbar: await toolbar.serialize(),
    childIds: info.children.map((child) => child.id),
    period: await period.component.serialize(),
  };
}

function findPage(pages, id) {
  return pages.find((page) => page.pageId === id);
}

void test("opens the Overview and Activity with the DMS page toolbar, its period only", async () => {
  const { pages } = loadPages();
  for (const id of ["overview", "activity"]) {
    const { firstKey, toolbar, childIds, period } = await toolbarPeriod(
      findPage(pages, id),
    );
    assert.equal(firstKey, "toolbar", id);
    assert.equal(toolbar.componentName, "dms-page-toolbar-block", id);
    assert.deepEqual(childIds, ["period"], id);
    assert.equal(period.options.rememberKey, "ai", id);
    assert.equal(period.options.rangeLabel, "relative", id);
    assert.equal(period.options.variant, "segmented", id);
  }
});

void test("offers the Overview's comparisons in a menu, the period before by default", async () => {
  const { pages } = loadPages();
  const { period } = await toolbarPeriod(findPage(pages, "overview"));
  assert.equal(period.options.id, "ai-overview");
  assert.deepEqual(period.options.presets, [
    "last-24h",
    "last-7-days",
    "last-30-days",
  ]);
  assert.equal(period.options.defaultPreset, "last-7-days");
  assert.deepEqual(period.options.comparisons, [
    "previous-period",
    "previous-year",
    "none",
  ]);
  assert.equal(period.options.defaultComparison, "previous-period");
  assert.equal(period.options.comparisonControl, "menu");
});

void test("scopes the audit log to the Activity period, the whole log by default", async () => {
  const { pages } = loadPages();
  const activity = findPage(pages, "activity");
  const { period } = await toolbarPeriod(activity);
  assert.equal(period.options.id, "ai-activity");
  assert.equal(period.options.defaultPreset, "all");
  assert.deepEqual(period.options.comparisons, ["none"]);
  const log = await activity.log.serialize();
  assert.equal(log.options.source.periodScope, "ai-activity");
});
