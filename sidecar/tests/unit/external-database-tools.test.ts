import { describe, expect, it } from "vitest";
import { describeRequest } from "../../src/agent/permission-preview.js";
import { isReadOnlyTool } from "../../src/agent/tool-kinds.js";
import type { BuilderClient } from "../../src/builder/builder-client.js";
import { DATABASE_TOOL_NAMES } from "../../src/constants/database.js";
import {
  FIRST_PARTY_AUTO_ALLOW_TOOL_NAMES,
  MCP_TOOL_NAME_PREFIX,
} from "../../src/constants/mcp.js";
import type { BuilderGate } from "../../src/mcp/tools/builder-gate.js";
import { buildProjectTools } from "../../src/mcp/tools/builder-project.js";

const ROOT = "/project";
const CONFIG = `${ROOT}/antelope.config.ts`;
const STEPS = [
  {
    op: "ConfigureModule",
    id: "mongodb",
    entry: { exportPriority: { "@antelopejs/interface-database": 1 } },
  },
];
const PLANNED = [
  {
    path: CONFIG,
    kind: "modify",
    diff: "@@ line 7 @@\n-     mongodb: { source: x },\n+     mongodb: { source: x, exportPriority: { db: 1 } },",
  },
];

interface Recorded {
  op: string;
  args: unknown[];
}

function recordingClient(calls: Recorded[]): BuilderClient {
  return {
    call: async (op, args) => {
      calls.push({ op, args });
      return { ok: true, data: { files: [CONFIG] }, changes: PLANNED };
    },
  };
}

function configureProject(client: BuilderClient, gate: BuilderGate) {
  const tool = buildProjectTools(client, gate).find(
    (definition) => definition.name === "BuilderConfigureProject",
  );
  if (!tool) throw new Error("BuilderConfigureProject is missing");
  return (args: Record<string, unknown>) =>
    tool.handler(args as never, {} as never);
}

describe("the external-database tools", () => {
  it("reads the catalog without a prompt and in plan mode: auto-allowed and read-only", () => {
    for (const name of DATABASE_TOOL_NAMES) {
      expect(
        FIRST_PARTY_AUTO_ALLOW_TOOL_NAMES.has(`${MCP_TOOL_NAME_PREFIX}${name}`),
      ).toBe(true);
      expect(isReadOnlyTool(name)).toBe(true);
    }
  });

  it("always asks before editing antelope.config.ts, showing the dry run's diff", async () => {
    const description = await describeRequest({
      toolName: `${MCP_TOOL_NAME_PREFIX}BuilderConfigureProject`,
      args: { steps: STEPS, plannedChanges: PLANNED },
      hostProjectRoot: ROOT,
      alwaysAskDependencies: false,
      alwaysAskBlockRemoval: false,
    });
    expect(description.alwaysAsk).toBe(true);
    expect(description.ruleOptions).toEqual([]);
    expect(description.preview).toMatchObject({
      type: "diff",
      relativePath: "antelope.config.ts",
      added: 1,
      removed: 1,
    });
    const lines =
      description.preview.type === "diff"
        ? description.preview.hunks[0]?.lines
        : [];
    expect(lines).toContainEqual(
      expect.objectContaining({ kind: "add", newLine: 7 }),
    );
  });

  it("asks with the dry run's changes, and writes only once approved", async () => {
    const calls: Recorded[] = [];
    let asked: Record<string, unknown> | undefined;
    const gate: BuilderGate = async (_tool, args) => {
      asked = args;
      return { isAllowed: true };
    };
    await configureProject(recordingClient(calls), gate)({ steps: STEPS });
    expect(asked?.plannedChanges).toEqual(PLANNED);
    expect(calls).toEqual([
      { op: "ConfigureProject", args: [STEPS, { dryRun: true }] },
      { op: "ConfigureProject", args: [STEPS] },
    ]);
  });

  it("writes nothing when the user refuses the config edit", async () => {
    const calls: Recorded[] = [];
    const gate: BuilderGate = async () => ({
      isAllowed: false,
      message: "refused",
    });
    const result = await configureProject(
      recordingClient(calls),
      gate,
    )({ steps: STEPS });
    expect(result.isError).toBe(true);
    expect(calls).toEqual([
      { op: "ConfigureProject", args: [STEPS, { dryRun: true }] },
    ]);
  });
});

describe("the external-database skill", () => {
  it("ships in dms-ai's skills, with the frontmatter the catalog lists it by", async () => {
    const { buildSkillCatalog } =
      await import("../../src/skills/build-catalog.js");
    const skillsDir = new URL("../../../skills", import.meta.url).pathname;
    const catalog = await buildSkillCatalog([
      { module: "dms-ai", dir: skillsDir },
    ]);
    const skill = catalog.items.find(
      (item) => item.name === "dms-external-database",
    );
    expect(skill?.category).toBe("Builder");
    expect(catalog.duplicateNames).toEqual([]);
  });
});
