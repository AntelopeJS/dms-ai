import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { setBuilderAvailable } from "../../src/builder/capability.js";
import { DEFAULT_SETTINGS } from "../../src/constants/settings.js";
import {
  buildAuthFile,
  buildConfigToml,
  buildDenialReminder,
  buildDeveloperInstructions,
  buildTurnOverrides,
  resolveModePolicy,
} from "../../src/providers/codex/config.js";
import type { AppSettings } from "../../src/state/settings-types.js";

const HOST_ROOT = "/srv/app";
const MODULE_ROOT = "/srv/app/node_modules/cms-builder";
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
      networkAccess: true,
      excludeTmpdirEnvVar: false,
      excludeSlashTmp: false,
    });
  });

  it("maps auto to full access with no approvals", () => {
    const overrides = buildTurnOverrides(settings({ mode: "auto" }), WORKSPACE);
    expect(overrides.approvalPolicy).toBe("never");
    expect(overrides.sandboxPolicy).toEqual({ type: "dangerFullAccess" });
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

describe("auth file", () => {
  it("writes the two fields codex login --with-api-key writes", () => {
    expect(buildAuthFile("sk-test")).toEqual({
      auth_mode: "apikey",
      OPENAI_API_KEY: "sk-test",
    });
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
