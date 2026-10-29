const assert = require("node:assert/strict");
const { test } = require("node:test");
const {
  PAGE_LOCALES: PAGE_LOCALE_FILES,
  readLocale,
} = require("./helpers/page-locales.cjs");
const {
  answer,
  reset,
  sidecar,
  useRouteHarness,
} = require("./helpers/route-harness.cjs");

const harness = useRouteHarness();

const PAGE_LOCALES = PAGE_LOCALE_FILES.map(readLocale);
const I18N_KEY = /\$dms_ai\.[A-Za-z0-9_.-]+/g;

/** The `$dms_ai` keys an answer holds that a page locale does not translate. */
function untranslated(answer) {
  const keys = JSON.stringify(answer).match(I18N_KEY) ?? [];
  return PAGE_LOCALES.flatMap((locale) =>
    keys.filter(
      (key) =>
        typeof key
          .slice(1)
          .split(".")
          .reduce((node, part) => node?.[part], locale) !== "string",
    ),
  );
}

const ONLINE_STATUS = {
  status: "ready",
  provider: "claude",
  builderAvailable: true,
  mode: "normal",
  generationMode: "safe",
  workingConversations: 0,
  pendingApprovals: 0,
  pendingQuestions: 0,
  port: 4123,
  checkpointsAvailable: true,
};

function bodyOf(result) {
  return JSON.parse(result.getBody());
}

void test("warns once about every skill name several skills share, linking to the skill sources", async () => {
  reset();
  const copy = (source, origin) => ({ source, origin });
  answer("GET", "/skills/conflicts", 200, {
    conflicts: [
      {
        name: "release",
        winner: copy("module", "@x/m"),
        ignored: [copy("local", "~/.claude/skills")],
      },
      {
        name: "review",
        winner: copy("module", "@x/m"),
        ignored: [copy("module", "@x/n")],
      },
    ],
  });
  const banner = await new harness.routes.AISkillsController().conflicts();
  assert.equal(banner.tone, "warning");
  const count = { type: "count", value: 2 };
  assert.deepEqual(banner.title, {
    key: "$dms_ai.skills.conflicts.title",
    params: { count },
  });
  assert.deepEqual(banner.description, {
    key: "$dms_ai.skills.conflicts.description",
    params: { count, names: "release, review" },
  });
  assert.equal(
    banner.actions[0].to,
    "/modules/ai/settings#dms-form-settings-section-skills",
  );
  assert.deepEqual(untranslated(banner), []);
});

void test("draws no conflict banner when no name is shared or the sidecar is down", async () => {
  reset();
  answer("GET", "/skills/conflicts", 200, { conflicts: [] });
  const skills = new harness.routes.AISkillsController();
  assert.equal((await skills.conflicts()).getStatus(), 204);
  sidecar.isDown = true;
  assert.equal((await skills.conflicts()).getStatus(), 204);
});

void test("lists the assistant's status as key / value rows, the sidecar's address copyable", async () => {
  reset();
  answer("GET", "/status", 200, { ...ONLINE_STATUS, pendingApprovals: 2 });
  const { items } = bodyOf(
    await new harness.routes.AIStatusController().facts(),
  );
  assert.deepEqual(
    items.map((item) => item.id),
    ["state", "agent", "scope", "mode", "builder", "sidecar"],
  );
  assert.deepEqual(items[0].detail, {
    key: "$dms_ai.status.facts.waiting_count",
    params: { count: { type: "count", value: 2 } },
  });
  assert.equal(items[2].tone, "success");
  assert.deepEqual(items.at(-1), {
    id: "sidecar",
    label: "$dms_ai.status.facts.sidecar",
    value: "localhost:4123",
    type: "mono",
    copy: true,
  });
  assert.deepEqual(untranslated(items), []);
});

void test("shows the scope turns run in: Code mode when Safe mode lacks Builder", async () => {
  reset();
  answer("GET", "/status", 200, { ...ONLINE_STATUS, builderAvailable: false });
  const { items } = bodyOf(
    await new harness.routes.AIStatusController().facts(),
  );
  const scope = items.find((item) => item.id === "scope");
  assert.equal(scope.value, "$dms_ai.status.scope.vibe");
  assert.equal(scope.tone, "warning");
  assert.equal(scope.detail, "$dms_ai.status.facts.scope_safe_needs_builder");
  assert.deepEqual(untranslated(items), []);
});

void test("keeps only the state and the stopped sidecar while the assistant is offline", async () => {
  reset();
  sidecar.isDown = true;
  const { items } = bodyOf(
    await new harness.routes.AIStatusController().facts(),
  );
  assert.deepEqual(
    items.map((item) => [item.id, item.value, item.tone]),
    [
      ["state", "$dms_ai.status.state.offline", "error"],
      ["sidecar", "$dms_ai.status.facts.sidecar_stopped", "error"],
    ],
  );
  assert.deepEqual(untranslated(items), []);
});

void test("raises the most pressing status banner: offline with Restart, a failed turn, then requests waiting", async () => {
  reset();
  const status = new harness.routes.AIStatusController();
  sidecar.isDown = true;
  const offline = bodyOf(await status.banner());
  assert.equal(offline.tone, "error");
  assert.deepEqual(offline.actions[0].target, {
    type: "api",
    url: "/ai/sidecar/restart",
    method: "POST",
    successMessage: "$dms_ai.status.banner.offline.restarted",
  });
  sidecar.isDown = false;
  answer("GET", "/status", 200, {
    ...ONLINE_STATUS,
    pendingQuestions: 1,
    lastError: "Agent exited",
  });
  const failed = bodyOf(await status.banner());
  assert.deepEqual(failed.description.params, { error: "Agent exited" });
  assert.equal(failed.actions[0].to, "/modules/ai/activity");
  answer("GET", "/status", 200, { ...ONLINE_STATUS, pendingQuestions: 1 });
  const waiting = bodyOf(await status.banner());
  assert.equal(waiting.tone, "warning");
  assert.deepEqual(untranslated([offline, failed, waiting]), []);
});

void test("draws no status banner while all is well", async () => {
  reset();
  answer("GET", "/status", 200, ONLINE_STATUS);
  const result = await new harness.routes.AIStatusController().banner();
  assert.equal(result.getStatus(), 204);
});

void test("offers to sign in with ChatGPT, to paste the return address, or to sign out", async () => {
  reset();
  const account = new harness.routes.AICodexAccountController();
  const loginUrl = "https://auth.openai.com/api/accounts/authorize?state=s";
  answer("GET", "/codex/account", 200, { isSignedIn: false, loginUrl });
  const signedOut = bodyOf(await account.banner());
  assert.deepEqual(signedOut.actions[0].target, {
    type: "external",
    url: loginUrl,
    newTab: true,
  });
  const paste = signedOut.actions[1];
  assert.equal(paste.target.url, "/ai/codex/callback");
  assert.deepEqual(
    paste.confirm.fields.map((field) => [field.id, field.required]),
    [["url", true]],
  );
  answer("GET", "/codex/account", 200, {
    isSignedIn: true,
    email: "dev@example.com",
  });
  const signedIn = bodyOf(await account.banner());
  assert.deepEqual(signedIn.title.params, { email: "dev@example.com" });
  assert.equal(signedIn.actions[0].target.url, "/ai/codex/logout");
  assert.ok(signedIn.actions[0].confirm);
  assert.deepEqual(untranslated([signedOut, signedIn]), []);
  sidecar.isDown = true;
  assert.equal((await account.banner()).getStatus(), 204);
});

void test("hands a pasted return address to the sidecar, and its refusal back", async () => {
  reset();
  const account = new harness.routes.AICodexAccountController();
  const pasted = "http://127.0.0.1:4123/auth/chatgpt/callback?code=c&state=s";
  answer("POST", "/codex/callback", 400, {
    message: "Not the sign-in address",
  });
  const refused = await account.finishSignIn({ url: pasted });
  assert.equal(refused.getStatus(), 400);
  assert.deepEqual(bodyOf(refused), { message: "Not the sign-in address" });
  assert.deepEqual(sidecar.requests.at(-1).body, { url: pasted });
});
