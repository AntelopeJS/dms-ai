const assert = require("node:assert/strict");
const { test } = require("node:test");
const {
  answer,
  reset,
  textOf,
  useRouteHarness,
} = require("./helpers/route-harness.cjs");

const harness = useRouteHarness();

const ONLINE_STATUS = {
  status: "ready",
  provider: "claude",
  builderAvailable: true,
  mode: "normal",
  generationMode: "safe",
  workingConversations: 0,
  pendingApprovals: 0,
  pendingQuestions: 1,
  port: 4123,
  lastError: "Agent exited",
};

void test("answers the status, its rows and its banner in the bytes the Overview reads", async () => {
  reset();
  answer("GET", "/status", 200, ONLINE_STATUS);
  const status = new harness.routes.AIStatusController();
  assert.deepEqual(
    [
      textOf(await status.status()),
      textOf(await status.facts()),
      textOf(await status.banner()),
    ],
    [
      '{"status":"ready","provider":"claude","builderAvailable":true,"mode":"normal","generationMode":"safe","workingConversations":0,"pendingApprovals":0,"pendingQuestions":1,"port":4123,"lastError":"Agent exited","isRunning":true,"hasGivenUp":false,"disabled":false}',
      '{"items":[{"id":"state","label":"$dms_ai.status.facts.state","value":"$dms_ai.status.state.ready","type":"status","tone":"success","detail":{"key":"$dms_ai.status.facts.waiting_count","params":{"count":{"type":"count","value":1}}}},{"id":"agent","label":"$dms_ai.status.facts.agent","value":"$dms_ai.status.agent.claude"},{"id":"scope","label":"$dms_ai.status.facts.default_scope","value":"$dms_ai.status.scope.safe","type":"status","tone":"success"},{"id":"mode","label":"$dms_ai.status.facts.approvals","value":"$dms_ai.status.mode.normal"},{"id":"builder","label":"$dms_ai.status.facts.builder","value":"$dms_ai.status.facts.builder_connected","type":"status","tone":"success"},{"id":"sidecar","label":"$dms_ai.status.facts.sidecar","value":"localhost:4123","type":"mono","copy":true}]}',
      '{"tone":"error","icon":"i-ph-warning-octagon","title":"$dms_ai.status.banner.last_error.title","description":{"key":"$dms_ai.status.banner.last_error.description","params":{"error":"Agent exited"}},"actions":[{"label":"$dms_ai.status.banner.last_error.action","to":"/modules/ai/activity","icon":"i-ph-clock-counter-clockwise"}]}',
    ],
  );
});

void test("answers the ChatGPT account banner in the bytes Settings reads", async () => {
  reset();
  const account = new harness.routes.AICodexAccountController();
  answer("GET", "/codex/account", 200, {
    isSignedIn: false,
    loginUrl: "https://auth.openai.com/api/accounts/authorize?state=s",
  });
  const signedOut = textOf(await account.banner());
  answer("GET", "/codex/account", 200, {
    isSignedIn: true,
    email: "dev@example.com",
  });
  assert.deepEqual(
    [signedOut, textOf(await account.banner())],
    [
      '{"tone":"info","size":"sm","icon":"i-ph-open-ai-logo","title":"$dms_ai.settings.chatgpt.signed_out.title","description":"$dms_ai.settings.chatgpt.signed_out.description","actions":[{"label":"$dms_ai.settings.chatgpt.signed_out.action","icon":"i-ph-sign-in","target":{"type":"external","url":"https://auth.openai.com/api/accounts/authorize?state=s","newTab":true}},{"label":"$dms_ai.settings.chatgpt.paste.action","icon":"i-ph-clipboard-text","color":"neutral","confirm":{"title":"$dms_ai.settings.chatgpt.paste.title","description":"$dms_ai.settings.chatgpt.paste.description","icon":"i-ph-clipboard-text","confirmLabel":"$dms_ai.settings.chatgpt.paste.confirm","fields":[{"id":"url","label":"$dms_ai.settings.chatgpt.paste.field","component":{"componentName":"dms-input-text","options":{"placeholder":"http://127.0.0.1:…/auth/chatgpt/callback?code=…"},"children":[]},"type":"string","required":true}]},"target":{"type":"api","url":"/ai/codex/callback","method":"POST","successMessage":"$dms_ai.settings.chatgpt.paste.success"}}]}',
      '{"tone":"success","size":"sm","icon":"i-ph-open-ai-logo","title":{"key":"$dms_ai.settings.chatgpt.signed_in.title","params":{"email":"dev@example.com"}},"description":"$dms_ai.settings.chatgpt.signed_in.description","actions":[{"label":"$dms_ai.settings.chatgpt.signed_in.action","icon":"i-ph-sign-out","color":"neutral","confirm":{"title":"$dms_ai.settings.chatgpt.sign_out_confirm.title","description":"$dms_ai.settings.chatgpt.sign_out_confirm.description","confirmLabel":"$dms_ai.settings.chatgpt.signed_in.action","color":"error"},"target":{"type":"api","url":"/ai/codex/logout","method":"POST","successMessage":"$dms_ai.settings.chatgpt.signed_out_toast"}}]}',
    ],
  );
});
