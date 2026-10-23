import { execFile } from "node:child_process";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { promisify } from "node:util";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { setBuilderAvailable } from "../../src/builder/capability.js";
import {
  CHATGPT_TOKEN_SECRET_ENV,
  CHATGPT_TOKEN_URL_ENV,
} from "../../src/constants/chatgpt.js";
import { DEFAULT_SETTINGS } from "../../src/constants/settings.js";
import {
  buildConfigToml,
  buildDenialReminder,
  buildDeveloperInstructions,
  buildTurnOverrides,
  resolveModePolicy,
} from "../../src/providers/codex/config.js";
import {
  type AppSettings,
  CHAT_MODES,
} from "../../src/state/settings-types.js";

const HOST_ROOT = "/srv/app";
const MODULE_ROOT = "/srv/app/node_modules/dms-builder";
const WORKSPACE = { hostProjectRoot: HOST_ROOT, moduleRoots: [MODULE_ROOT] };

function settings(overrides: Partial<AppSettings>): AppSettings {
  return { ...DEFAULT_SETTINGS, generationMode: "vibe", ...overrides };
}

describe("mode mapping", () => {
  it("maps normal to read-only plus on-request, so each write escalates", () => {
    const overrides = buildTurnOverrides(
      settings({ mode: "normal" }),
      WORKSPACE,
    );
    expect(overrides.approvalPolicy).toBe("on-request");
    expect(overrides.sandboxPolicy).toEqual({
      type: "readOnly",
      networkAccess: false,
    });
  });

  it("maps acceptEdits to workspace-write over the host and module roots", () => {
    const overrides = buildTurnOverrides(
      settings({ mode: "acceptEdits" }),
      WORKSPACE,
    );
    expect(overrides.sandboxPolicy).toEqual({
      type: "workspaceWrite",
      writableRoots: [HOST_ROOT, MODULE_ROOT],
      networkAccess: false,
      excludeTmpdirEnvVar: false,
      excludeSlashTmp: false,
    });
  });

  // Accepting edits says nothing about egress, and the Claude path grants none
  // here: the backend the user picked must not widen what they agreed to.
  it("leaves the network closed when edits are auto-accepted", () => {
    expect(
      resolveModePolicy(settings({ mode: "acceptEdits" })).networkAccess,
    ).toBe(false);
  });

  it("never grants full access: Full auto runs as normal, the bus answering", () => {
    for (const mode of CHAT_MODES) {
      const overrides = buildTurnOverrides(settings({ mode }), WORKSPACE);
      expect(overrides.approvalPolicy).toBe("on-request");
      expect(overrides.sandboxPolicy).not.toEqual({ type: "dangerFullAccess" });
    }
  });

  it("declines every escalation in plan mode", () => {
    expect(
      resolveModePolicy(settings({ mode: "plan" })).autoDeclineEscalations,
    ).toBe(true);
  });

  it("pins safe mode to read-only even when the mode would allow writes", () => {
    setBuilderAvailable(true);
    try {
      const policy = resolveModePolicy(
        settings({ mode: "acceptEdits", generationMode: "safe" }),
      );
      expect(policy.sandbox).toBe("read-only");
      expect(policy.writable).toBe(false);
      expect(policy.autoDeclineEscalations).toBe(true);
    } finally {
      setBuilderAvailable(false);
    }
  });

  it.each(CHAT_MODES)(
    "keeps safe mode read-only, offline and declining in %s mode",
    (mode) => {
      setBuilderAvailable(true);
      try {
        const safe = settings({ mode, generationMode: "safe" });
        const overrides = buildTurnOverrides(safe, WORKSPACE);
        expect(overrides.approvalPolicy).toBe("on-request");
        expect(overrides.sandboxPolicy).toEqual({
          type: "readOnly",
          networkAccess: false,
        });
        expect(resolveModePolicy(safe).autoDeclineEscalations).toBe(true);
      } finally {
        setBuilderAvailable(false);
      }
    },
  );

  // Without the Builder there is no write route left at all, so safe mode
  // degrades to vibe here exactly as it does on the Claude path.
  it("degrades safe mode to vibe when the Builder is absent", () => {
    const policy = resolveModePolicy(
      settings({ mode: "acceptEdits", generationMode: "safe" }),
    );
    expect(policy.writable).toBe(true);
    expect(policy.autoDeclineEscalations).toBe(false);
  });

  it("translates the thinking level to a reasoning effort", () => {
    expect(
      buildTurnOverrides(settings({ thinking: "off" }), WORKSPACE).effort,
      // Codex rejects "minimal"; off maps to the lowest level it accepts.
    ).toBe("low");
    expect(
      buildTurnOverrides(settings({ thinking: "high" }), WORKSPACE).effort,
    ).toBe("high");
  });
});

describe("config.toml", () => {
  const toml = buildConfigToml({
    mcpUrl: "http://127.0.0.1:4321/mcp",
    hostProjectRoot: HOST_ROOT,
    nodePath: process.execPath,
  });

  it("declares the MCP server at process level", () => {
    expect(toml).toContain("[mcp_servers.dms-ai]");
    expect(toml).toContain('url = "http://127.0.0.1:4321/mcp"');
  });

  it("passes the bearer through an env var, never the file", () => {
    expect(toml).toContain('bearer_token_env_var = "DMS_AI_MCP_TOKEN"');
    expect(toml).not.toContain("bearer_token =");
  });

  it("distrusts the host project and ignores its AGENTS.md", () => {
    expect(toml).toContain('[projects."/srv/app"]');
    expect(toml).toContain('trust_level = "untrusted"');
    expect(toml).toContain("project_doc_max_bytes = 0");
  });
});

const run = promisify(execFile);
const TOKEN_SECRET = "secret-for-test";

interface TokenServer {
  server: Server;
  url: string;
}

/** Answers the sidecar's token route: the token for the right secret only. */
async function startTokenServer(
  status: number,
  body: string,
): Promise<TokenServer> {
  const server = createServer((req, res) => {
    const isAuthorized = req.headers.authorization === `Bearer ${TOKEN_SECRET}`;
    res.writeHead(isAuthorized ? status : 401);
    res.end(isAuthorized ? body : "");
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  return { server, url: `http://127.0.0.1:${port}/codex/access-token` };
}

// The TOML array is written with JSON string escapes, so it reads back as JSON.
function authCommandArgs(toml: string): string[] {
  const line = toml.split("\n").find((entry) => entry.startsWith("args = "));
  return JSON.parse(line?.slice("args = ".length) ?? "[]") as string[];
}

describe("ChatGPT plan provider", () => {
  const toml = buildConfigToml({
    mcpUrl: "http://127.0.0.1:4321/mcp",
    hostProjectRoot: HOST_ROOT,
    nodePath: process.execPath,
  });
  let tokenServer: TokenServer | undefined;

  afterEach(() => {
    tokenServer?.server.close();
    tokenServer = undefined;
  });

  async function runAuthCommand(url: string) {
    return run(process.execPath, authCommandArgs(toml), {
      env: {
        ...process.env,
        [CHATGPT_TOKEN_URL_ENV]: url,
        [CHATGPT_TOKEN_SECRET_ENV]: TOKEN_SECRET,
      },
    });
  }

  it("selects the plan provider at top level, before any table", () => {
    const topLevel = toml.split("\n[")[0] ?? "";
    expect(topLevel).toContain('model_provider = "openai_chatgpt_plan"');
    expect(toml).toContain("requires_openai_auth = false");
    expect(toml).toContain("supports_websockets = false");
  });

  it("prints the token the sidecar answers, as the auth command", async () => {
    tokenServer = await startTokenServer(200, "access-123");
    const { stdout } = await runAuthCommand(tokenServer.url);
    expect(stdout).toBe("access-123");
  });

  it("fails with the sidecar's reason when there is no token to give", async () => {
    tokenServer = await startTokenServer(503, "sign in again");
    const failure = await runAuthCommand(tokenServer.url).catch(
      (error: unknown) => error as { code: number; stderr: string },
    );
    expect(failure).toMatchObject({ code: 1, stderr: "sign in again" });
  });
});

// Safe mode only exists while the Builder is loaded; without it both of these
// degrade to vibe, and there is nothing left to say.
describe("safe-mode instructions", () => {
  const safe = (): AppSettings => settings({ generationMode: "safe" });
  const vibe = (): AppSettings => settings({ generationMode: "vibe" });

  beforeEach(() => setBuilderAvailable(true));
  afterEach(() => setBuilderAvailable(false));

  it("stays quiet below the threshold, so a single refusal is not nagged about", () => {
    expect(buildDenialReminder(safe(), 0)).toBeUndefined();
    expect(buildDenialReminder(safe(), 1)).toBeUndefined();
  });

  it("names the count once the agent loops on refusals", () => {
    const reminder = buildDenialReminder(safe(), 3);
    expect(reminder).toContain("refused 3 times in a row");
    expect(reminder).toContain("Builder");
  });

  it("says nothing in vibe mode, where nothing is being refused", () => {
    expect(buildDenialReminder(vibe(), 5)).toBeUndefined();
  });

  it("carries the safe-mode message a Codex decline cannot", () => {
    expect(buildDeveloperInstructions(safe())).toContain("Builder");
  });

  it("omits the developer instructions in vibe mode", () => {
    expect(buildDeveloperInstructions(vibe())).toBeUndefined();
  });
});
