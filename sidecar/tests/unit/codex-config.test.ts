import { execFile } from "node:child_process";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { matchesGlob } from "node:path";
import { promisify } from "node:util";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { z } from "zod";
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
  declinesEscalations,
} from "../../src/providers/codex/config.js";
import {
  buildPermissionProfile,
  CODEX_READ_ONLY_PROFILE,
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

const CONFIG_INPUT = {
  ...WORKSPACE,
  mcpUrl: "http://127.0.0.1:4321/mcp",
  nodePath: process.execPath,
};
const SCOPES = ["vibe", "safe"] as const;

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
    "runs every mode under the read-only profile, so each file edit asks (%s)",
    (generationMode) => {
      withBuilder(() => {
        for (const mode of CHAT_MODES) {
          expect(
            buildTurnOverrides(settings({ mode, generationMode })),
          ).toMatchObject({
            approvalPolicy: "on-request",
            permissions: CODEX_READ_ONLY_PROFILE,
          });
        }
      });
    },
  );

  it.each(
    SCOPES.flatMap((scope) =>
      (["auto", "acceptEdits"] as const).map((mode) => [mode, scope] as const),
    ),
  )("runs %s exactly as Ask first in %s", (mode, generationMode) => {
    withBuilder(() => {
      const chosen = settings({ mode, generationMode });
      const normal = settings({ mode: "normal", generationMode });
      expect(buildTurnOverrides(chosen)).toEqual(buildTurnOverrides(normal));
      expect(declinesEscalations(chosen)).toBe(declinesEscalations(normal));
    });
  });

  it("keeps every secret file unreadable, in the module roots too", () => {
    const profile = buildPermissionProfile(WORKSPACE);
    const unreadable = (file: string) =>
      profile.unreadableGlobs.some((glob) => matchesGlob(file, glob));
    expect(unreadable(".env")).toBe(true);
    expect(unreadable("modules/shop/.env.local")).toBe(true);
    expect(unreadable(".env.example")).toBe(false);
    expect(profile.extraWorkspaceRoots).toEqual([MODULE_ROOT]);
  });

  it("asks before escalations in Ask first and Accept edits", () => {
    expect(declinesEscalations(settings({ mode: "normal" }))).toBe(false);
    expect(declinesEscalations(settings({ mode: "acceptEdits" }))).toBe(false);
  });

  it("declines every escalation in plan mode", () => {
    expect(declinesEscalations(settings({ mode: "plan" }))).toBe(true);
  });

  it.each(CHAT_MODES)("declines every escalation in safe %s", (mode) => {
    withBuilder(() => {
      expect(
        declinesEscalations(settings({ mode, generationMode: "safe" })),
      ).toBe(true);
    });
  });

  it("degrades safe mode to vibe when the Builder is absent", () => {
    expect(
      declinesEscalations(
        settings({ mode: "acceptEdits", generationMode: "safe" }),
      ),
    ).toBe(false);
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
      `default_permissions = "${CODEX_READ_ONLY_PROFILE}"`,
    );
  });

  it("closes the network", () => {
    expect(toml).toContain(
      `[permissions.${CODEX_READ_ONLY_PROFILE}.network]\nenabled = false`,
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
    const failure = await runAuthCommand(tokenServer.url).catch(
      (error: unknown) => ExecFailureSchema.parse(error),
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
