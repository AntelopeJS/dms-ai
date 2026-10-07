const assert = require("node:assert/strict");
const http = require("node:http");
const Module = require("node:module");
const path = require("node:path");
const { after, before, test } = require("node:test");
const { HTTPResult } = require("@antelopejs/interface-api");

const dist = (file) => path.resolve(__dirname, "../dist", file);
const OWNER = { _id: "user-1", name: "Camille Laurent", email: "c@acme.test" };
const CLIENT_TOKEN = "client-secret";

/** A stand-in sidecar: records each request, answers from `routes`. */
const sidecar = { port: null, requests: [], routes: new Map(), isDown: false };

function answer(method, pathname, status, body) {
  sidecar.routes.set(`${method} ${pathname}`, { status, body });
}

function startFakeSidecar() {
  const server = http.createServer((req, res) => {
    let raw = "";
    req.on("data", (chunk) => {
      raw += chunk;
    });
    req.on("end", () => {
      const url = new URL(req.url, "http://sidecar.test");
      sidecar.requests.push({
        method: req.method,
        path: url.pathname,
        query: Object.fromEntries(url.searchParams),
        body: raw ? JSON.parse(raw) : undefined,
        authorization: req.headers.authorization,
      });
      const route = sidecar.routes.get(`${req.method} ${url.pathname}`) ?? {
        status: 404,
        body: { message: "no route" },
      };
      res.writeHead(route.status, { "Content-Type": "application/json" });
      res.end(JSON.stringify(route.body));
    });
  });
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      sidecar.port = server.address().port;
      resolve(server);
    });
  });
}

function loadControllers(files) {
  const decorator = () => () => undefined;
  const api = {
    HTTPResult,
    Controller: (location) => {
      class Base {}
      Base.location = location;
      return Base;
    },
    Get: decorator,
    Post: decorator,
    Put: decorator,
    Context: decorator,
    Parameter: decorator,
    JSONBody: decorator,
    RawBody: decorator,
  };
  const mocks = {
    "@antelopejs/interface-api": api,
    "@antelopejs/interface-dms/auth": {
      AuthOwnerOnly: decorator,
      AuthRawUser: decorator,
    },
    "../lifecycle/spawn-sidecar": {
      ensureSidecarRunning: async () => undefined,
      getSidecarPort: () => (sidecar.isDown ? null : sidecar.port),
      getSidecarClientToken: () => CLIENT_TOKEN,
      hasSidecarGivenUp: () => false,
      isSidecarDisabled: () => false,
      isSidecarRunning: () => !sidecar.isDown,
      restartSidecar: async () => undefined,
    },
  };
  const originalLoad = Module._load;
  Module._load = (request, parent, isMain) =>
    mocks[request] ?? originalLoad(request, parent, isMain);
  try {
    for (const file of Object.keys(require.cache)) {
      if (file.startsWith(dist(""))) delete require.cache[file];
    }
    return Object.assign({}, ...files.map((file) => require(dist(file))));
  } finally {
    Module._load = originalLoad;
  }
}

function context(query) {
  return { url: new URL(`http://backend.test/ai/x?${query}`) };
}

function reset() {
  sidecar.requests = [];
  sidecar.routes = new Map();
  sidecar.isDown = false;
}

let server;
let routes;
before(async () => {
  server = await startFakeSidecar();
  routes = loadControllers([
    "routes/activity.js",
    "routes/changes.js",
    "routes/metrics.js",
    "routes/settings.js",
    "routes/skills.js",
    "routes/status.js",
  ]);
});
after(() => new Promise((resolve) => server.close(resolve)));

const ROW = {
  id: "c-1:call-1",
  timestampMs: Date.UTC(2026, 9, 7, 14, 2),
  tool: "BuilderAddBlock",
  target: "sales/overview",
  agent: "claude",
  allowedBy: "builder_auto",
  result: "done",
  conversationId: "c-1",
  conversationTitle: "Top customers",
  isReadOnly: false,
  isAutoFix: false,
  category: ["changed"],
};

void test("translates the Activity table's query and keys each row by its id", async () => {
  reset();
  answer("GET", "/activity", 200, { results: [ROW], total: 1 });
  const page = await new routes.AIActivityController().list(
    context(
      "offset=25&limit=25&search=vat&filter_category=is:changed" +
        "&filter_isReadOnly=is:false&filter_tool=is:Bash&filter_agent=is_not:codex",
    ),
  );
  const [request] = sidecar.requests;
  assert.equal(request.authorization, `Bearer ${CLIENT_TOKEN}`);
  assert.deepEqual(request.query, {
    offset: "25",
    limit: "25",
    search: "vat",
    category: "changed",
    tool: "Bash",
    hideReadOnly: "true",
  });
  assert.equal(page.total, 1);
  assert.equal(page.results[0]._id, ROW.id);
  assert.equal(page.results[0].timestamp, "2026-10-07T14:02:00.000Z");
});

void test("answers 503 with a message from lists and settings while the sidecar is down", async () => {
  reset();
  sidecar.isDown = true;
  const answers = [
    await new routes.AIActivityController().list(context("")),
    await new routes.AIChangesController().list(context("")),
    await new routes.AISkillsController().catalog(context("")),
    await new routes.AISettingsController().getSettings(),
    await new routes.AISettingsController().updateSettings({ thinking: "low" }),
  ];
  for (const result of answers) {
    assert.ok(result instanceof HTTPResult);
    assert.equal(result.getStatus(), 503);
    assert.deepEqual(JSON.parse(result.getBody()), {
      message: "The assistant isn't running.",
    });
  }
});

void test("keeps the charts empty rather than failing while the sidecar is down", async () => {
  reset();
  sidecar.isDown = true;
  const metrics = new routes.AIMetricsController();
  assert.equal((await metrics.kpi("actions")).value, 0);
  assert.deepEqual((await metrics.series()).series, []);
  assert.deepEqual(await metrics.allowed(), { items: [] });
  assert.deepEqual(await metrics.topTools(), { items: [] });
  assert.deepEqual((await metrics.usageSummary("14")).items.length, 2);
});

void test("words the How-allowed breakdown and the top tools with $dms_ai keys", async () => {
  reset();
  answer("GET", "/metrics/allowed", 200, {
    items: [
      { id: "approved", value: 21 },
      { id: "read_auto", value: 118 },
    ],
    deletionsAsked: 2,
    deletions: 2,
  });
  answer("GET", "/metrics/top-tools", 200, {
    items: [
      { id: "mcp__dms-ai__BuilderAddBlock", value: 42, source: "builder" },
      { id: "SomethingNew", value: 1, source: "code" },
    ],
  });
  const metrics = new routes.AIMetricsController();
  const allowed = await metrics.allowed("a", "b");
  assert.deepEqual(
    allowed.items.map((item) => [item.title, item.value]),
    [
      ["$dms_ai.activity.allowed_by.read_auto", 118],
      ["$dms_ai.activity.allowed_by.approved", 21],
      ["$dms_ai.activity.allowed_metric.deletions_asked", 2],
    ],
  );
  const tools = await metrics.topTools(undefined, undefined, "5");
  assert.equal(sidecar.requests.at(-1).query.limit, "5");
  assert.deepEqual(
    tools.items.map((item) => item.title),
    ["$dms_ai.activity.tools.BuilderAddBlock", "SomethingNew"],
  );
});

void test("shapes the approved KPI's caption from the sidecar's totals", async () => {
  reset();
  answer("GET", "/metrics/kpi/approved", 200, {
    value: 21,
    delta: 5,
    previousValue: 20,
    sparkline: [],
    total: 25,
  });
  const kpi = await new routes.AIMetricsController().kpi("approved");
  assert.equal(kpi.caption, "21 / 25 · 84%");
});

void test("serves the settings flat, numbers as text, deletions locked on", async () => {
  reset();
  answer("GET", "/settings", 200, {
    provider: "claude",
    requestTimeoutMinutes: 5,
    checkpointRetentionDays: 30,
    providers: { codex: { available: false, reason: "No key" } },
  });
  const settings = await new routes.AISettingsController().getSettings();
  assert.equal(settings.requestTimeoutMinutes, "5");
  assert.equal(settings.checkpointRetentionDays, "30");
  assert.equal(settings.alwaysAskDeletions, true);
  assert.equal(settings.providers.codex.available, false);
});

void test("forwards one instant-saved field, and the sidecar's refusal with its message", async () => {
  reset();
  answer("PUT", "/settings", 400, { message: "mode auto is not a default" });
  const result = await new routes.AISettingsController().updateSettings({
    requestTimeoutMinutes: "15",
    alwaysAskDeletions: false,
    providers: {},
  });
  assert.deepEqual(sidecar.requests[0].body, { requestTimeoutMinutes: 15 });
  assert.equal(result.getStatus(), 400);
  assert.deepEqual(JSON.parse(result.getBody()), {
    message: "mode auto is not a default",
  });
});

void test("stamps Undo and Redo with the signed-in user", async () => {
  reset();
  answer("POST", "/changes/set-1/undo", 200, { undone: ["set-1", "set-2"] });
  answer("POST", "/changes/set-1/redo", 200, { redone: ["set-1"] });
  const changes = new routes.AIChangesController();
  const undone = await changes.undo("set-1", OWNER, { includeLater: true });
  await changes.redo("set-1", { ...OWNER, name: "" });
  assert.deepEqual(undone, { undone: ["set-1", "set-2"] });
  assert.deepEqual(sidecar.requests[0].body, {
    includeLater: true,
    actor: "Camille Laurent",
  });
  assert.deepEqual(sidecar.requests[1].body, { actor: "c@acme.test" });
});

void test("asks Undo's confirmation with the later change sets it collides with", async () => {
  reset();
  answer("GET", "/changes/set-1/undo-preview", 200, {
    changeSetId: "set-1",
    files: ["a.ts", "b.ts"],
    conflicts: [
      { changeSetId: "set-2", number: 14, title: "Top", files: ["a.ts"] },
    ],
  });
  const dialog = await new routes.AIChangesController().undoConfirm("set-1");
  assert.equal(dialog.title, "$dms_ai.changes_table.undo_confirm.title");
  assert.deepEqual(dialog.params, { files: 2, conflicts: 1 });
  assert.deepEqual(dialog.impact, [
    { icon: "i-ph-warning", label: "#14 · Top", count: 1 },
  ]);
  assert.deepEqual(
    dialog.fields.map((field) => field.id),
    ["includeLater"],
  );
});

void test("keys the change sets for the Overview table", async () => {
  reset();
  answer("GET", "/changes", 200, {
    total: 1,
    results: [
      {
        id: "set-1",
        number: 12,
        title: "Refund chart",
        createdAtMs: 0,
        files: [{ path: "a.ts", status: "added", added: 19, removed: 0 }],
        added: 19,
        removed: 0,
        state: "undone",
        stateChangedBy: "Camille",
      },
    ],
  });
  const page = await new routes.AIChangesController().list(
    context("limit=4&filter_scope=is:safe"),
  );
  assert.deepEqual(sidecar.requests[0].query, { limit: "4", scope: "safe" });
  await new routes.AIChangesController().list(
    context("scope=vibe&state=applied"),
  );
  assert.deepEqual(sidecar.requests[1].query, {
    scope: "vibe",
    state: "applied",
  });
  assert.equal(page.results[0]._id, "set-1");
  assert.equal(page.results[0].diffstat, "1 · +19 −0");
  assert.equal(page.results[0].stateDetail, "Camille");
});

void test("exports the audit log as CSV, cells escaped and formulas neutralized", async () => {
  reset();
  answer("GET", "/activity", 200, {
    total: 1,
    results: [{ ...ROW, target: '=HYPERLINK("x")', conversationTitle: "a, b" }],
  });
  const result = await new routes.AIActivityController().export(
    context("filter_category=is:failed&offset=50"),
  );
  assert.equal(result.getContentType(), "text/csv; charset=utf-8");
  assert.match(result.getHeaders()["Content-Disposition"], /attachment/);
  assert.equal(sidecar.requests[0].query.category, "failed");
  assert.equal(sidecar.requests[0].query.offset, undefined);
  const [header, line] = result.getBody().trim().split("\r\n");
  assert.ok(header.startsWith("time,tool,target,"));
  assert.ok(line.includes(`"'=HYPERLINK(""x"")"`));
  assert.ok(line.includes('"a, b"'));
});

void test("lists the skills as table rows, filtered by source for the tabs", async () => {
  reset();
  answer("GET", "/skills", 200, {
    items: [
      {
        id: "m:a",
        name: "a",
        description: "",
        tags: [],
        provenance: "@x/m",
        body: "",
      },
      {
        id: "local:b",
        name: "b",
        description: "",
        tags: [],
        provenance: "local",
        body: "",
      },
    ],
  });
  const skills = new routes.AISkillsController();
  const all = await skills.catalog(context(""));
  const local = await skills.catalog(context("filter_source=is:local"));
  assert.deepEqual(
    all.results.map((row) => [row._id, row.source, row.origin]),
    [
      ["m:a", "module", "@x/m"],
      ["local:b", "local", "~/.claude/skills"],
    ],
  );
  assert.deepEqual(
    local.results.map((row) => row._id),
    ["local:b"],
  );
  assert.equal(local.total, 1);
});

void test("reports the assistant offline, with the process state, when it does not answer", async () => {
  reset();
  sidecar.isDown = true;
  const result = await new routes.AIStatusController().status();
  const body = JSON.parse(result.getBody());
  assert.equal(body.status, "offline");
  assert.equal(body.isRunning, false);
  assert.equal(body.hasGivenUp, false);
});
