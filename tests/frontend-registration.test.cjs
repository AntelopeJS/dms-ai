const assert = require("node:assert/strict");
const { z } = require("zod");
const Module = require("node:module");
const path = require("node:path");
const { test } = require("node:test");
const { Component } = require("@antelopejs/interface-dms/component");
const { PAGE_LOCALES, readLocale } = require("./helpers/page-locales.cjs");

/**
 * @typedef {import("@antelopejs/interface-dms/page").ModuleInfo} ModuleInfo
 * @typedef {import("@antelopejs/interface-dms/page").MenuOptions} MenuOptions
 * @typedef {import("@antelopejs/interface-dms/component").Component} PageComponent
 * @typedef {import("@antelopejs/interface-dms/component").ComponentInfo} ComponentInfo
 * @typedef {import("@antelopejs/interface-dms/component").ComponentMetadata} ComponentMetadata
 * @typedef {import("./helpers/page-locales.cjs").LocaleNode} LocaleNode
 */

const BACKEND_URL = "http://127.0.0.1:41234";

const RequireMethod = z.instanceof(Function);

/**
 * Makes the requires of the modules loaded from now on resolve to the mocks.
 *
 * @param {Record<string, unknown>} mocks - Exports by module specifier.
 * @param {boolean} stubUnmocked - Whether a specifier with no mock resolves to an empty module, instead of the real one, for the modules this test did not load itself.
 * @returns {() => void} Puts the real require back.
 */
function interceptRequire(mocks, stubUnmocked) {
  const originalRequire = RequireMethod.parse(
    Object.getOwnPropertyDescriptor(Module.prototype, "require")?.value,
  );
  /**
   * @this {Module}
   * @param {string} request - The specifier being required.
   * @returns {unknown} The mock of the specifier, else the module it resolves to.
   */
  Module.prototype.require = function (request) {
    return (
      mocks[request] ??
      (stubUnmocked && this !== module
        ? {}
        : originalRequire.call(this, request))
    );
  };
  return () => {
    Object.defineProperty(Module.prototype, "require", {
      value: originalRequire,
    });
  };
}

/**
 * @param {unknown[]} registrations - Receives each frontend module registered.
 * @param {unknown[]} sidecars - Receives the options of each sidecar spawned.
 */
function loadModule(registrations, sidecars) {
  const filename = require.resolve("../dist/index.js");
  /** @type {Record<string, unknown>} */
  const mocks = {
    "@antelopejs/interface-dms/page": {
      /** @param {unknown} registration - The frontend module being registered. */
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
      /** @param {unknown} options - The options the sidecar is spawned with. */
      spawnSidecar: async (options) => {
        sidecars.push(options);
      },
    },
    "./logging/log-buffer": { startLogCapture() {} },
    "./frontend-module": require("../dist/frontend-module.js"),
    "node:path": path,
    zod: require("zod"),
    "./constants/sidecar": require("../dist/constants/sidecar.js"),
    "./config": require("../dist/config.js"),
  };
  const restoreRequire = interceptRequire(mocks, true);
  try {
    delete require.cache[filename];
    return require("../dist/index.js");
  } finally {
    restoreRequire();
    delete require.cache[filename];
  }
}

void test("registers Vue with its /ai backend prefix and preserves sidecar inputs without launching an agent", async () => {
  /** @type {unknown[]} */
  const registrations = [];
  /** @type {unknown[]} */
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
  /** @type {unknown[]} */
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
  /** @type {unknown[]} */
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

/**
 * @param {{ [key: string]: LocaleNode }} locale - A page locale.
 * @param {string} key - A `$`-prefixed dotted key.
 * @returns {LocaleNode | undefined} The node the key leads to, if the locale holds one.
 */
function translate(locale, key) {
  /** @type {LocaleNode | undefined} */
  let node = locale;
  for (const part of key.slice(1).split(".")) {
    node = node instanceof Object ? node[part] : undefined;
  }
  return node;
}

const TextSchema = z.string();

/**
 * @param {{ [key: string]: LocaleNode }} locale - A page locale.
 * @param {string} key - A `$`-prefixed dotted key.
 */
function isTranslated(locale, key) {
  return TextSchema.safeParse(translate(locale, key)).success;
}

/**
 * @param {string} id - Id of the page.
 * @param {MenuOptions} menu - Menu entry of the page.
 * @param {ComponentInfo | undefined} layout - Layout of the page.
 */
function pageController(id, menu, layout) {
  class Page {}
  Page.pageId = id;
  Page.menu = menu;
  Page.layout = layout;
  return Page;
}

/**
 * A page class as the AI module registers it: the id, menu and layout come
 * from the controller base, and its own enumerable statics are its components.
 *
 * @typedef {ReturnType<typeof pageController>} RegisteredPage
 */

function loadPages() {
  /** @type {{ modules: ModuleInfo[]; pages: RegisteredPage[] }} */
  const registered = { modules: [], pages: [] };
  const pageApi = {
    /** @param {ModuleInfo} info - The module being registered. */
    RegisterModule: (info) => registered.modules.push(info),
    RegisterPage:
      () =>
      /** @param {RegisteredPage} target - The page class being registered. */
      (target) => {
        registered.pages.push(target);
      },
    PageController: pageController,
  };
  const restoreRequire = interceptRequire(
    { "@antelopejs/interface-dms/page": pageApi },
    false,
  );
  try {
    for (const file of Object.keys(require.cache)) {
      if (file.includes(`${path.sep}dist${path.sep}pages`)) {
        delete require.cache[file];
      }
    }
    require("../dist/pages/index.js");
  } finally {
    restoreRequire();
  }
  return registered;
}

const ComponentSchema = z.instanceof(Component);

/**
 * @param {RegisteredPage} page - A registered page.
 * @returns {[string, PageComponent][]} The own static fields of the page that are components, by name.
 */
function staticComponents(page) {
  return Object.entries(page).flatMap((entry) => {
    const component = ComponentSchema.safeParse(entry[1]);
    return component.success ? [[entry[0], component.data]] : [];
  });
}

/**
 * @param {RegisteredPage} page - A registered page.
 * @param {string} field - Name of the static field.
 */
function staticComponent(page, field) {
  const found = staticComponents(page).find(([key]) => key === field);
  assert.ok(found, `${page.pageId} declares ${field}`);
  return found[1];
}

/**
 * @typedef {{ path: string; metadata: ComponentMetadata }} Position
 */

/**
 * @param {string} prefix - Path of the component.
 * @param {PageComponent} component - The component to visit, then its children.
 * @param {Position[]} positions - Receives each position visited.
 */
async function collectPositions(prefix, component, positions) {
  positions.push({ path: prefix, metadata: component.metadata });
  const info = await component.componentInfo;
  for (const child of info.children ?? []) {
    await collectPositions(`${prefix}.${child.id}`, child.component, positions);
  }
}

/**
 * @param {unknown} value - A node of a serialized tree.
 * @param {Set<string>} keys - Receives each `$dms_ai` key found.
 */
function collectKeys(value, keys) {
  const text = TextSchema.safeParse(value);
  if (text.success) {
    for (const match of text.data.matchAll(I18N_KEY)) keys.add(match[0]);
    return;
  }
  if (value && typeof value === "object") {
    for (const entry of Object.values(value)) collectKeys(entry, keys);
  }
}

const OrderSchema = z.number();

void test("registers the five AI pages, in order, with translated menu entries", () => {
  const { modules, pages } = loadPages();
  assert.equal(modules.length, 1);
  assert.equal(modules[0].id, "ai");
  assert.equal(modules[0].landingPage, "overview");
  const sorted = [...pages].sort(
    (a, b) => OrderSchema.parse(a.menu.order) - OrderSchema.parse(b.menu.order),
  );
  assert.deepEqual(
    sorted.map((page) => page.pageId),
    MODULE_PAGES,
  );
  for (const page of pages) {
    assert.equal(page.menu.module, "ai");
    assert.match(page.menu.displayName, /^\$dms_ai\.pages\./);
    assert.match(page.menu.description ?? "", /^\$dms_ai\.pages\./);
    assert.ok(page.menu.icon, `${page.pageId} has an icon`);
  }
});

void test("titles every block and child of the AI pages for the role editor", async () => {
  const { pages } = loadPages();
  const locales = PAGE_LOCALES.map(readLocale);
  for (const page of pages) {
    /** @type {Position[]} */
    const positions = [];
    for (const [key, component] of staticComponents(page)) {
      await collectPositions(`${page.pageId}.${key}`, component, positions);
    }
    assert.ok(positions.length > 0, `${page.pageId} declares blocks`);
    for (const { path: where, metadata } of positions) {
      assert.match(metadata.name, /^\$dms_ai\.blocks\./, where);
      const description = metadata.description ?? "";
      assert.match(description, /^\$dms_ai\.blocks\./, where);
      assert.ok(metadata.icon, `${where} has an icon`);
      for (const locale of locales) {
        assert.ok(isTranslated(locale, metadata.name), where);
        assert.ok(isTranslated(locale, description), where);
      }
    }
  }
});

void test("translates every $dms_ai key the AI pages serve, in English and French", async () => {
  const { modules, pages } = loadPages();
  /** @type {Set<string>} */
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
  /** @type {Set<string>} */
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

const DrawerSchema = z.looseObject({
  type: z.literal("drawer"),
  size: z.unknown().optional(),
  direction: z.unknown().optional(),
  rowTitle: z.unknown().optional(),
  rowHeader: z.unknown().optional(),
  positionLabel: z.unknown().optional(),
});

/** @typedef {z.infer<typeof DrawerSchema>} Drawer */

/**
 * @param {unknown} value - A node of a serialized tree.
 * @param {Drawer[]} drawers - Receives each drawer found.
 * @returns {Drawer[]} The drawers.
 */
function findDrawers(value, drawers) {
  if (!value || typeof value !== "object") return drawers;
  const drawer = DrawerSchema.safeParse(value);
  if (drawer.success) drawers.push(drawer.data);
  for (const entry of Object.values(value)) findDrawers(entry, drawers);
  return drawers;
}

void test("opens the skill detail as a 3xl reading panel on the right", async () => {
  const { pages } = loadPages();
  const skills = findPage(pages, "skills");
  /** @type {Drawer[]} */
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
  const skills = findPage(pages, "skills");
  /** @type {Drawer[]} */
  const drawers = [];
  for (const [, component] of staticComponents(skills)) {
    findDrawers(await component.serialize(), drawers);
  }
  const [detail] = drawers.filter((drawer) =>
    JSON.stringify(drawer).includes('"DmsAiSkillDetail"'),
  );
  assert.ok(detail, "the skills page serves the skill detail drawer");
  assert.equal(detail.rowTitle, "{name}");
  assert.notEqual(detail.rowHeader, false);
  for (const file of PAGE_LOCALES) {
    const position = TextSchema.safeParse(
      translate(readLocale(file), TextSchema.parse(detail.positionLabel)),
    );
    assert.ok(position.success, file);
    assert.match(position.data, /\{index\}.*\{total\}/, file);
  }
});

/** The height of a real skill card, held by its placeholders while the cards load. */
const CARD_SKELETON_HEIGHT = "250px";

const CardHolderSchema = z.looseObject({
  card: z.looseObject({ skeletonHeight: z.unknown().optional() }),
});

/** @typedef {z.infer<typeof CardHolderSchema>["card"]} Card */

/**
 * @param {unknown} value - A node of a serialized tree.
 * @param {Card[]} cards - Receives each card found.
 * @returns {Card[]} The cards.
 */
function findCards(value, cards) {
  if (!value || typeof value !== "object") return cards;
  const holder = CardHolderSchema.safeParse(value);
  if (holder.success) cards.push(holder.data.card);
  for (const entry of Object.values(value)) findCards(entry, cards);
  return cards;
}

void test("holds the skill card placeholders at the height of a real card", async () => {
  const { pages } = loadPages();
  const skills = findPage(pages, "skills");
  /** @type {Card[]} */
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

const PeriodSchema = z.looseObject({
  options: z.looseObject({
    id: z.unknown().optional(),
    rememberKey: z.unknown().optional(),
    rangeLabel: z.unknown().optional(),
    variant: z.unknown().optional(),
    presets: z.unknown().optional(),
    defaultPreset: z.unknown().optional(),
    comparisons: z.unknown().optional(),
    defaultComparison: z.unknown().optional(),
    comparisonControl: z.unknown().optional(),
  }),
});

const LogSchema = z.looseObject({
  options: z.looseObject({
    source: z.looseObject({ periodScope: z.unknown().optional() }),
  }),
});

/** @param {RegisteredPage} page - A registered page. */
async function toolbarPeriod(page) {
  const [firstKey, toolbar] = staticComponents(page)[0];
  const info = await toolbar.componentInfo;
  const children = info.children ?? [];
  const period = children.find((child) => child.id === "period");
  assert.ok(period, `${page.pageId} toolbar has a period`);
  return {
    firstKey,
    toolbar: await toolbar.serialize(),
    childIds: children.map((child) => child.id),
    period: PeriodSchema.parse(await period.component.serialize()),
  };
}

/**
 * @param {RegisteredPage[]} pages - The registered pages.
 * @param {string} id - Id of the page to find.
 */
function findPage(pages, id) {
  const page = pages.find((candidate) => candidate.pageId === id);
  assert.ok(page, `${id} is registered`);
  return page;
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
  const log = LogSchema.parse(
    await staticComponent(activity, "log").serialize(),
  );
  assert.equal(log.options.source.periodScope, "ai-activity");
});
