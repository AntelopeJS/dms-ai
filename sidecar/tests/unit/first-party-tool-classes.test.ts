import { describe, expect, it } from "vitest";
import { isAlwaysAsk } from "../../src/agent/permission-preview.js";
import { BUILDER_TOOL_NAMES } from "../../src/constants/builder.js";
import {
  FIRST_PARTY_AUTO_ALLOW_TOOL_NAMES,
  MCP_TOOL_NAME_PREFIX,
} from "../../src/constants/mcp.js";
import { buildToolDefinitions } from "../../src/mcp/tool-definitions.js";
import { buildInertMcpDeps } from "../helpers/provider-runner.js";

const DELETING_NAME = /_(delete|remove)_/;

function registeredNames(builderEnabled: boolean): string[] {
  return buildToolDefinitions({
    ...buildInertMcpDeps("conv-classes"),
    builderEnabled,
  }).map((tool) => tool.name);
}

function isAskedInEveryMode(name: string): boolean {
  return isAlwaysAsk({
    toolName: `${MCP_TOOL_NAME_PREFIX}${name}`,
    args: {},
    hostProjectRoot: "/work/app",
    alwaysAskDependencies: false,
    alwaysAskBlockRemoval: true,
  });
}

describe("the module's registered tools", () => {
  it("registers exactly the classified Builder tools, each on the first-party route", () => {
    const registered = registeredNames(true);
    const withoutBuilder = new Set(registeredNames(false));
    const builderTools = registered.filter((name) => !withoutBuilder.has(name));
    expect([...builderTools].sort()).toEqual([...BUILDER_TOOL_NAMES].sort());
    expect(
      new Set(registered.map((name) => `${MCP_TOOL_NAME_PREFIX}${name}`)),
    ).toEqual(FIRST_PARTY_AUTO_ALLOW_TOOL_NAMES);
  });

  it("asks before every registered tool that deletes or removes, in every mode", () => {
    const deleting = registeredNames(true).filter((name) =>
      DELETING_NAME.test(name),
    );
    expect(deleting.length).toBeGreaterThan(0);
    expect(deleting.filter((name) => !isAskedInEveryMode(name))).toEqual([]);
  });
});
