import { execFile } from "node:child_process";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { matchesGlob } from "node:path";
import { promisify } from "node:util";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { z } from "zod";
import type { AlwaysAskPaths } from "../../src/agent/always-ask-files.js";
import { setBuilderAvailable } from "../../src/builder/capability.js";
import {
  CHATGPT_TOKEN_SECRET_ENV,
  CHATGPT_TOKEN_URL_ENV,
} from "../../src/constants/chatgpt.js";
import {
  buildConfigToml,
  buildDenialReminder,
  buildDeveloperInstructions,
  buildTurnOverrides,
  resolveModePolicy,
} from "../../src/providers/codex/config.js";
import {
  buildPermissionProfiles,
  CODEX_PERMISSION_PROFILES,
} from "../../src/providers/codex/permission-profiles.js";
import {
  CHAT_MODES,
  type TurnSettings,
} from "../../src/state/settings-types.js";
import { TURN_SETTINGS } from "../helpers/turn-settings.js";

const HOST_ROOT = "/srv/app";
const MODULE_ROOT = "/srv/app/node_modules/dms-builder";
const WORKSPACE = { hostProjectRoot: HOST_ROOT, moduleRoots: [MODULE_ROOT] };

function settings(overrides: Partial<TurnSettings>): TurnSettings {
  return { ...TURN_SETTINGS, generationMode: "vibe", ...overrides };
}

const FOUND: AlwaysAskPaths = {
  gitHooks: [
    `${HOST_ROOT}/.git`,
    `${HOST_ROOT}/.husky`,
    `${HOST_ROOT}/lefthook.yml`,
  ],
  dependencies: [
    `${HOST_ROOT}/package.json`,
    `${HOST_ROOT}/modules/shop/package.json`,
  ],
};
const PERMISSION_INPUT = { ...WORKSPACE, alwaysAskPaths: FOUND };
const CONFIG_INPUT = {
  ...PERMISSION_INPUT,
  mcpUrl: "http://127.0.0.1:4321/mcp",
  nodePath: process.execPath,
};
const SCOPES = ["vibe", "safe"] as const;

function turnProfile(overrides: Partial<TurnSettings>) {
  const { permissions } = buildTurnOverrides(settings(overrides));
  return buildPermissionProfiles(PERMISSION_INPUT)[permissions];
}

function withBuilder(check: () => void): void {
  setBuilderAvailable(true);
  try {
    check();
  } finally {
    setBuilderAvailable(false);
  }
}

describe("mode mapping", () => {
  it.each(SCOPES)(
    "keeps every secret file unreadable and the network closed in every mode (%s)",
    (generationMode) => {
      withBuilder(() => {
        for (const mode of CHAT_MODES) {
          const profile = turnProfile({ mode, generationMode });
          const unreadable = (file: string) =>
            profile.unreadableGlobs.some((glob) => matchesGlob(file, glob));
          expect(unreadable(".env")).toBe(true);
          expect(unreadable("modules/shop/.env.local")).toBe(true);
          expect(unreadable(".env.example")).toBe(false);
          expect(profile.networkEnabled).toBe(false);
        }
      });
    },
  );

  it.each(["normal", "auto", "plan"] as const)(
    "writes nothing without asking in %s",
    (mode) => {
      expect(turnProfile({ mode }).base).toBe(":read-only");
    },
  );

  it.each(CHAT_MODES)("writes nothing without asking in safe %s", (mode) => {
    withBuilder(() => {
      expect(turnProfile({ mode, generationMode: "safe" }).base).toBe(
        ":read-only",
      );
    });
  });

  it("applies Accept edits, but not to the dependency and git hook files", () => {
    const profile = turnProfile({ mode: "acceptEdits" });
    expect(profile.base).toBe(":workspace");
    expect(profile.readOnlyPaths).toEqual(
      expect.arrayContaining([...FOUND.gitHooks, ...FOUND.dependencies]),
    );
  });

  it("still keeps git hook files read-only once dependencies stop asking", () => {
    const profile = turnProfile({
      mode: "acceptEdits",
      alwaysAskDependencies: false,
    });
    expect(profile.base).toBe(":workspace");
    expect(profile.readOnlyPaths).toEqual(FOUND.gitHooks);
  });

  it("writes in the module roots as in the project", () => {
    expect(turnProfile({ mode: "acceptEdits" }).extraWorkspaceRoots).toEqual([
      MODULE_ROOT,
    ]);
  });

  it.each(SCOPES)(
    "runs a chat in Auto review exactly as Ask first, Codex having no Auto review (%s)",
    (generationMode) => {
      withBuilder(() => {
        const auto = settings({ mode: "auto", generationMode });
        const normal = settings({ mode: "normal", generationMode });
        expect(resolveModePolicy(auto)).toEqual(resolveModePolicy(normal));
        expect(buildTurnOverrides(auto)).toEqual(buildTurnOverrides(normal));
      });
    },
  );

  it("declines every escalation in plan mode", () => {
    expect(
      resolveModePolicy(settings({ mode: "plan" })).autoDeclineEscalations,
    ).toBe(true);
  });

  it.each(CHAT_MODES)("declines every escalation in safe %s", (mode) => {
    withBuilder(() => {
      const safe = settings({ mode, generationMode: "safe" });
      expect(buildTurnOverrides(safe).approvalPolicy).toBe("on-request");
      expect(resolveModePolicy(safe).autoDeclineEscalations).toBe(true);
    });
  });

  it("degrades safe mode to vibe when the Builder is absent", () => {
    const policy = resolveModePolicy(
      settings({ mode: "acceptEdits", generationMode: "safe" }),
    );
    expect(policy.writable).toBe(true);
    expect(policy.autoDeclineEscalations).toBe(false);
  });

  it("translates the thinking level to a reasoning effort", () => {
    expect(buildTurnOverrides(settings({ thinking: "off" })).effort).toBe(
      "low",
    );
    expect(buildTurnOverrides(settings({ thinking: "high" })).effort).toBe(
      "high",
    );
  });
});

describe("config.toml", () => {
  const toml = buildConfigToml(CONFIG_INPUT);

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

  it("runs a thread that names no profile read-only, set before any table", () => {
    const topLevel = toml.split("\n[")[0] ?? "";
    expect(topLevel).toContain(
      `default_permissions = "${CODEX_PERMISSION_PROFILES.READ_ONLY}"`,
    );
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
  const address = server.address();
  if (!isAddressInfo(address)) throw new Error("server has no TCP address");
  const { port } = address;
  return { server, url: `http://127.0.0.1:${port}/codex/access-token` };
}

function isAddressInfo(
  address: ReturnType<Server["address"]>,
): address is AddressInfo {
  return address !== null && typeof address === "object";
}

const StringListSchema = z.array(z.string());
const ExecFailureSchema = z.object({ code: z.number(), stderr: z.string() });

/** The TOML array is written with JSON string escapes, so it reads back as JSON. */
function authCommandArgs(toml: string): string[] {
  const line = toml.split("\n").find((entry) => entry.startsWith("args = "));
  return StringListSchema.parse(
    JSON.parse(line?.slice("args = ".length) ?? "[]"),
  );
}

describe("ChatGPT plan provider", () => {
  const toml = buildConfigToml(CONFIG_INPUT);
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
    const failure = await runAuthCommand(tokenServer.url).catch((error) =>
      ExecFailureSchema.parse(error),
    );
    expect(failure).toMatchObject({ code: 1, stderr: "sign in again" });
  });
});

describe("safe-mode instructions", () => {
  const safe = (): TurnSettings => settings({ generationMode: "safe" });
  const vibe = (): TurnSettings => settings({ generationMode: "vibe" });

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
