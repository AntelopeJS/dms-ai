import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { CLAUDE_MCP_TOOL_TIMEOUT_ENV_VAR } from "../../src/constants/claude.js";
import { MCP_TOOL_TIMEOUT_MS } from "../../src/constants/mcp.js";
import { buildClaudeEnv } from "../../src/providers/claude/config.js";

const TMP_PREFIX = "dms-ai-claude-env-";
const CANARY_URL = "postgres://shop:canary-password-7f3a@db.example/shop";

const BASE_ENV = {
  BUILDER_DB_SHOP_URL: CANARY_URL,
  SESSION_SIGNING_KEY: "local-signing-key",
  CLAUDE_CODE_OAUTH_TOKEN: "sign-in-token",
  HTTPS_PROXY: "http://proxy.internal:3128",
  PATH: "/usr/bin",
  HOME: "/home/dev",
  UNRELATED_SETTING: "kept",
  TEMPLATE_ONLY_NAME: "kept-too",
};

describe("the Claude CLI's environment", () => {
  let root: string;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), TMP_PREFIX));
    await writeFile(
      join(root, ".env"),
      [
        `BUILDER_DB_SHOP_URL=${CANARY_URL}`,
        "CLAUDE_CODE_OAUTH_TOKEN=from-env-file",
        "HTTPS_PROXY=http://from-env-file",
      ].join("\n"),
    );
    await writeFile(join(root, ".env.local"), "SESSION_SIGNING_KEY=other\n");
    await writeFile(join(root, ".env.example"), "TEMPLATE_ONLY_NAME=\n");
  });

  afterEach(() => rm(root, { recursive: true, force: true }));

  it("drops the variables a secret file assigns, so a shell the agent runs cannot print them", () => {
    const env = buildClaudeEnv(BASE_ENV, root);
    expect(env.BUILDER_DB_SHOP_URL).toBeUndefined();
    expect(env.SESSION_SIGNING_KEY).toBeUndefined();
  });

  it("keeps the sign-in, PATH, HOME and proxy even when a secret file assigns them", () => {
    const env = buildClaudeEnv(BASE_ENV, root);
    expect(env).toMatchObject({
      CLAUDE_CODE_OAUTH_TOKEN: "sign-in-token",
      HTTPS_PROXY: "http://proxy.internal:3128",
      PATH: "/usr/bin",
      HOME: "/home/dev",
    });
  });

  it("keeps what no secret file assigns, a name only the committed template lists included", () => {
    const env = buildClaudeEnv(BASE_ENV, root);
    expect(env.UNRELATED_SETTING).toBe("kept");
    expect(env.TEMPLATE_ONLY_NAME).toBe("kept-too");
  });

  it("still sets the MCP tool timeout", () => {
    const env = buildClaudeEnv(BASE_ENV, root);
    expect(env[CLAUDE_MCP_TOOL_TIMEOUT_ENV_VAR]).toBe(
      String(MCP_TOOL_TIMEOUT_MS),
    );
  });
});
